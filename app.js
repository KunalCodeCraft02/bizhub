const express = require('express');
const path = require('path');
require('dotenv').config();
const userModel = require("./models/user");
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { isLoggedIn, isGuest, isMentor } = require('./middleware/auth');
const database = require("./config/database");
const schoolModel = require("./models/School");
const mentorModel = require("./models/mentor");
const { Resend } = require('resend');
const multer = require('multer');
const fs = require('fs');

process.on('uncaughtException', err => {
  console.log("UNCAUGHT ERROR:", err);
  process.exit(1);
});

process.on('unhandledRejection', err => {
  console.log("UNHANDLED REJECTION:", err);
});

const app = express();
app.use(cookieParser());

// =========================
// MIDDLEWARE
// =========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files (CSS, JS, assets)
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// VIEW ENGINE (EJS)
// =========================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== FILE UPLOAD CONFIGURATION =====

const submissionsDir = path.join(__dirname, 'public', 'submissions');
if (!fs.existsSync(submissionsDir)) {
  fs.mkdirSync(submissionsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, submissionsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Sanitize filename - remove special chars
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(safeName));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    // Get submissionType from body (note: body might not be parsed yet in fileFilter)
    // So we accept all common extensions and validate on backend
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.pptx', '.ppt'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${ext}. Allowed: ${allowedExtensions.join(', ')}`), false);
    }
  }
});

// =========================
// ADMIN AUTH MIDDLEWARE
// =========================
const isAdmin = (req, res, next) => {
  const adminAuth = req.cookies.adminAuth;

  if (!adminAuth) {
    return res.redirect("/admin/login");
  }

  try {
    const decoded = jwt.verify(adminAuth, "bizhub_admin_secret");
    if (decoded.email !== "root@gmail.com" || decoded.role !== "admin") {
      return res.redirect("/admin/login");
    }
    next();
  } catch (err) {
    return res.redirect("/admin/login");
  }
};

// =========================
// ADMIN ROUTES
// =========================
app.get("/admin/login", (req, res) => {
  res.render("admin-login", { error: req.query.error });
});

app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.redirect("/admin/login?error=All fields are required");
  }

  if (email !== "root@gmail.com" || password !== "root") {
    return res.redirect("/admin/login?error=Invalid admin credentials");
  }

  const token = jwt.sign(
    {
      role: "admin",
      email: "root@gmail.com"
    },
    "bizhub_admin_secret",
    { expiresIn: "8h" }
  );

  res.cookie("adminAuth", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000
  });

  return res.redirect("/admin");
});

app.get("/admin/logout", (req, res) => {
  res.clearCookie("adminAuth");
  res.redirect("/admin/login");
});

app.get("/admin", isAdmin, async (req, res) => {
  try {
    const usersWithSubmissions = await userModel.find({
      $or: [
        { "ideaDocumentSubmission.file": { $exists: true } },
        { "bmcSubmission.file": { $exists: true } },
        { "pitchDeckSubmission.file": { $exists: true } }
      ]
    }).lean();

    const allMentors = await mentorModel.find().lean();
    const allSchools = await schoolModel.find().lean(); 

    res.render('admin', {
      submissions: usersWithSubmissions,
      mentors: allMentors,
      schools: allSchools  
    });
  } catch (error) {
    console.log(error);
    res.redirect("/admin/login");
  }
});

// Secure file upload route
// ===== FILE SUBMISSION ROUTE (FIXED) =====
app.post('/submit-file', isLoggedIn, (req, res, next) => {
  // Custom upload handler to catch multer errors
  upload.single('file')(req, res, function (err) {
    if (err) {
      console.error("Multer error:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "File upload error"
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { videoId, submissionType } = req.body;
    const file = req.file;

    // Use authenticated user's ID from token (more secure)
    const userId = req.user.userid;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded or invalid file type"
      });
    }

    // Map submissionType to DB field
    const fieldMap = {
      ideaDocument: 'ideaDocumentSubmission',
      businessModelCanvas: 'bmcSubmission',
      pitchDeck: 'pitchDeckSubmission'
    };

    const updateField = fieldMap[submissionType];
    if (!updateField) {
      return res.status(400).json({
        success: false,
        message: "Invalid submission type"
      });
    }

    // Update user document
    await userModel.findByIdAndUpdate(userId, {
      $set: {
        [`${updateField}.file`]: `/submissions/${file.filename}`,
        [`${updateField}.submittedAt`]: new Date()
      }
    });

    console.log(`✅ File uploaded: ${file.filename} for user ${userId}`);

    res.json({
      success: true,
      filePath: `/submissions/${file.filename}`
    });
  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error: " + error.message
    });
  }
});

