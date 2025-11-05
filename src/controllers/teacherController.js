// controllers/teacherAuthController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import dotenv from "dotenv";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import sendResponse from "../utils/sendResponse.js";
dotenv.config();

export const loginTeacher = async (req, res) => {
  const { email, password } = req.body;
  //console.log("Teacher detaisl for log in::",email,password)

  try {
    const result = await pool.query(`SELECT * FROM teachers WHERE email = $1`, [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Invalid Email Id" });
    }

    const teacher = result.rows[0];

    // Use bcrypt to compare the plain password with the hashed one
    const isMatch = await bcrypt.compare(password, teacher.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: teacher.id, role: "teacher" },
      process.env.JWT_SECRET || "your_secure_secret_key",
      { expiresIn: "1d" }
    );

    res.status(200).json({
      status: 200,
      message: "Login successful",
      data: {
        role: "teacher",
        token: token,
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        department: teacher.department,
        mobile_no: teacher.mobile_no,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getTeacherDetails = async (req, res) => {
  //console.log("Techer details");

  try {
    const teacherId = req.user.id;
    const currentYear = new Date().getFullYear();

    // Fetch teacher details
    const teacherResult = await pool.query(
      `SELECT * FROM teachers WHERE id = $1`,
      [teacherId]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const teacher = teacherResult.rows[0];

    // Fetch students with their activities
    const studentResult = await pool.query(
      `SELECT s.id, s.name, s.admission_year, s.mobile_no,
              COALESCE(json_agg(sa) FILTER (WHERE sa.id IS NOT NULL), '[]') AS activities
       FROM students s
       LEFT JOIN student_activities sa ON sa.student_id = s.id
       WHERE s.teacher_id = $1
       GROUP BY s.id`,
      [teacherId]
    );

    // Initialize year summary
    const studentData = [
      { year: "1st Year", count: 0, submit: 0, remain: 0 },
      { year: "2nd Year", count: 0, submit: 0, remain: 0 },
      { year: "3rd Year", count: 0, submit: 0, remain: 0 },
      { year: "4th Year", count: 0, submit: 0, remain: 0 },
    ];

    studentResult.rows.forEach((student) => {
      const admissionYear = parseInt(student.admission_year);
      const academicYear = currentYear - admissionYear + 1;

      if (academicYear >= 1 && academicYear <= 4) {
        const yearIndex = academicYear - 1;

        // Always increment total student count
        studentData[yearIndex].count += 1;

        if (student.activities.length > 0) {
          studentData[yearIndex].submit += 1;
        } else {
          studentData[yearIndex].remain += 1;
        }
      }
    });

    res.status(200).json({
      status: 200,
      message: "Teacher details and student summary fetched successfully",
      data: {
        teacher,
        studentData,
      },
    });
  } catch (error) {
    console.error("Error fetching teacher or student data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const uploadStudentAndSignature = async (req, res) => {
  console.log("Submitting to:", "/api/teacher/upload-students");

  /*  try {
    const { year } = req.body;
    const teacherId = req.user.id;

    // 1. Parse Excel file
    const excelFile = req.files["excel"]?.[0];
    if (!excelFile) {
      return sendResponse(res, {
        status: 0,
        message: "Excel file not provided",
        httpCode: 400
      });
    }

    const workbook = xlsx.read(excelFile.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // 2. Insert students
    for (const student of data) {
      await pool.query(
        `INSERT INTO students (name, email, university_roll_no, mobile_no, current_year, teacher_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          student.Name,
          student.Email,
          student.University_Roll_No,
          student.Mobile_No,
          year,
          teacherId
        ]
      );
    }

    // 3. Save signature file and update teacher table
    const signatureFile = req.files["signature"]?.[0];
    if (!signatureFile) {
      return sendResponse(res, {
        status: 0,
        message: "Signature file not provided",
        httpCode: 400
      });
    }

    const fileName = `${teacherId}_${Date.now()}_${signatureFile.originalname}`;
    const savePath = path.join("uploads", "signatures", fileName);

    fs.writeFileSync(savePath, signatureFile.buffer);

    await pool.query(
      `UPDATE teachers SET signature = $1 WHERE id = $2`,
      [savePath, teacherId]
    );

    return sendResponse(res, {
      status: 1,
      message: "Students and signature uploaded successfully"
    });
  } catch (err) {
    console.error("Upload error:", err);
    return sendResponse(res, {
      status: 0,
      message: "Upload failed",
      data: err.message,
      httpCode: 500
    });
  } */
};

export const uploadTeacherSignature = async (req, res) => {
  console.log("===== Upload Teacher Signature Request =====");
  console.log("Headers:", req.headers);
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Teacher ID from token:", req.user?.id || req.userId);
  console.log(
    "File received:",
    req.file
      ? {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          encoding: req.file.encoding,
          mimetype: req.file.mimetype,
          size: req.file.size,
          location: req.file.location, // S3 file URL
        }
      : "❌ No file received"
  );
  console.log("Body data:", req.body);
  console.log("============================================");

  try {
    const teacherId = req.user?.id || req.userId;
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const fileUrl = req.file.location; // multer-s3 gives this

    // Save in DB
    await pool.query("UPDATE teachers SET signature = $1 WHERE id = $2", [
      fileUrl,
      teacherId,
    ]);

    console.log(
      `✅ Signature uploaded successfully for teacher ID ${teacherId}`
    );
    res.status(200).json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("❌ Error uploading signature:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to upload signature" });
  }
};

export const createTeacher = async (req, res) => {
  const { teacher_name, department, email, password, mobile_no } = req.body;
  const superadmin_id = req.user.id;
  console.log("create teacheer", req.body, typeof superadmin_id);

  try {
    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO teachers (name, email, password_hash, department, superadmin_id,mobile_no)
       VALUES ($1, $2, $3, $4, $5,$6)
       RETURNING *`,
      [teacher_name, email, password_hash, department, superadmin_id, mobile_no]
    );

    res.status(201).json({
      status: 1,
      message: "Teacher created successfully",
      data: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllTeachers = async (req, res) => {
  const superadmin_id = req.user.id;

  try {
    // Fetch teachers under this superadmin
    const teachersResult = await pool.query(
      `SELECT 
  id,
  name, 
  email,
  mobile_no,
  department,
  password_hash
FROM teachers 
WHERE superadmin_id = $1;
`,
      [superadmin_id]
    );

    const teachers = teachersResult.rows;

    res.status(200).json({
      teachers,
      totalTeachers: teachers.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const updateTeacher = async (req, res) => {
  const teacherId = req.params.id;
  const { name, email, mobile_no, department, password } = req.body;

  try {
    // Optional: hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const updateQuery = `
      UPDATE teachers
      SET 
        name = $1,
        email = $2,
        mobile_no = $3,
        department = $4,
        password_hash = $5
      WHERE id = $6
      RETURNING id, name, email, mobile_no, department;
    `;

    const result = await pool.query(updateQuery, [
      name,
      email,
      mobile_no,
      department,
      hashedPassword,
      teacherId,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    return res.status(200).json({
      message: "Teacher updated successfully",
      teacher: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const deleteTeacher = async (req, res) => {
  const teacherId = req.params.id;
  const superadmin_id = req.user.id;

  try {
    console.log(
      `Attempting to delete teacher with ID: ${teacherId} by superadmin: ${superadmin_id}`
    );

    const result = await pool.query(
      `DELETE FROM teachers 
       WHERE id = $1 AND superadmin_id = $2 
       RETURNING *`,
      [teacherId, superadmin_id]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "Teacher not found or unauthorized" });
    }

    res.status(200).json({
      status: 1,
      message: "Teacher deleted successfully",
      deletedTeacher: result.rows[0],
    });
  } catch (err) {
    console.error("Error deleting teacher:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const automaticSubmit = async (req, res) => {
  const { roll, password } = req.body;

  console.log("roll and pass::", roll, password);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  }); // use headless: false to see actions
  const page = await browser.newPage();
  await page.goto("https://makaut1.ucanapply.com/smartexam/public/", {
    waitUntil: "networkidle2",
    timeout: 0,
  });

  // STEP 1: Click the div that triggers the login popup
  await page.waitForSelector('a[onclick*="openLoginPage"][onclick*="4"]', {
    visible: true,
  });
  await page.evaluate(() => {
    document.querySelector('a[onclick*="openLoginPage"][onclick*="4"]').click();
  });

  console.log("Clicked login for page 4");

  // STEP 2: Wait for the login modal to appear
  await page.waitForSelector("#username", { visible: true });
  await page.focus("#username");
  await page.keyboard.type(String(roll));

  await page.focus("#password");
  await page.keyboard.type(String(password));

  // STEP 4: Click the login button
  await page.click('a[onclick="postLogin();"]');
  // Adjust selector if necessary

  await page.waitForSelector(
    'a[href="https://makaut1.ucanapply.com/smartexam/public/college/mar-entries"]',
    { visible: true }
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click(
      'a[href="https://makaut1.ucanapply.com/smartexam/public/college/mar-entries"]'
    ),
  ]);

  console.log("Redirected to mark entry page.");

  // STEP 5 (optional): Wait for navigation or check for login success
  await page.waitForNavigation(7000);

  console.log("Login completed.");
};
