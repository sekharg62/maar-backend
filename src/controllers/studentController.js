import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import sendResponse from "../utils/sendResponse.js";
import dotenv from "dotenv";
dotenv.config();
import { initialStudentActivityFormData } from "../data/staticData.js";

import dayjs from "dayjs";
import { deleteFileFromS3 } from "../config/s3.js";
const router = express.Router();

export const createStudentIndividual = async (req, res) => {
  try {
    const { name, email, rollNo, mobileNo, year } = req.body;
    const teacherId = req.user.id;

    const currentYear = new Date().getFullYear();
    const admissionYear = currentYear - (parseInt(year) - 1);

    // 1. Get superadmin_id of the teacher
    const teacherResult = await pool.query(
      `SELECT superadmin_id FROM teachers WHERE id = $1`,
      [teacherId]
    );

    if (!teacherResult.rows.length) {
      return res.status(404).json({ error: "Teacher not found." });
    }

    const superadminId = teacherResult.rows[0].superadmin_id;

    // 2. Get institute ID using superadmin_id
    const instituteResult = await pool.query(
      `SELECT id FROM institutes WHERE superadmin_id = $1`,
      [superadminId]
    );

    if (!instituteResult.rows.length) {
      return res.status(404).json({ error: "Institute not found." });
    }

    const instituteId = instituteResult.rows[0].id;

    // 3. Get latest payment info for institute
    const paymentResult = await pool.query(
      `SELECT student_quota, students_registered 
       FROM payments 
       WHERE institute_id = $1 
       ORDER BY paid_on DESC LIMIT 1`,
      [instituteId]
    );

    if (!paymentResult.rows.length) {
      return res
        .status(403)
        .json({ error: "Superadmin hasn't made any payment." });
    }

    const { student_quota, students_registered } = paymentResult.rows[0];

    if (students_registered >= student_quota) {
      return res.status(403).json({
        error:
          "Student quota limit reached. Ask Superadmin to purchase more slots.",
      });
    }

    // 4. Check duplicates
    const dupCheck = await pool.query(
      `SELECT * FROM students WHERE email = $1 OR roll_no = $2 OR mobile_no = $3`,
      [email, rollNo, mobileNo]
    );

    if (dupCheck.rows.length) {
      const existing = dupCheck.rows[0];
      if (existing.email === email) {
        return res.status(409).json({ error: "Email already exists." });
      } else if (existing.roll_no === rollNo) {
        return res.status(409).json({ error: "Roll number already exists." });
      } else if (existing.mobile_no === mobileNo) {
        return res.status(409).json({ error: "Mobile number already exists." });
      }
    }

    // 5. Hash password using mobileNo
    const passwordHash = await bcrypt.hash(mobileNo, 10);

    // 6. Insert student
    await pool.query(
      `INSERT INTO students 
        (name, email, mobile_no, password_hash, roll_no, teacher_id, superadmin_id, admission_year, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        name,
        email,
        mobileNo,
        passwordHash,
        rollNo,
        teacherId,
        superadminId,
        admissionYear,
      ]
    );

    // 7. Update students_registered count
    await pool.query(
      `UPDATE payments 
       SET students_registered = students_registered + 1 
       WHERE institute_id = $1`,
      [instituteId]
    );

    return res.status(201).json({ message: "Student created successfully." });
  } catch (error) {
    console.error("Error creating student:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};
export const createStudentsBulk = async (req, res) => {
  console.log("bulk");
  const client = await pool.connect();
  try {
    const teacherId = req.user.id;
    const students = req.body; // Expect array of { name, email, rollNo, mobileNo, year }

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: "Students array is required." });
    }

    await client.query("BEGIN");

    // 1️⃣ Get teacher -> superadmin -> institute info
    const teacherResult = await client.query(
      `SELECT superadmin_id FROM teachers WHERE id = $1`,
      [teacherId]
    );

    if (!teacherResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Teacher not found." });
    }

    const superadminId = teacherResult.rows[0].superadmin_id;

    const instituteResult = await client.query(
      `SELECT id FROM institutes WHERE superadmin_id = $1`,
      [superadminId]
    );

    if (!instituteResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Institute not found." });
    }

    const instituteId = instituteResult.rows[0].id;

    const paymentResult = await client.query(
      `SELECT id, student_quota, students_registered 
       FROM payments 
       WHERE institute_id = $1 
       ORDER BY paid_on DESC LIMIT 1`,
      [instituteId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Superadmin hasn't made any payment." });
    }

    const {
      id: paymentId,
      student_quota,
      students_registered,
    } = paymentResult.rows[0];

    // Check quota
    if (students_registered + students.length > student_quota) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: `Quota exceeded. You can only add ${
          student_quota - students_registered
        } more students.`,
      });
    }

    // 2️⃣ Prepare for results
    const results = [];
    let successCount = 0;

    // 3️⃣ Loop through students
    for (let i = 0; i < students.length; i++) {
      const { name, email, rollNo, mobileNo, year } = students[i];
      const currentYear = new Date().getFullYear();
      const admissionYear = currentYear - (parseInt(year) - 1);

      try {
        // Duplicate check
        const dupCheck = await client.query(
          `SELECT id FROM students WHERE email = $1 OR roll_no = $2 OR mobile_no = $3`,
          [email, rollNo, mobileNo]
        );

        if (dupCheck.rows.length > 0) {
          results.push({
            row: i + 1,
            status: "failed",
            message: "Duplicate student (email/roll/mobile already exists)",
          });
          continue;
        }

        const passwordHash = await bcrypt.hash(mobileNo, 10);

        await client.query(
          `INSERT INTO students 
            (name, email, mobile_no, password_hash, roll_no, teacher_id, superadmin_id, admission_year, created_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            name,
            email,
            mobileNo,
            passwordHash,
            rollNo,
            teacherId,
            superadminId,
            admissionYear,
          ]
        );

        successCount++;
        results.push({ row: i + 1, status: "success" });
      } catch (err) {
        results.push({
          row: i + 1,
          status: "failed",
          message: err.message,
        });
      }
    }

    // 4️⃣ Update payment record only if some students created
    if (successCount > 0) {
      await client.query(
        `UPDATE payments 
         SET students_registered = students_registered + $1 
         WHERE id = $2`,
        [successCount, paymentId]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Bulk student creation complete.",
      total: students.length,
      success: successCount,
      failed: students.length - successCount,
      details: results,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Bulk student creation error:", error);
    return res.status(500).json({ error: "Internal server error." });
  } finally {
    client.release();
  }
};