// Secure marks saving route
app.post("/admin/save-marks", isAdmin, async (req, res) => {
  try {
    const { userId, module, score, sector } = req.body;

    const fieldMap = {
      ideaDocument: { marks: 'ideaDocumentSubmission.marks', sector: 'ideaDocumentSubmission.sector' },
      bmc: { marks: 'bmcSubmission.marks', sector: 'bmcSubmission.sector' },
      pitchDeck: { marks: 'pitchDeckSubmission.marks', sector: 'pitchDeckSubmission.sector' }
    };

    const fields = fieldMap[module];
    if (!fields) {
      return res.status(400).json({ success: false, message: "Invalid module" });
    }

    const maxScores = { ideaDocument: 100, bmc: 150, pitchDeck: 300 };
    const scoreNum = Number(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > maxScores[module]) {
      return res.status(400).json({
        success: false,
        message: `Score must be between 0 and ${maxScores[module]}`
      });
    }

    const updateData = {
      [fields.marks]: scoreNum
    };

    if (sector) {
      updateData[fields.sector] = sector;
    }

    await userModel.findByIdAndUpdate(userId, { $set: updateData });

    const user = await userModel.findById(userId);
    const ideaScore = user.ideaDocumentSubmission?.marks || 0;
    const bmcScore = user.bmcSubmission?.marks || 0;
    const pitchScore = user.pitchDeckSubmission?.marks || 0;

    let testScore = 0;
    if (user.testAttempts) {
      testScore = Object.values(user.testAttempts)
        .reduce((sum, attempt) => sum + (attempt.totalScore || 0), 0);
    }

    const totalScore = testScore + ideaScore + bmcScore + pitchScore;

    await userModel.findByIdAndUpdate(userId, {
      $set: { totalTestScore: totalScore }
    });

    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// =========================
// USER AUTH ROUTES
// =========================
const otpStorage = {};

const resend = new Resend(process.env.RESEND_API_KEY);

// =========================
// AUTH PAGES
// =========================
app.get('/login', isGuest, (req, res) => {
  res.render('login', { query: req.query });
});

app.get('/roadmap', (req, res) => {
  res.render('roadmap', { query: req.query });
});

app.get('/about', (req, res) => {
  res.render('about', { query: req.query });
});

app.get("/verify-otp", (req, res) => {
  res.render("verifyotp", {
    email: req.query.email,
    query: req.query
  });
});

app.get('/courseplayer', isLoggedIn, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userid).lean();

    if (!user) {
      return res.redirect('/login');
    }

    if (!user.level) {
      return res.redirect('/pretest?error=Please complete pretest first');
    }

    res.render('courseplayer', { user });
  } catch (error) {
    console.log(error);
    res.redirect('/login');
  }
});

app.get('/signup', isGuest, (req, res) => {
  res.render('signup', { query: req.query });
});

app.get('/signinas', isGuest, (req, res) => {
  res.render('signinas', { query: req.query });
});

app.get('/schoollogin', isGuest, (req, res) => {
  res.render('schoollogin', { query: req.query });
});

app.get('/schoolsignup', isGuest, (req, res) => {
  res.render('schoolsignup', { query: req.query });
});

app.get('/mentorlogin', isGuest, (req, res) => {
  res.render('mentorlogin', { query: req.query });
});

app.get('/mentorsignup', isGuest, (req, res) => {
  res.render('mentorsignup', { query: req.query });
});

// =========================
// PUBLIC PAGE
// =========================
app.get('/', (req, res) => {
  res.render('index');
});

// =========================
// PROTECTED PAGES
// =========================
app.get('/home', isLoggedIn, (req, res) => {
  res.render('home');
});

