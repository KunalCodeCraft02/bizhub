const mongoose = require('mongoose');

const mentorSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true },
  domain: { type: String, required: true },
  expertise: { type: String, required: true },
  experience: { type: String, required: true },
  bio: { type: String, required: true },
  sector: { type: String, default: '' }, // Set by admin (matches student sectors)
  mentorCode: { type: String, required: true },
  password: { type: String, required: true },
  applicationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model("Mentor", mentorSchema);