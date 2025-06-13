const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const verifyToken  = require("../middlewares/verifyToken")
// 🔐 Sign Up API

/**
 * @swagger
 * /api/superadmin/signup:
 *   post:
 *     summary: Register a new superadmin
 *     tags: [Superadmin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               college_name:
 *                 type: string
 *               college_code:
 *                 type: string
 *     responses:
 *       201:
 *         description: Superadmin registered
 *       400:
 *         description: Email already exists
 */
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

    res.status(201).json({ message: "Registration successful. You may now log in.", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔐 Sign In API
/**
 * @swagger
 * /api/superadmin/signin:
 *   post:
 *     summary: Superadmin sign-in
 *     tags: [Superadmin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 example: yourPassword123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *       400:
 *         description: Invalid email
 *       401:
 *         description: Invalid password
 *       500:
 *         description: Server error
 */
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

    res.json({ message: "Login successful", token ,status:1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//---------------Create Teacher

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

    res.status(201).json({status:1, message: "Teacher created successfully", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//----------------getAllTeacher
router.get("/getAllTeachers", verifyToken, async (req, res) => {
  const superadmin_id = req.user.id;

 try {
    // Get all teachers
    const teachersResult = await pool.query(
      `SELECT 
      id,
         teacher_name AS name, 
         department, 
         user_id AS "userId", 
         password, 
         created_at 
       FROM teachers 
       WHERE superadmin_id = $1 
       ORDER BY created_at DESC`,
      [superadmin_id]
    );

    const teachers = teachersResult.rows;

    // Get college info
    const collegeResult = await pool.query(
      `SELECT college_name, college_code 
       FROM superadmins 
       WHERE id = $1`,
      [superadmin_id]
    );

    const collegeInfo = collegeResult.rows[0];

    res.status(200).json({
      teachers,
      totalTeachers: teachers.length,
      college: collegeInfo,
    });
  }

  
   catch (err) {
    res.status(500).json({ error: err.message });
  }
});
///-------------delete teacher 

router.delete("/deleteTeacher/:id", verifyToken, async (req, res) => {
  const teacherId = req.params.id;
  const superadmin_id = req.user.id;

  try {
    // Optional: log for debugging
    console.log(`Attempting to delete teacher with ID: ${teacherId} by superadmin: ${superadmin_id}`);

    const result = await pool.query(
      `DELETE FROM teachers 
       WHERE id = $1 AND superadmin_id = $2 
       RETURNING *`,
      [teacherId, superadmin_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Teacher not found or unauthorized" });
    }

    res.status(200).json({status:1, message: "Teacher deleted successfully", deletedTeacher: result.rows[0] });
  } catch (err) {
    console.error("Error deleting teacher:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


router.put("/updateTeacher/:id", verifyToken, async (req, res) => {
  const teacherId = req.params.id;
  const superadmin_id = req.user.id;
  const { name, department, userId, password } = req.body;

  try {
    // Optional: Debug log
    console.log(`Updating teacher ID: ${teacherId} by superadmin: ${superadmin_id}`);

    const result = await pool.query(
      `UPDATE teachers 
       SET 
         teacher_name = $1, 
         department = $2, 
         user_id = $3, 
         password = $4 
       WHERE id = $5 AND superadmin_id = $6 
       RETURNING id, teacher_name AS name, department, user_id AS "userId", password`,
      [name, department, userId, password, teacherId, superadmin_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Teacher not found or unauthorized" });
    }

    res.status(200).json({ status: 1, message: "Teacher updated successfully", updatedTeacher: result.rows[0] });
  } catch (err) {
    console.error("Error updating teacher:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


module.exports = router;