app.get('/pretest', isLoggedIn, (req, res) => {
  res.render('pretest');
});

app.get("/mentorship", async (req, res) => {
  try {
    const studentToken = req.cookies.token;
    const mentorToken = req.cookies.mentorToken;

    // ===== CASE 1: MENTOR LOGGED IN =====
    if (mentorToken) {
      try {
        const decoded = jwt.verify(mentorToken, "thenameiskunalkailasbodkhe");
        const mentor = await mentorModel.findById(decoded.mentorid).lean();

        if (!mentor) {
          res.clearCookie('mentorToken');
          return res.redirect('/mentorlogin');
        }

        let matchedStudents = [];

        // If approved AND has sector, find students with matching sector
        if (mentor.applicationStatus === 'approved' && mentor.sector) {
          const sectorRegex = new RegExp(`^${mentor.sector.trim()}$`, 'i');

          matchedStudents = await userModel.find({
            $or: [
              { "ideaDocumentSubmission.sector": sectorRegex },
              { "bmcSubmission.sector": sectorRegex },
              { "pitchDeckSubmission.sector": sectorRegex }
            ]
          }, {
            firstName: 1, lastName: 1, email: 1, mobileNumber: 1,
            collegeName: 1, ideaDocumentSubmission: 1,
            bmcSubmission: 1, pitchDeckSubmission: 1
          }).lean();

          // Add detected sector to each student
          matchedStudents = matchedStudents.map(s => {
            const sector = s.ideaDocumentSubmission?.sector ||
              s.bmcSubmission?.sector ||
              s.pitchDeckSubmission?.sector || mentor.sector;
            return { ...s, detectedSector: sector };
          });
        }

        return res.render("mentorship", {
          viewType: 'mentor',
          mentor,
          matchedStudents,
          matchedMentors: [],
          student: null,
          mentors: []
        });
      } catch (err) {
        res.clearCookie('mentorToken');
      }
    }

    // ===== CASE 2: STUDENT LOGGED IN =====
    if (studentToken) {
      try {
        const decoded = jwt.verify(studentToken, "thenameiskunalkailasbodkhe");
        const student = await userModel.findById(decoded.userid).lean();

        if (!student) {
          res.clearCookie('token');
          return res.redirect('/login');
        }

        // Find student's sector from any of their submissions
        const studentSector =
          student.ideaDocumentSubmission?.sector ||
          student.bmcSubmission?.sector ||
          student.pitchDeckSubmission?.sector || '';

        let matchedMentors = [];

        if (studentSector && studentSector.trim() !== '') {
          const sectorRegex = new RegExp(`^${studentSector.trim()}$`, 'i');
          matchedMentors = await mentorModel.find({
            applicationStatus: 'approved',
            sector: sectorRegex
          }).lean();
        }

        return res.render("mentorship", {
          viewType: 'student',
          student: { ...student, sector: studentSector },
          matchedMentors,
          mentor: null,
          matchedStudents: [],
          mentors: []
        });
      } catch (err) {
        res.clearCookie('token');
      }
    }

    // ===== CASE 3: GUEST (NOT LOGGED IN) =====
    const mentors = await mentorModel.find({ applicationStatus: 'approved' }).lean();
    return res.render("mentorship", {
      viewType: 'guest',
      mentors,
      mentor: null,
      student: null,
      matchedMentors: [],
      matchedStudents: []
    });

  } catch (err) {
    console.log("Mentorship error:", err);
    return res.render("mentorship", {
      viewType: 'guest',
      mentors: [],
      mentor: null,
      student: null,
      matchedMentors: [],
      matchedStudents: []
    });
  }
});


