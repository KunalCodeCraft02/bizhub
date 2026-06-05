const mongoose = require("mongoose");
require("dotenv").config();

mongoose.connect("mongodb://localhost:27017/bizhub")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));