import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import verifyToken from "../middlewares/verifyToken.js"; // Add `.js` extension
import sendResponse from "../utils/sendResponse.js";
import dotenv from "dotenv";
import { createPaytmPayment } from "../services/createPaymentPayment.js";
dotenv.config();
const router = express.Router();

export const registerSuperadmin = async (req, res) => {
  const { name, email, password, college_name, college_code } = req.body;

  const client = await pool.connect();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existingEmail = await client.query(
      "SELECT 1 FROM superadmins WHERE email = $1",
      [email]
    );

    if (existingEmail.rows.length > 0) {
      return sendResponse(res, {
        status: 0,
        message: "Email already exists",
        httpCode: 400,
      });
    }

    const existingInstitute = await client.query(
      "SELECT * FROM institutes WHERE name = $1 OR institute_code = $2",
      [college_name, college_code]
    );

    if (existingInstitute.rows.length > 0) {
      const existing = existingInstitute.rows[0];

      if (existing.name === college_name) {
        return sendResponse(res, {
          status: 0,
          message: "Institute name already exists",
          httpCode: 400,
        });
      }

      if (existing.institute_code === college_code) {
        return sendResponse(res, {
          status: 0,
          message: "Institute code already exists",
          httpCode: 400,
        });
      }
    }
    await client.query("BEGIN");

    // Insert superadmin and institute
    const result = await client.query(
      `WITH new_superadmin AS (
         INSERT INTO superadmins (name, email, hashed_password)
         VALUES ($1, $2, $3)
         RETURNING id
       )
       INSERT INTO institutes (name, institute_code, superadmin_id, created_at)
       VALUES ($4, $5, (SELECT id FROM new_superadmin), NOW())
       RETURNING id, name AS institute_name, institute_code, superadmin_id;`,
      [name, email, hashedPassword, college_name, college_code]
    );

    const institute = result.rows[0];

    // Insert default payment record
    const amountPaid = 0;
    const studentQuota = 100;
    const paidOn = new Date();
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 4);

    await client.query(
      `INSERT INTO payments (
         institute_id, amount_paid, student_quota, students_registered, paid_on, valid_until
       )
       VALUES ($1, $2, $3, DEFAULT, $4, $5);`,
      [institute.id, amountPaid, studentQuota, paidOn, validUntil]
    );

    await client.query("COMMIT");

    return sendResponse(res, {
      status: 201,
      message: "Registration successful. You may now log in.",
      data: institute,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return sendResponse(res, {
      status: 0,
      message: "Server error",
      data: err.message,
      httpCode: 500,
    });
  } finally {
    client.release();
  }
};

export const loginSuperadmin = async (req, res) => {
  const { email, password } = req.body;
  //console.log("login",req.body)
  try {
    const result = await pool.query(
      "SELECT * FROM superadmins WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid email" });
    }

    const valid = await bcrypt.compare(
      password,
      result.rows[0].hashed_password
    );
    if (!valid) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    return sendResponse(res, {
      status: 200,
      role: "superadmin",
      message: "Login successfully",
      data: { token, role: "superadmin" },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getSuperadminDetails = async (req, res) => {
  const superadminId = req.user.id; // Extracted from token

  try {
    // 1. Get superadmin details
    const superadmin = await pool.query(
      "SELECT id, name, email, created_at, updated_at FROM superadmins WHERE id = $1",
      [superadminId]
    );

    // 2. Get associated institute(s)
    const institute = await pool.query(
      "SELECT * FROM institutes WHERE superadmin_id = $1",
      [superadminId]
    );

    // 3. Get payment details
    const payment = await pool.query(
      "SELECT id,amount_paid,student_quota,students_registered,paid_on,valid_until,created_at,updated_at,is_approve,schreenshot_url FROM payments WHERE institute_id = $1",
      [institute.rows[0]?.id]
    );

    // 4. Get all teachers under this institute
    const teachers = await pool.query(
      `SELECT id, name, email, mobile_no, signature, department, created_at, updated_at
   FROM teachers
   WHERE superadmin_id = $1`,
      [superadminId]
    );

    return sendResponse(res, {
      status: 1,
      message: "Details fetched",
      data: {
        superadmin: superadmin.rows[0],
        institute: institute.rows[0],
        payment: payment.rows,
        teachers: teachers.rows,
      },
    });
  } catch (err) {
    return sendResponse(res, {
      status: 0,
      message: "Server error",
      data: err.message,
      httpCode: 500,
    });
  }
};

export const createPaymentBySuperadmin = async (req, res) => {
  try {
    const superadminId = req.user.id;
    const { amount } = req.body;

    if (!superadminId || !amount) {
      return res
        .status(400)
        .json({ message: "Missing superadmin ID or amount" });
    }

    const paymentData = await createPaytmPayment(superadminId, amount);
    return res.json({ payUrl: paymentData.paytmUrl });
  } catch (error) {
    console.error("Error creating payment:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const newPayment = async (req, res) => {
  try {
    const superadminId = req.user.id;
    const {
      student_quota,
      transaction_id,
      schreenshot_url,
      amount_paid,
      email,
    } = req.body;

    // 1️⃣ Find the institute linked to this superadmin
    const instituteResult = await pool.query(
      "SELECT id FROM institutes WHERE superadmin_id = $1 LIMIT 1",
      [superadminId]
    );

    if (instituteResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No institute found for this superadmin",
      });
    }

    const instituteId = instituteResult.rows[0].id;

    // 2️⃣ Calculate dates
    const paidOn = new Date();
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 4);

    // 3️⃣ Insert into payments table
    const insertQuery = `
      INSERT INTO payments (
        student_quota,
        transaction_id,
        schreenshot_url,
        amount_paid,
        email,
        paid_on,
        valid_until,
        payment_by,
        institute_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING *;
    `;

    const insertValues = [
      student_quota,
      transaction_id,
      schreenshot_url,
      amount_paid,
      email,
      paidOn,
      validUntil,
      superadminId,
      instituteId,
    ];

    const result = await pool.query(insertQuery, insertValues);

    res.status(201).json({
      success: true,
      message: "Payment added successfully",
      payment: result.rows[0],
    });
  } catch (error) {
    console.error("Error adding payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create payment record",
      error: error.message,
    });
  }
};

export const getDepartments = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM departments ORDER BY name ASC"
    );
    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching departments",
    });
  }
};