// =========================
// LEADERBOARD ROUTE
// =========================
app.get("/leaderboard", isLoggedIn, async (req, res) => {
  try {
    const currentUser = await userModel.findById(req.user.userid).lean();
    const allUsers = await userModel.find({}, {
      firstName: 1,
      lastName: 1,
      collegeName: 1,
      totalTestScore: 1,
      testAttempts: 1,
      completedLectures: 1,
      ideaDocumentSubmission: 1,
      bmcSubmission: 1,
      pitchDeckSubmission: 1
    }).lean();

    let entries = allUsers.map(u => {
      const attempts = u.testAttempts ? Object.values(u.testAttempts) : [];
      const totalAttempts = attempts
        .filter(a => a && a.passed)
        .reduce((sum, a) => sum + (a.attemptNumber || 1), 0);

      const testScore = u.totalTestScore || 0;
      const ideaDocScore = u.ideaDocumentSubmission?.marks || 0;
      const bmcScore = u.bmcSubmission?.marks || 0;
      const pitchScore = u.pitchDeckSubmission?.marks || 0;
      const totalScore = testScore + ideaDocScore + bmcScore + pitchScore;

      return {
        name: `${u.firstName} ${u.lastName}`.trim(),
        collegeName: u.collegeName || '—',
        totalScore,
        testScore,
        ideaDocScore,
        bmcScore,
        pitchScore,
        completedLessons: (u.completedLectures || []).length,
        totalAttempts
      };
    });

    entries.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.totalAttempts - b.totalAttempts;
    });

    let rank = 1;
    entries.forEach((entry, idx) => {
      if (idx > 0) {
        const prev = entries[idx - 1];
        if (entry.totalScore !== prev.totalScore || entry.totalAttempts !== prev.totalAttempts) {
          rank = idx + 1;
        }
      }
      entry.rank = rank;
    });

    res.render("leaderboard", {
      leaderboard: entries,
      user: currentUser
    });
  } catch (error) {
    console.log("Leaderboard error:", error);
    res.redirect("/home");
  }
});

// =========================
// LOGOUT
// =========================
app.get('/logout', (req, res) => {
  res.clearCookie("token");
  res.redirect('/login');
});

// =========================
// POST ROUTES
// =========================
app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const storedData = otpStorage[email];
    if (!storedData) {
      return res.redirect("/signup?error=OTP expired");
    }

    if (storedData.expires < Date.now()) {
      delete otpStorage[email];
      return res.redirect("/signup?error=OTP expired");
    }

    if (storedData.otp != otp) {
      return res.redirect(`/verify-otp?email=${email}&error=Invalid OTP`);
    }

    const hashpassword = await bcrypt.hash(String(storedData.password), 12);
    const createdUser = await userModel.create({
      firstName: storedData.firstName,
      lastName: storedData.lastName,
      email,
      mobileNumber: storedData.mobileNumber,
      year: storedData.year,
      collegeName: storedData.collegeName,
      password: hashpassword,
    });

    delete otpStorage[email];

    let token = jwt.sign(
      { email: email, userid: createdUser._id },
      "thenameiskunalkailasbodkhe",
      { expiresIn: "1h" }
    );

    res.cookie("token", token);
    res.redirect("/home");
  } catch (err) {
    console.log(err);
    res.redirect(`/verify-otp?email=${email}&error=Verification failed`);
  }
});

app.post("/signup", async (req, res) => {
  const { email, firstName, lastName, password, cpassword, collegeName, mobileNumber, year } = req.body;

  try {
    if (!email || !firstName || !lastName || !password || !collegeName || !mobileNumber || !cpassword || !year) {
      return res.redirect("/signup?error=All fields are mandatory");
    }

    if (password !== cpassword) {
      return res.redirect("/signup?error=Passwords do not match");
    }

    if (!/^\d{10}$/.test(mobileNumber)) {
      return res.redirect("/signup?error=Mobile number must be exactly 10 digits");
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.redirect("/signup?error=Weak password");
    }

    let existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.redirect("/signup?error=Email already exists");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    otpStorage[email] = {
      otp,
      firstName,
      lastName,
      password,
      collegeName,
      mobileNumber,
      year,
      expires: Date.now() + 5 * 60 * 1000
    };

    await resend.emails.send({
      from: "BizHub <noreply@bemybot.in>",
      to: email,
      subject: "Your OTP Verification",
      html: `<h2>Email Verification</h2><p>Your OTP is:</p><h1>${otp}</h1><p>Valid for 5 minutes</p>`
    });

    res.redirect(`/verify-otp?email=${email}`);
  } catch (err) {
    console.log(err);
    res.redirect("/signup?error=Failed to send OTP");
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.redirect("/login?error=All fields are mandatory");
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.redirect("/login?error=Account not found");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.redirect("/login?error=Incorrect password");
    }

    let token = jwt.sign(
      { email: user.email, userid: user._id },
      "thenameiskunalkailasbodkhe",
      { expiresIn: "1h" }
    );

    res.cookie("token", token);
    return res.redirect("/home");
  } catch (error) {
    console.log(error);
    return res.redirect("/login?error=Internal server error");
  }
});

