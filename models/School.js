const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  schoolName: { type: String, required: true },
  establishmentYear: { type: Number },
  schoolCode: { type: String },
  password: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});


const School = mongoose.model('School', schoolSchema);
module.exports = School;