export const getAllStudent = async (req, res) => {
  try {
    const teacherId = req.user?.id;

    if (!teacherId) {
      return sendResponse(res, {
        status: 0,
        message: "Unauthorized: Teacher ID not found.",
        httpCode: 401,
      });
    }

    const result = await pool.query(
      `SELECT id, name, roll_no, email, admission_year, mobile_no, created_at
       FROM students 
       WHERE teacher_id = $1 
       ORDER BY admission_year DESC, created_at DESC`,
      [teacherId]
    );

    // Group students by admission_year
    /* const groupedByYear = result.rows.reduce((acc, student) => {
      const year = student.admission_year;
      if (!acc[year]) {
        acc[year] = [];
      }
      acc[year].push(student);
      return acc;
    }, {}); */
    const currentYear = new Date().getFullYear();

    const groupedByStudyYear = result.rows.reduce((acc, student) => {
      const studyYear = currentYear - student.admission_year + 1;

      // Ensure it doesn't go below 1
      const validStudyYear = Math.max(1, studyYear);

      if (!acc[validStudyYear]) {
        acc[validStudyYear] = [];
      }

      acc[validStudyYear].push(student);

      return acc;
    }, {});

    return sendResponse(res, {
      status: 1,
      message: "Students grouped by year.",
      data: groupedByStudyYear,
    });
  } catch (error) {
    console.error("Get Students Error:", error);
    return sendResponse(res, {
      status: 0,
      message: "Failed to fetch students.",
      httpCode: 500,
    });
  }
};

//perfomr by student

