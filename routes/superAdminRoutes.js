const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const verifyToken  = require("../middlewares/verifyToken")
// 🔐 Sign Up API
router.post("/signup", async (req, res) => {
  const { email, password, college_name, college_code } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await pool.query("SELECT * FROM superadmins WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const result = await pool.query(
      `INSERT INTO superadmins (email, password, college_name, college_code)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, hashedPassword, college_name, college_code]
    );

    res.status(201).json({ message: "Superadmin registered", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔐 Sign In API
router.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM superadmins WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid email" });
    }

    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign({ id: result.rows[0].id }, "secretkey", { expiresIn: "1d" });

    res.json({ message: "Login successful", token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/createTeacher", verifyToken, async (req, res) => {
  const { teacher_name, department, user_id, password } = req.body;
  const superadmin_id = req.user.id;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO teachers (teacher_name, department, user_id, password, superadmin_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [teacher_name, department, user_id, hashedPassword, superadmin_id]
    );

    res.status(201).json({ message: "Teacher created successfully", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 🔎 Get all teachers created by the logged-in superadmin
router.get("/getAllTeachers", verifyToken, async (req, res) => {
  const superadmin_id = req.user.id;

  try {
    const result = await pool.query(
      `SELECT id, teacher_name, department, user_id, password, created_at 
       FROM teachers 
       WHERE superadmin_id = $1 
       ORDER BY created_at DESC`,
      [superadmin_id]
    );

    res.status(200).json({ teachers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


///-------------delete teacher 
router.delete("/deleteTeacher/:id", verifyToken, async (req, res) => {
  const teacherId = req.params.id;
  const superadmin_id = req.user.id;

  try {
    // Make sure the teacher belongs to this superadmin
    const result = await pool.query(
      `DELETE FROM teachers 
       WHERE id = $1 AND superadmin_id = $2 
       RETURNING *`,
      [teacherId, superadmin_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Teacher not found or unauthorized" });
    }

    res.status(200).json({ message: "Teacher deleted successfully", deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
