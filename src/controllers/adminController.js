// src/controllers/adminController.ts

import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export const adminLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res
        .status(400)
        .json({ message: "Phone and password are required" });
    }

    // Fetch admin from DB
    const result = await pool.query(
      "SELECT id, phone, password_hash, name FROM administrators WHERE phone = $1",
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid phone or password" });
    }

    const admin = result.rows[0];

    // ⚠️ Only comparing plain text password (not using bcrypt)
    if (admin.password_hash !== password) {
      return res.status(401).json({ message: "Invalid phone or password" });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: admin.id, phone: admin.phone },
      process.env.JWT_SECRET || "your_secure_secret_key", // keep secret in .env
      { expiresIn: "1h" }
    );

    return res.json({
      message: "Login successful",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        phone: admin.phone,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getSuperadmins = async (req, res) => {
  try {
    // ✅ Fetch superadmins data
    const result = await pool.query("SELECT id, name, email FROM superadmins");

    return res.status(200).json({
      message: "Superadmins fetched successfully",
      data: result.rows,
    });
  } catch (dbError) {
    console.error("DB Error:", dbError);
    return res.status(500).json({ message: "Database error" });
  }
};

export const getAllPayment = async (req, res) => {
  try {
    // ✅ Fetch superadmins data
    const result = await pool.query("SELECT * FROM payments");

    return res.status(200).json({
      message: "Payments fetched successfully",
      data: result.rows,
    });
  } catch (dbError) {
    console.error("DB Error:", dbError);
    return res.status(500).json({ message: "Database error" });
  }
};