export const loginStudent = async (req, res) => {
  const { roll, password } = req.body;
  console.log("details:", req.body);
  if (!roll || !password) {
    return res
      .status(400)
      .json({ message: "Roll number and password are required." });
  }

  try {
    // 1. Find student by roll number
    const query = `SELECT id, name, email, roll_no, password_hash,admission_year,superadmin_id FROM students WHERE roll_no = $1`;
    const result = await pool.query(query, [roll]);

    if (result.rowCount === 0) {
      return res.status(401).json({ message: "Invalid roll number" });
    }

    const student = result.rows[0];

    // 2. Check password
    const isMatch = await bcrypt.compare(password, student.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password." });
    }
    let instituteDetails = {};
    if (student.superadmin_id) {
      const instituteResult = await pool.query(
        "SELECT institute_code FROM institutes WHERE superadmin_id = $1 LIMIT 1",
        [student.superadmin_id]
      );

      if (instituteResult.rows.length > 0) {
        instituteDetails = instituteResult.rows[0];
      }
    }

    // 3. Create JWT token
    const tokenPayload = {
      id: student.id,
      rollNo: student.roll_no,
      role: "student",
      code: instituteDetails.institute_code,
      admissionYear: student.admission_year,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    // 4. Send response
    res.status(200).json({
      status: 200,
      message: "Login successful",

      data: {
        role: "student",
        token: token,
        id: student.id,
        name: student.name,
        email: student.email,
        rollNo: student.roll_no,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};
export const getStudentDetails = async (req, res) => {
  try {
    const studentId = req.user?.id; // assuming token stores student id as `id`

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "Invalid token. Student ID not found.",
      });
    }

    const result = await pool.query(
      "SELECT id,teacher_id,name,roll_no,mobile_no,signature,admission_year,email,superadmin_id FROM students WHERE id = $1",
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = result.rows[0];

    let instituteDetails = {};
    if (student.superadmin_id) {
      const instituteResult = await pool.query(
        "SELECT name, institute_code FROM institutes WHERE superadmin_id = $1 LIMIT 1",
        [student.superadmin_id]
      );

      if (instituteResult.rows.length > 0) {
        instituteDetails = instituteResult.rows[0];
      }
    }

    const admissionYear = student.admission_year;
    const currentYear = new Date().getFullYear();

    let yearOfStudy = currentYear - admissionYear + 1;

    // Ensure it doesn't exceed 4 (assuming 4-year course)
    if (yearOfStudy > 4) yearOfStudy = 4;
    if (yearOfStudy < 1) yearOfStudy = 1;

    res.status(200).json({
      success: true,
      message: "Student fetched successfully",
      data: {
        ...student,
        institute: instituteDetails,
        current_year: yearOfStudy,
        points: {
          "1st Year": { uploaded: 25, approved: 20 },
          "2nd Year": { uploaded: 30, approved: 28 },
          "3rd Year": { uploaded: 40, approved: 35 },
          "4th Year": { uploaded: 45, approved: 40 },
        },
      },
    });
  } catch (error) {
    console.error("Error fetching student:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while fetching the student.",
    });
  }
};

export const getActivityDetails = async (req, res) => {
  try {
    const student = req.user;
    const admissionYear = parseInt(student.admissionYear);
    const currentYear = new Date().getFullYear();

    // Calculate academic year difference
    const academicYearDiff = currentYear - admissionYear + 1;
    let studentData = [];
    try {
      const result = await pool.query(
        `SELECT * FROM student_activities
     WHERE student_id = $1`,
        [student.id]
      );

      studentData = result.rows;

      // console.log("Student Activity Data for Academic Year:", academicYearDiff);
      console.log(studentData);

      // Continue with your logic (e.g., res.json or further processing)
    } catch (error) {
      console.error("Error fetching student activity data:", error);
    }
    /* const generateStudentYearlyDetails =()=>{
  let yearlyTemplete  = generateYearlyMaxObject();



  return yearlyTemplete;
} */
    // Generate default template for all years with all max fields = 0
    // Step 1: Define all serial keys
    const serialKeys = [
      "1a",
      "1b",
      "1c",
      "1d",
      "2a",
      "2b",
      "3",
      "4",
      "5a",
      "5b",
      "6",
      "7",
      "8",
      "9",
      "10a",
      "10b",
      "11a",
      "11b",
      "11c",
      "11d",
      "11e",
      "11f",
      "12",
      "13",
      "14",
      "15a",
      "15b",
      "15c",
      "15d",
      "15e",
      "15f",
    ];

    // Step 2: Create a base object with all sum fields
    function generateBaseSumObject() {
      const obj = {};
      serialKeys.forEach((key) => {
        obj[`sum_${key}`] = 0;
      });
      return obj;
    }

    // Step 3: Generate yearwise structure
    function generateYearwiseSumStructure() {
      return {
        firstyear: generateBaseSumObject(),
        secondyear: generateBaseSumObject(),
        thirdyear: generateBaseSumObject(),
        fourthyear: generateBaseSumObject(),
      };
    }

    // Step 4: Main function to process and accumulate data
    function generateStudentYearlyDetails() {
      const result = generateYearwiseSumStructure();

      const yearMap = {
        1: "firstyear",
        2: "secondyear",
        3: "thirdyear",
        4: "fourthyear",
      };

      // Build year-wise point collection
      const yearWisePoints = {};

      studentData.forEach(({ academic_year, activity_serial_no, point }) => {
        const year = Number(academic_year);
        const key = `sum_${activity_serial_no?.toLowerCase()}`;

        if (!yearMap[year]) return; // skip if year is not 1-4

        if (!yearWisePoints[year]) yearWisePoints[year] = {};
        if (!yearWisePoints[year][key]) yearWisePoints[year][key] = 0;

        yearWisePoints[year][key] += Number(point || 0);
      });

      // Accumulate data year by year
      for (let yr = 1; yr <= 4; yr++) {
        const cumulative = {};

        for (let y = 1; y <= yr; y++) {
          const yearData = yearWisePoints[y] || {};
          for (let key in yearData) {
            if (!cumulative[key]) cumulative[key] = 0;
            cumulative[key] += yearData[key];
          }
        }

        const yearKey = yearMap[yr];
        for (let key of serialKeys.map((k) => `sum_${k}`)) {
          result[yearKey][key] = cumulative[key] || 0;
        }
      }

      return result;
    }

    if (academicYearDiff === 1 && (!studentData || studentData.length === 0)) {
      studentData = {
        firstyear: [
          {
            name: "MOOCS",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30,
            already_acquired: 0,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60,
            already_acquired: 0,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16,
                already_acquired: 0,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24,
                already_acquired: 0,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
        ],
        secondyear: [],
        thirdyear: [],
        fourthyear: [],
      };
    } else if (
      academicYearDiff === 2 &&
      (!studentData || studentData.length === 0)
    ) {
      studentData = {
        firstyear: [],
        secondyear: [
          {
            name: "MOOCS",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30,
            already_acquired: 0,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60,
            already_acquired: 0,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16,
                already_acquired: 0,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24,
                already_acquired: 0,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
        ],
        thirdyear: [],
        fourthyear: [],
      };
    } else if (
      academicYearDiff === 3 &&
      (!studentData || studentData.length === 0)
    ) {
      studentData = {
        firstyear: [],
        secondyear: [],
        thirdyear: [
          {
            name: "MOOCS",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30,
            already_acquired: 0,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60,
            already_acquired: 0,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16,
                already_acquired: 0,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24,
                already_acquired: 0,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
        ],
        fourthyear: [],
      };
    } else if (
      academicYearDiff === 4 &&
      (!studentData || studentData.length === 0)
    ) {
      studentData = {
        firstyear: [],
        secondyear: [],
        thirdyear: [],
        fourthyear: [
          {
            name: "MOOCS",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10,
            already_acquired: 0,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain: 40,
            already_acquired: 0,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30,
            already_acquired: 0,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60,
            already_acquired: 0,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16,
                already_acquired: 0,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24,
                already_acquired: 0,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20,
            already_acquired: 0,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10,
                already_acquired: 0,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20,
                already_acquired: 0,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40,
                already_acquired: 0,
              },
            ],
          },
        ],
      };
    } else {
      let yeardata = generateStudentYearlyDetails();
      studentData = {
        firstyear: [
          {
            name: "MOOCS",
            max: 40,
            remain:
              40 -
              ((yeardata?.firstyear?.sum_1a || 0) +
                (yeardata?.firstyear?.sum_1b || 0) +
                (yeardata?.firstyear?.sum_1c || 0) +
                (yeardata?.firstyear?.sum_1d || 0)),
            already_acquired:
              (yeardata?.firstyear?.sum_1a || 0) +
              (yeardata?.firstyear?.sum_1b || 0) +
              (yeardata?.firstyear?.sum_1c || 0) +
              (yeardata?.firstyear?.sum_1d || 0),
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.firstyear?.sum_2a,
                already_acquired: yeardata?.firstyear?.sum_2a,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6 - yeardata?.firstyear?.sum_2b,
                already_acquired: yeardata?.firstyear?.sum_2b,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10 - yeardata?.firstyear?.sum_3,
            already_acquired: yeardata?.firstyear?.sum_3,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10 - yeardata?.firstyear?.sum_4,
            already_acquired: yeardata?.firstyear?.sum_4,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain:
              40 - (yeardata?.firstyear?.sum_5a + yeardata?.firstyear?.sum_5b),
            already_acquired:
              yeardata?.firstyear?.sum_5a + yeardata?.firstyear?.sum_5b,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.firstyear?.sum_6,
            already_acquired: yeardata?.firstyear?.sum_6,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.firstyear?.sum_7,
            already_acquired: yeardata?.firstyear?.sum_7,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30 - yeardata?.firstyear?.sum_8,
            already_acquired: yeardata?.firstyear?.sum_8,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60 - yeardata?.firstyear?.sum_9,
            already_acquired: yeardata?.firstyear?.sum_9,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16 - yeardata?.firstyear?.sum_10a,
                already_acquired: yeardata?.firstyear?.sum_10a,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_10b,
                already_acquired: yeardata?.firstyear?.sum_10b,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_11a,
                already_acquired: yeardata?.firstyear?.sum_11a,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.firstyear?.sum_11b,
                already_acquired: yeardata?.firstyear?.sum_11b,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_11c,
                already_acquired: yeardata?.firstyear?.sum_11c,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24 - yeardata?.firstyear?.sum_11d,
                already_acquired: yeardata?.firstyear?.sum_11d,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_11e,
                already_acquired: yeardata?.firstyear?.sum_11e,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.firstyear?.sum_11f,
                already_acquired: yeardata?.firstyear?.sum_11f,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.firstyear?.sum_12,
            already_acquired: yeardata?.firstyear?.sum_12,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.firstyear?.sum_13,
            already_acquired: yeardata?.firstyear?.sum_13,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.firstyear?.sum_14,
            already_acquired: yeardata?.firstyear?.sum_14,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_15a,
                already_acquired: yeardata?.firstyear?.sum_15a,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.firstyear?.sum_15b,
                already_acquired: yeardata?.firstyear?.sum_15b,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_15c,
                already_acquired: yeardata?.firstyear?.sum_15c,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.firstyear?.sum_15d,
                already_acquired: yeardata?.firstyear?.sum_15d,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.firstyear?.sum_15e,
                already_acquired: yeardata?.firstyear?.sum_15e,
              },
            ],
          },
        ],
        secondyear: [
          {
            name: "MOOCS",
            max: 40,
            remain:
              40 -
              ((yeardata?.secondyear?.sum_1a || 0) +
                (yeardata?.secondyear?.sum_1b || 0) +
                (yeardata?.secondyear?.sum_1c || 0) +
                (yeardata?.secondyear?.sum_1d || 0)),
            already_acquired:
              (yeardata?.secondyear?.sum_1a || 0) +
              (yeardata?.secondyear?.sum_1b || 0) +
              (yeardata?.secondyear?.sum_1c || 0) +
              (yeardata?.secondyear?.sum_1d || 0),
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.secondyear?.sum_2a,
                already_acquired: yeardata?.secondyear?.sum_2a,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6 - yeardata?.secondyear?.sum_2b,
                already_acquired: yeardata?.secondyear?.sum_2b,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10 - yeardata?.secondyear?.sum_3,
            already_acquired: yeardata?.secondyear?.sum_3,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10 - yeardata?.secondyear?.sum_4,
            already_acquired: yeardata?.secondyear?.sum_4,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain:
              40 -
              (yeardata?.secondyear?.sum_5a + yeardata?.secondyear?.sum_5b),
            already_acquired:
              yeardata?.secondyear?.sum_5a + yeardata?.secondyear?.sum_5b,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.secondyear?.sum_6,
            already_acquired: yeardata?.secondyear?.sum_6,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.secondyear?.sum_7,
            already_acquired: yeardata?.secondyear?.sum_7,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30 - yeardata?.secondyear?.sum_8,
            already_acquired: yeardata?.secondyear?.sum_8,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60 - yeardata?.secondyear?.sum_9,
            already_acquired: yeardata?.secondyear?.sum_9,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16 - yeardata?.secondyear?.sum_10a,
                already_acquired: yeardata?.secondyear?.sum_10a,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_10b,
                already_acquired: yeardata?.secondyear?.sum_10b,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_11a,
                already_acquired: yeardata?.secondyear?.sum_11a,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.secondyear?.sum_11b,
                already_acquired: yeardata?.secondyear?.sum_11b,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_11c,
                already_acquired: yeardata?.secondyear?.sum_11c,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24 - yeardata?.secondyear?.sum_11d,
                already_acquired: yeardata?.secondyear?.sum_11d,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_11e,
                already_acquired: yeardata?.secondyear?.sum_11e,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.secondyear?.sum_11f,
                already_acquired: yeardata?.secondyear?.sum_11f,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.secondyear?.sum_12,
            already_acquired: yeardata?.secondyear?.sum_12,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.secondyear?.sum_13,
            already_acquired: yeardata?.secondyear?.sum_13,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.secondyear?.sum_14,
            already_acquired: yeardata?.secondyear?.sum_14,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_15a,
                already_acquired: yeardata?.secondyear?.sum_15a,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.secondyear?.sum_15b,
                already_acquired: yeardata?.secondyear?.sum_15b,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_15c,
                already_acquired: yeardata?.secondyear?.sum_15c,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.secondyear?.sum_15d,
                already_acquired: yeardata?.secondyear?.sum_15d,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.secondyear?.sum_15e,
                already_acquired: yeardata?.secondyear?.sum_15e,
              },
            ],
          },
        ],
        thirdyear: [
          {
            name: "MOOCS",
            max: 40,
            remain:
              40 -
              ((yeardata?.thirdyear?.sum_1a || 0) +
                (yeardata?.thirdyear?.sum_1b || 0) +
                (yeardata?.thirdyear?.sum_1c || 0) +
                (yeardata?.thirdyear?.sum_1d || 0)),
            already_acquired:
              (yeardata?.thirdyear?.sum_1a || 0) +
              (yeardata?.thirdyear?.sum_1b || 0) +
              (yeardata?.thirdyear?.sum_1c || 0) +
              (yeardata?.thirdyear?.sum_1d || 0),
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.thirdyear?.sum_2a,
                already_acquired: yeardata?.thirdyear?.sum_2a,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6 - yeardata?.thirdyear?.sum_2b,
                already_acquired: yeardata?.thirdyear?.sum_2b,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10 - yeardata?.thirdyear?.sum_3,
            already_acquired: yeardata?.thirdyear?.sum_3,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10 - yeardata?.thirdyear?.sum_4,
            already_acquired: yeardata?.thirdyear?.sum_4,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain:
              40 - (yeardata?.thirdyear?.sum_5a + yeardata?.thirdyear?.sum_5b),
            already_acquired:
              yeardata?.thirdyear?.sum_5a + yeardata?.thirdyear?.sum_5b,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.thirdyear?.sum_6,
            already_acquired: yeardata?.thirdyear?.sum_6,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.thirdyear?.sum_7,
            already_acquired: yeardata?.thirdyear?.sum_7,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30 - yeardata?.thirdyear?.sum_8,
            already_acquired: yeardata?.thirdyear?.sum_8,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60 - yeardata?.thirdyear?.sum_9,
            already_acquired: yeardata?.thirdyear?.sum_9,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16 - yeardata?.thirdyear?.sum_10a,
                already_acquired: yeardata?.thirdyear?.sum_10a,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_10b,
                already_acquired: yeardata?.thirdyear?.sum_10b,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_11a,
                already_acquired: yeardata?.thirdyear?.sum_11a,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.thirdyear?.sum_11b,
                already_acquired: yeardata?.thirdyear?.sum_11b,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_11c,
                already_acquired: yeardata?.thirdyear?.sum_11c,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24 - yeardata?.thirdyear?.sum_11d,
                already_acquired: yeardata?.thirdyear?.sum_11d,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_11e,
                already_acquired: yeardata?.thirdyear?.sum_11e,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.thirdyear?.sum_11f,
                already_acquired: yeardata?.thirdyear?.sum_11f,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.thirdyear?.sum_12,
            already_acquired: yeardata?.thirdyear?.sum_12,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.thirdyear?.sum_13,
            already_acquired: yeardata?.thirdyear?.sum_13,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.thirdyear?.sum_14,
            already_acquired: yeardata?.thirdyear?.sum_14,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_15a,
                already_acquired: yeardata?.thirdyear?.sum_15a,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.thirdyear?.sum_15b,
                already_acquired: yeardata?.thirdyear?.sum_15b,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_15c,
                already_acquired: yeardata?.thirdyear?.sum_15c,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.thirdyear?.sum_15d,
                already_acquired: yeardata?.thirdyear?.sum_15d,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.thirdyear?.sum_15e,
                already_acquired: yeardata?.thirdyear?.sum_15e,
              },
            ],
          },
        ],
        fourthyear: [
          {
            name: "MOOCS",
            max: 40,
            remain:
              40 -
              ((yeardata?.fourthyear?.sum_1a || 0) +
                (yeardata?.fourthyear?.sum_1b || 0) +
                (yeardata?.fourthyear?.sum_1c || 0) +
                (yeardata?.fourthyear?.sum_1d || 0)),
            already_acquired:
              (yeardata?.fourthyear?.sum_1a || 0) +
              (yeardata?.fourthyear?.sum_1b || 0) +
              (yeardata?.fourthyear?.sum_1c || 0) +
              (yeardata?.fourthyear?.sum_1d || 0),
            subpoints: [
              { name: "10 weeks", point_per_activity: 20 },
              { name: "8 weeks", point_per_activity: 15 },
              { name: "4 weeks", point_per_activity: 10 },
              { name: "2 weeks", point_per_activity: 5 },
            ],
          },
          {
            name: "Tech Fest",
            subpoints: [
              {
                name: "Organizer",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.fourthyear?.sum_2a,
                already_acquired: yeardata?.fourthyear?.sum_2a,
              },
              {
                name: "Participant",
                point_per_activity: 3,
                max: 6,
                remain: 6 - yeardata?.fourthyear?.sum_2b,
                already_acquired: yeardata?.fourthyear?.sum_2b,
              },
            ],
          },
          {
            name: "Rural Reporting",
            point_per_activity: 5,
            max: 10,
            remain: 10 - yeardata?.fourthyear?.sum_3,
            already_acquired: yeardata?.fourthyear?.sum_3,
          },
          {
            name: "Tree Plantation",
            point_per_activity: 1,
            max: 10,
            remain: 10 - yeardata?.fourthyear?.sum_4,
            already_acquired: yeardata?.fourthyear?.sum_4,
          },
          {
            name: "Relief & Charitable Activities",
            max: 40,
            remain:
              40 -
              (yeardata?.fourthyear?.sum_5a + yeardata?.fourthyear?.sum_5b),
            already_acquired:
              yeardata?.fourthyear?.sum_5a + yeardata?.fourthyear?.sum_5b,
            subpoints: [
              {
                name: "Collection of Fund",
                point_per_activity: 5,
              },
              {
                name: "Relief Work Team",
                point_per_activity: 20,
              },
            ],
          },
          {
            name: "Participation in Debate",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.fourthyear?.sum_6,
            already_acquired: yeardata?.fourthyear?.sum_6,
          },
          {
            name: "Publication",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.fourthyear?.sum_7,
            already_acquired: yeardata?.fourthyear?.sum_7,
          },
          {
            name: "Research Publication",
            point_per_activity: 15,
            max: 30,
            remain: 30 - yeardata?.fourthyear?.sum_8,
            already_acquired: yeardata?.fourthyear?.sum_8,
          },
          {
            name: "Innovation Project",
            point_per_activity: 30,
            max: 60,
            remain: 60 - yeardata?.fourthyear?.sum_9,
            already_acquired: yeardata?.fourthyear?.sum_9,
          },
          {
            name: "Blood Donation",
            subpoints: [
              {
                name: "Donate Blood",
                point_per_activity: 8,
                max: 16,
                remain: 16 - yeardata?.fourthyear?.sum_10a,
                already_acquired: yeardata?.fourthyear?.sum_10a,
              },
              {
                name: "Organize Blood Donation Camp",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_10b,
                already_acquired: yeardata?.fourthyear?.sum_10b,
              },
            ],
          },
          {
            name: "Sports",
            subpoints: [
              {
                name: "Personal",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_11a,
                already_acquired: yeardata?.fourthyear?.sum_11a,
              },
              {
                name: "College",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.fourthyear?.sum_11b,
                already_acquired: yeardata?.fourthyear?.sum_11b,
              },
              {
                name: "University",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_11c,
                already_acquired: yeardata?.fourthyear?.sum_11c,
              },
              {
                name: "District",
                point_per_activity: 12,
                max: 24,
                remain: 24 - yeardata?.fourthyear?.sum_11d,
                already_acquired: yeardata?.fourthyear?.sum_11d,
              },
              {
                name: "Other",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_11e,
                already_acquired: yeardata?.fourthyear?.sum_11e,
              },
              {
                name: "National",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.fourthyear?.sum_11f,
                already_acquired: yeardata?.fourthyear?.sum_11f,
              },
            ],
          },
          {
            name: "Activities in a Professional Society/Student Chapter",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.fourthyear?.sum_12,
            already_acquired: yeardata?.fourthyear?.sum_12,
          },
          {
            name: "Relevant Industry Visit & Report",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.fourthyear?.sum_13,
            already_acquired: yeardata?.fourthyear?.sum_13,
          },
          {
            name: "Community Service & Allied Activities",
            point_per_activity: 10,
            max: 20,
            remain: 20 - yeardata?.fourthyear?.sum_14,
            already_acquired: yeardata?.fourthyear?.sum_14,
          },
          {
            name: "Self-Entrepreneurship",
            subpoints: [
              {
                name: "Organise Entrepreneurship Programmes",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_15a,
                already_acquired: yeardata?.fourthyear?.sum_15a,
              },
              {
                name: "Take Part in Entrepreneurship",
                point_per_activity: 5,
                max: 10,
                remain: 10 - yeardata?.fourthyear?.sum_15b,
                already_acquired: yeardata?.fourthyear?.sum_15b,
              },
              {
                name: "Film Making",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_15c,
                already_acquired: yeardata?.fourthyear?.sum_15c,
              },
              {
                name: "Submit Business Plan",
                point_per_activity: 10,
                max: 20,
                remain: 20 - yeardata?.fourthyear?.sum_15d,
                already_acquired: yeardata?.fourthyear?.sum_15d,
              },
              {
                name: "Work for Start-up",
                point_per_activity: 20,
                max: 40,
                remain: 40 - yeardata?.fourthyear?.sum_15e,
                already_acquired: yeardata?.fourthyear?.sum_15e,
              },
            ],
          },
        ],
      };
    }

    return res.status(200).json({
      success: true,
      message: "Academic activity calculated",
      data: {
        rollNo: student.rollNo,
        admissionYear,
        studentData,
      },
    });
  } catch (err) {
    console.error("Error in getActivityDetails:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const activitySubmitByStudent = async (req, res) => {
  try {
    console.log("Logged in student:", req.user);

    const { formData, totalPoint } = req.body;
    const studentId = req.user.id;
    const admissionYear = parseInt(req.user.admissionYear);
    const currentYear = new Date().getFullYear();
    const academicYear = currentYear - admissionYear + 1;

    const matchedFields = [];

    for (const [key, value] of Object.entries(formData)) {
      const numericValue = Number(value);
      if (
        numericValue > 0 &&
        key in initialStudentActivityFormData &&
        typeof initialStudentActivityFormData[key] === "object"
      ) {
        const activity = initialStudentActivityFormData[key];
        const fileKey = `${key}File`;
        const documentUrl = formData[fileKey] || null;
        matchedFields.push({
          key,
          value: numericValue,
          details: activity,
          documentUrl,
        });

        // Insert each matched activity into the student_activities table
        await pool.query(
          `INSERT INTO student_activities 
            (student_id, academic_year, activity_serial_no, activity_name, point, is_active, is_verified,document_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7 ,$8)`,
          [
            studentId,
            academicYear,
            activity.serilaNo,
            activity.activityName,
            numericValue,
            true, // is_active
            false, // is_verified
            documentUrl,
          ]
        );
      }
    }

    res.status(200).json({
      message: "Activities submitted successfully",
      matchedFields,
      totalPoint,
    });
  } catch (error) {
    console.error("Error in activitySubmitByStudent:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getYearlyStudentDetails = async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Get teacher signature
    const teacherRes = await pool.query(
      `SELECT signature FROM teachers WHERE id = $1`,
      [teacherId]
    );
    const teacherSignature = teacherRes.rows?.[0]?.signature || null;

    // Get all students under the teacher
    const studentsRes = await pool.query(
      `
      SELECT s.id, s.name, s.roll_no, s.mobile_no, s.signature, s.email, s.admission_year
      FROM students s
      WHERE s.teacher_id = $1
      `,
      [teacherId]
    );

    const currentYear = dayjs().year();

    // Initialize result structure
    const result = {
      teacherSignature,
      firstYear: { students: [], stats: {} },
      secondYear: { students: [], stats: {} },
      thirdYear: { students: [], stats: {} },
      fourthYear: { students: [], stats: {} },
    };

    // Helper to map year index to label
    const yearMap = ["firstYear", "secondYear", "thirdYear", "fourthYear"];

    // Temporary grouping for stats
    const tempStats = {
      firstYear: [],
      secondYear: [],
      thirdYear: [],
      fourthYear: [],
    };

    for (const student of studentsRes.rows) {
      const academicYear = currentYear - student.admission_year;

      if (academicYear >= 0 && academicYear <= 3) {
        const academicYearLabel = yearMap[academicYear];

        const activitiesRes = await pool.query(
          `SELECT * FROM student_activities WHERE student_id = $1 AND academic_year = $2`,
          [student.id, academicYear + 1] // academic_year is 1-based
        );

        const activities = activitiesRes.rows || [];

        const hasSubmitted = activities.length > 0;
        const isFullyVerified =
          hasSubmitted && activities.every((act) => act.is_verified === true);

        const studentData = {
          ...student,
          activities,
          ...(isFullyVerified ? { status: true } : { status: false }), // add status: true if fully verified
        };

        // Store the student in the year group
        result[academicYearLabel].students.push(studentData);

        // Push metadata for stats
        tempStats[academicYearLabel].push({
          hasSubmitted,
          isFullyVerified,
        });
      }
    }

    // Now calculate stats per year
    for (const yearLabel of yearMap) {
      const yearStats = tempStats[yearLabel];
      const totalStudents = yearStats.length;
      const totalSubmitted = yearStats.filter((s) => s.hasSubmitted).length;
      const totalNotSubmitted = totalStudents - totalSubmitted;
      const totalFullyVerified = yearStats.filter(
        (s) => s.isFullyVerified
      ).length;
      const totalNotVerified = totalSubmitted - totalFullyVerified;

      result[yearLabel].stats = {
        totalStudents,
        totalSubmitted,
        totalNotSubmitted,
        totalFullyVerified,
        totalNotVerified,
      };
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error in getYearlyStudentDetails:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const deleteStudentDetails = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ message: "Missing student activity ID in payload." });
    }

    // Step 1: Get current is_active value
    const { rows } = await pool.query(
      `SELECT is_active FROM student_activities WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Student activity not found." });
    }

    const currentStatus = rows[0].is_active;

    // Step 2: Toggle the status
    const updatedRes = await pool.query(
      `UPDATE student_activities SET is_active = $1 WHERE id = $2 RETURNING *`,
      [!currentStatus, id]
    );

    return res.status(200).json({
      message: `Student activity status updated to ${!currentStatus}`,
      data: updatedRes.rows[0],
    });
  } catch (error) {
    console.error("Error toggling student activity status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const verifyStudentDetails = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No IDs provided" });
    }

    // Update all matching rows
    const result = await pool.query(
      `
      UPDATE student_activities
      SET is_verified = true
      WHERE id = ANY($1::int[])
      RETURNING *;
      `,
      [ids]
    );

    res.status(200).json({
      message: "Selected Activities Verified Successfully!",
    });
  } catch (error) {
    console.error("Error verifying student activities:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const uploadStudentSignature = async (req, res) => {
  try {
    const studentId = req.user?.id;
    const signature = req.signature;
    console.log("id and signatue:,", student);

    // Update signature URL in DB
    await pool.query("UPDATE students SET signature = $1 WHERE id = $2", [
      signature,
      studentId,
    ]);

    res.status(200).json({
      success: true,
      message: "Signature Uploaded Successfully",
    });
  } catch (err) {
    console.error("Error uploading signature:", err);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};

export const uploadIndividualFile = async (req, res) => {
  try {
    console.log("Uploaded file info:", req.file); // S3 file details
    console.log("Field Name:", req.body.fieldName); // tells which form field

    // Save only the file URL in DB if required
    const fileUrl = req.file.location; // multer-s3 provides this

    res.json({ success: true, fileUrl, fieldName: req.body.fieldName });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteStudentFile = async (req, res) => {
  try {
    const { fieldName, fileUrl } = req.body;
    console.log("file name is delte::", req.body);

    if (!fileUrl) {
      return res
        .status(400)
        .json({ success: false, message: "File URL is required" });
    }

    // Call the utility function
    await deleteFileFromS3(fileUrl);

    // TODO: optional DB update: set fieldName = NULL for that student
    // await db.query("UPDATE student_activity SET ?? = NULL WHERE id = ?", [fieldName, req.user.id]);

    return res.json({
      success: true,
      fieldName,
      fileUrl,
      message: "File deleted successfully from S3",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