app.post("/schoolsignup", async (req, res) => {
  const { email, schoolName, establishmentYear, password, confirmPassword } = req.body;

  try {
    if (!email || !schoolName || !establishmentYear || !password || !confirmPassword) {
      return res.redirect("/schoolsignup?error=All fields are mandatory");
    }

    if (password !== confirmPassword) {
      return res.redirect("/schoolsignup?error=Passwords do not match");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.redirect("/schoolsignup?error=Invalid email address");
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.redirect("/schoolsignup?error=Password must contain uppercase, number and special character");
    }

    let existingSchool = await schoolModel.findOne({ email });
    if (existingSchool) {
      return res.redirect("/schoolsignup?error=School already registered");
    }

    let hashedPassword = await bcrypt.hash(String(password), 12);
    const tempCode = "SCH-" + Math.floor(10000 + Math.random() * 90000);
    const createdSchool = await schoolModel.create({
      email,
      schoolName,
      establishmentYear,
      schoolCode: tempCode,
      password: hashedPassword,
    });

    let token = jwt.sign(
      { email: email, schoolid: createdSchool._id },
      "thenameiskunalkailasbodkhe",
      { expiresIn: "1h" }
    );

   res.cookie("schoolToken", token, { httpOnly: true, maxAge: 60 * 60 * 1000 });
res.redirect("/track-performance");
  } catch (e) {
    console.error("School Registration Error:", e);
    return res.redirect("/schoolsignup?error=Internal server error. Please try again.");
  }
});

app.post("/schoollogin", async (req, res) => {
  const { email, password } = req.body;
  const school = await schoolModel.findOne({ email });
  if (!school || !(await bcrypt.compare(password, school.password))) {
    return res.redirect("/schoollogin?error=Invalid Credentials");
  }
  const token = jwt.sign({ schoolid: school._id }, "thenameiskunalkailasbodkhe", { expiresIn: "1h" });
  res.cookie("schoolToken", token);
  res.redirect("/track-performance");
});

// =========================
// SCHOOL ADMIN AUTH MIDDLEWARE
// =========================
const isSchoolAdmin = async (req, res, next) => {
  const token = req.cookies.schoolToken;

  if (!token) {
    return res.redirect("/schoollogin");
  }

  try {
    const decoded = jwt.verify(token, "thenameiskunalkailasbodkhe");
    const school = await schoolModel.findById(decoded.schoolid);

    if (!school) {
      res.clearCookie("schoolToken");
      return res.redirect("/schoollogin");
    }

    req.school = school;
    next();
  } catch (err) {
    res.clearCookie("schoolToken");
    return res.redirect("/schoollogin");
  }
};


