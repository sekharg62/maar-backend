const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const verifyToken  = require("../middlewares/verifyToken")

router.post("/login", async (req, res) => {
  const { userId, password } = req.body;
  console.log("username", req.body);
  try {
    const result = await pool.query(
      `SELECT * FROM teachers WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Invalid user ID" });
    }

    const teacher = result.rows[0];
    const isMatch = await bcrypt.compare(password, teacher.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    // Generate token
    const token = jwt.sign(
      { id: teacher.id, role: "teacher" },
      process.env.JWT_SECRET || "yoursecretkey",
      { expiresIn: "1d" }
    );

    res.status(200).json({
      status: 1,
      message: "Login successful",
      token,
      teacher: {
        id: teacher.id,
        name: teacher.teacher_name,
        department: teacher.department,
        userId: teacher.user_id,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
