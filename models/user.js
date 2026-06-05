const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    mobileNumber: { type: String, required: true },
    collegeName: { type: String },
    year: { type: String },
    password: { type: String, required: true },
    level: { type: String, enum: ["Beginner", "Intermediate", "Advanced"] },
    pretest: {
        score: Number,
        answered: Number,
        wrong: Number,
        skipped: Number,
        completed: { type: Boolean, default: false },
        submittedAt: Date
    },
    completedLectures: { type: [String], default: [] },
    testAttempts: {
        type: Map,
        of: {
            attemptNumber: {
                type: Number,
                default: 0
            },
            timeTaken: Number,
            totalScore: Number,
            timestamp: Date,
            passed: Boolean
        },
        default: {}
    },
    totalTestScore: { type: Number, default: 0 },

    // ✅ SUBMISSION FIELDS
    ideaDocumentSubmission: {
        file: String,
        submittedAt: Date,
        marks: { type: Number, default: 0 },
        sector: String
    },
    bmcSubmission: {
        file: String,
        submittedAt: Date,
        marks: { type: Number, default: 0 },
        sector: String
    },
    pitchDeckSubmission: {
        file: String,
        submittedAt: Date,
        marks: { type: Number, default: 0 },
        sector: String
    }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);