app.get("/track-performance", isSchoolAdmin, async (req, res) => {
  const school = req.school;

  if (school.status === 'pending') return res.render("trackperformance", { status: 'pending', school });
  if (school.status === 'rejected') return res.render("trackperformance", { status: 'rejected', school });

  // Fetch students belonging to THIS school
  const students = await userModel.find({ collegeName: school.schoolName });

  // 1. KPI Calculations
  const totalStudents = students.length;
  let totalLessons = 0;
  let totalScore = 0;
  students.forEach(s => {
    totalLessons += (s.completedLectures || []).length;
    totalScore += (s.totalTestScore || 0);
  });



  const avgProgress = totalStudents ? Math.round((totalLessons / (totalStudents * 24)) * 100) : 0;
  const avgScore = totalStudents ? Math.round(totalScore / totalStudents) : 0;

  // 2. Level Distribution
  const levels = { Beginner: 0, Intermediate: 0, Advanced: 0 };
  students.forEach(s => { if (s.level) levels[s.level]++ });

  // 3. Sector Distribution
  const sectors = {};
  students.forEach(s => {
    const sec = s.ideaDocumentSubmission?.sector || s.bmcSubmission?.sector || s.pitchDeckSubmission?.sector;
    if (sec) sectors[sec] = (sectors[sec] || 0) + 1;
  });

  // 4. Friction Report (Rewinds/Attempts)
  const friction = { "M1": 0, "M2": 0, "M3": 0 };
  students.forEach(s => {
    if (s.testAttempts) {
      // Simplified logic: sum attempts per module
      for (let id in s.testAttempts) {
        if (id.startsWith('m1')) friction["M1"] += (s.testAttempts[id].attemptNumber || 1);
        if (id.startsWith('m2')) friction["M2"] += (s.testAttempts[id].attemptNumber || 1);
        if (id.startsWith('m3')) friction["M3"] += (s.testAttempts[id].attemptNumber || 1);
      }
    }
  });

  // 5. Toppers Table
  const toppers = [...students].sort((a, b) => b.totalTestScore - a.totalTestScore).slice(0, 10);

  res.render("trackperformance", {
    status: 'approved',
    school,
    stats: { totalStudents, avgProgress, avgScore, totalHours: Math.round(totalLessons * 0.5) },
    levels,
    sectors,
    friction,
    toppers
  });
});

