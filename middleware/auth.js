const jwt = require('jsonwebtoken');
const mentorModel = require('../models/mentor');

module.exports.isLoggedIn = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const decoded = jwt.verify(token, "thenameiskunalkailasbodkhe");
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
};

module.exports.isGuest = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return next();
  return res.redirect('/home');
};

// ✅ NEW: Mentor authentication
module.exports.isMentor = async (req, res, next) => {
  const token = req.cookies.mentorToken;
  if (!token) return res.redirect('/mentorlogin');
  try {
    const decoded = jwt.verify(token, "thenameiskunalkailasbodkhe");
    const mentor = await mentorModel.findById(decoded.mentorid);
    if (!mentor) {
      res.clearCookie('mentorToken');
      return res.redirect('/mentorlogin');
    }
    req.mentor = mentor;
    next();
  } catch (err) {
    res.clearCookie('mentorToken');
    return res.redirect('/mentorlogin');
  }
};