// Lecture statistics for bar chart (research)
app.get("/admin/lecture-stats", isAdmin, async (req, res) => {
  try {
    // Aggregate attempt data across all users
    const users = await userModel.find({}, { testAttempts: 1 }).lean();

    // Map to store lecture stats: { videoId: { totalAttempts: number, studentCount: number, sumAttempts: number } }
    const lectureStats = {};

    users.forEach(user => {
      const attempts = user.testAttempts || {};
      for (const [videoId, attemptData] of Object.entries(attempts)) {
        // Only consider lecture videos (assuming IDs start with m1, m2, m3)
        if (!['m1', 'm2', 'm3'].some(prefix => videoId.startsWith(prefix))) continue;

        const attemptNumber = attemptData.attemptNumber || 1; // default to 1 if not set

        if (!lectureStats[videoId]) {
          lectureStats[videoId] = { totalAttempts: 0, studentCount: 0, sumAttempts: 0 };
        }
        lectureStats[videoId].totalAttempts += attemptNumber;
        lectureStats[videoId].studentCount += 1;
        lectureStats[videoId].sumAttempts += attemptNumber;
      }
    });

    // Prepare data for bar chart: average attempts per lecture
    const chartData = Object.keys(lectureStats).map(videoId => {
      const stats = lectureStats[videoId];
      const avgAttempts = stats.studentCount > 0 ? stats.sumAttempts / stats.studentCount : 0;
      return {
        lectureId: videoId,
        averageAttempts: parseFloat(avgAttempts.toFixed(2)),
        totalAttempts: stats.totalAttempts,
        studentCount: stats.studentCount
      };
    });

    // Sort by lectureId for consistent ordering
    chartData.sort((a, b) => a.lectureId.localeCompare(b.lectureId));

    res.json({ success: true, data: chartData });
  } catch (error) {
    console.error("Lecture stats error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Lecture statistics view for rendering bar chart
app.get("/admin/lecture-stats-view", isAdmin, async (req, res) => {
  try {
    // Aggregate attempt data across all users
    const users = await userModel.find({}, { testAttempts: 1 }).lean();

    // Map to store lecture stats: { videoId: { totalAttempts: number, studentCount: number, sumAttempts: number } }
    const lectureStats = {};

    users.forEach(user => {
      const attempts = user.testAttempts || {};
      for (const [videoId, attemptData] of Object.entries(attempts)) {
        // Only consider lecture videos (assuming IDs start with m1, m2, m3)
        if (!['m1', 'm2', 'm3'].some(prefix => videoId.startsWith(prefix))) continue;

        const attemptNumber = attemptData.attemptNumber || 1; // default to 1 if not set

        if (!lectureStats[videoId]) {
          lectureStats[videoId] = { totalAttempts: 0, studentCount: 0, sumAttempts: 0 };
        }
        lectureStats[videoId].totalAttempts += attemptNumber;
        lectureStats[videoId].studentCount += 1;
        lectureStats[videoId].sumAttempts += attemptNumber;
      }
    });

    // Prepare data for bar chart: average attempts per lecture
    const chartData = Object.keys(lectureStats).map(videoId => {
      const stats = lectureStats[videoId];
      const avgAttempts = stats.studentCount > 0 ? stats.sumAttempts / stats.studentCount : 0;
      return {
        lectureId: videoId,
        averageAttempts: parseFloat(avgAttempts.toFixed(2)),
        totalAttempts: stats.totalAttempts,
        studentCount: stats.studentCount
      };
    });

    // Sort by lectureId for consistent ordering
    chartData.sort((a, b) => a.lectureId.localeCompare(b.lectureId));

    res.render('lecture-stats', { lectureStats: chartData });
  } catch (error) {
    console.error("Lecture stats view error:", error);
    res.redirect("/admin");
  }
});

app.post("/admin/update-school-status", isAdmin, async (req, res) => {
    const { schoolId, status } = req.body;
    await schoolModel.findByIdAndUpdate(schoolId, { status });
    res.json({ success: true });
});


// ====== UPDATE EXISTING MENTOR SIGNUP (already exists, but make sure JWT uses mentorToken) ======
app.post("/mentorsignup", async (req, res) => {
  const { firstName, lastName, email, mobile, domain, expertise, experience, bio, password, confirmPassword } = req.body;

  try {
    if (!firstName || !lastName || !email || !mobile || !domain || !expertise || !experience || !bio || !password || !confirmPassword) {
      return res.redirect("/mentorsignup?error=All fields are mandatory");
    }

    if (password !== confirmPassword) {
      return res.redirect("/mentorsignup?error=Passwords do not match");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.redirect("/mentorsignup?error=Invalid email address");
    }

    if (!/^\d{10,}$/.test(mobile)) {
      return res.redirect("/mentorsignup?error=Invalid mobile number");
    }

    if (bio.length < 20) {
      return res.redirect("/mentorsignup?error=Bio must contain minimum 20 characters");
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.redirect("/mentorsignup?error=Weak password");
    }

    let existingMentor = await mentorModel.findOne({ email });
    if (existingMentor) {
      return res.redirect("/mentorsignup?error=Mentor already exists");
    }

    let hashedPassword = await bcrypt.hash(String(password), 12);
    const mentorCode = "MEN-" + Math.floor(10000 + Math.random() * 90000);

    const createdMentor = await mentorModel.create({
      firstName, lastName, email, mobile, domain, expertise, experience, bio,
      mentorCode, password: hashedPassword,
      applicationStatus: 'pending'
    });

    let token = jwt.sign(
      { email: email, mentorid: createdMentor._id },
      "thenameiskunalkailasbodkhe",
      { expiresIn: "7d" }
    );

    res.cookie("mentorToken", token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.redirect("/mentorship");

  } catch (error) {
    console.log(error);
    return res.redirect("/mentorsignup?error=Internal server error");
  }
});

app.post("/mentorlogin", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.redirect("/mentorlogin?error=All fields are mandatory");
    }

    const mentor = await mentorModel.findOne({ email });
    if (!mentor) {
      return res.redirect("/mentorlogin?error=Mentor account not found");
    }

    const isMatch = await bcrypt.compare(password, mentor.password);
    if (!isMatch) {
      return res.redirect("/mentorlogin?error=Incorrect password");
    }

    let token = jwt.sign(
      { email: mentor.email, mentorid: mentor._id },
      "thenameiskunalkailasbodkhe",
      { expiresIn: "7d" }
    );

    res.cookie("mentorToken", token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.redirect("/mentorship");

  } catch (error) {
    console.log(error);
    return res.redirect("/mentorlogin?error=Internal server error");
  }
});

app.post("/admin/update-mentor-status", isAdmin, async (req, res) => {
  try {
    const { mentorId, status, sector, rejectionReason } = req.body;

    if (!mentorId || !status) {
      return res.status(400).json({ success: false, message: "Missing parameters" });
    }

    const updateData = { applicationStatus: status };

    if (status === 'approved' && sector) {
      updateData.sector = sector;
    }

    if (status === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    await mentorModel.findByIdAndUpdate(mentorId, { $set: updateData });

    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// ====== MENTOR LOGOUT ======
app.get('/mentorlogout', (req, res) => {
  res.clearCookie('mentorToken');
  res.redirect('/mentorlogin');
});



app.post("/mentorlogin", async (req, res) => {
  const { email, mentorCode, password } = req.body;

  try {
    if (!email || !mentorCode || !password) {
      return res.redirect("/mentorlogin?error=All fields are mandatory");
    }

    const mentor = await mentorModel.findOne({ email });
    if (!mentor) {
      return res.redirect("/mentorlogin?error=Mentor account not found");
    }

    if (mentorCode !== mentor.mentorCode) {
      return res.redirect("/mentorlogin?error=Invalid mentor code");
    }

    const isMatch = await bcrypt.compare(password, mentor.password);
    if (!isMatch) {
      return res.redirect("/mentorlogin?error=Incorrect password");
    }

    let token = jwt.sign(
      { email: mentor.email, mentorid: mentor._id },
      "thenameiskunalkailasbodkhe",
      { expiresIn: "1h" }
    );

    res.cookie("token", token);
    return res.redirect("/mentorlogin?success=Login successful");
  } catch (error) {
    console.log(error);
    return res.redirect("/mentorlogin?error=Internal server error");
  }
});

app.post("/save-level", isLoggedIn, async (req, res) => {
  try {
    const correct = Number(req.body.correct);
    const answered = Number(req.body.answered || 0);
    const wrong = Number(req.body.wrong || 0);
    const skipped = Number(req.body.skipped || 0);

    if (Number.isNaN(correct) || correct < 0 || correct > 20) {
      return res.status(400).json({ success: false, message: "Invalid score" });
    }

    let level;
    if (correct >= 16) level = "Advanced";
    else if (correct >= 12) level = "Intermediate";
    else level = "Beginner";

    await userModel.findByIdAndUpdate(req.user.userid, {
      $set: {
        level,
        "pretest.score": correct,
        "pretest.answered": answered,
        "pretest.wrong": wrong,
        "pretest.skipped": skipped,
        "pretest.completed": true,
        "pretest.submittedAt": new Date()
      }
    });

    return res.json({ success: true, level });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/save-test-score", isLoggedIn, async (req, res) => {
  try {
    const { videoId, timeTaken, attemptNumber } = req.body;

    if (!videoId || !timeTaken || !attemptNumber) {
      return res.status(400).json({ success: false, message: "Missing required parameters" });
    }

    let attemptScore = 0;
    if (attemptNumber === 1) attemptScore = 25;
    else if (attemptNumber === 2) attemptScore = 20;
    else if (attemptNumber === 3) attemptScore = 15;
    else if (attemptNumber === 4) attemptScore = 10;
    else attemptScore = 5;

    let timeBonus = 0;
    if (timeTaken < 15) timeBonus = 10;
    else if (timeTaken <= 60) timeBonus = 7;
    else if (timeTaken <= 300) timeBonus = 5;
    else if (timeTaken <= 420) timeBonus = 4;
    else timeBonus = 3;

    const totalScore = attemptScore + timeBonus;
    const user = await userModel.findById(req.user.userid);

    if (!user.testAttempts) user.testAttempts = {};

    user.testAttempts[videoId] = {
      attemptNumber,
      timeTaken,
      totalScore,
      timestamp: new Date(),
      passed: true
    };

    if (!user.completedLectures.includes(videoId)) {
      user.completedLectures.push(videoId);
    }

    const allScores = Object.values(user.testAttempts).map(attempt => attempt.totalScore);
    user.totalTestScore = allScores.reduce((sum, score) => sum + score, 0);

    await user.save();

    return res.json({
      success: true,
      totalScore,
      attemptScore,
      timeBonus,
      completedLectures: user.completedLectures.length
    });
  } catch (error) {
    console.log("Save test score error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`BizHub server running on http://localhost:${PORT}`);
});