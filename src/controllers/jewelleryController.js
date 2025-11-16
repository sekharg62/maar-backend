const router = express.Router();
import express from "express";

import pool from "../config/db.js";
export const createJewellery = async (req, res) => {
  try {
    const { name, description, actualPrice, category, image, offerPrice } =
      req.body;
    const jewellery = await pool.query(
      "INSERT INTO jewellery (name, description, actual_price, category, file_url, offer_price) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [name, description, actualPrice, category, image, offerPrice]
    );
    res
      .status(201)
      .json({ success: true, message: "Jewellery added successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAllJewellery = async (req, res) => {
  try {
    const jewellery = await pool.query("SELECT * FROM jewellery");
    res
      .status(200)
      .json({
        data: jewellery.rows,
        success: true,
        message: "Jewellery fetched successfully",
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getJewelleryById = async (req, res) => {
  try {
    const { id } = req.params;
    const jewellery = await pool.query(
      "SELECT * FROM jewellery WHERE id = $1",
      [id]
    );
    res.status(200).json(jewellery.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateJewellery = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price } = req.body;
    const jewellery = await pool.query(
      "UPDATE jewellery SET name = $1, description = $2, price = $3 WHERE id = $4 RETURNING *",
      [name, description, price, id]
    );
    res.status(200).json(jewellery.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteJewellery = async (req, res) => {
  try {
    const { id } = req.params;
    const jewellery = await pool.query(
      "DELETE FROM jewellery WHERE id = $1 RETURNING *",
      [id]
    );
    res.status(200).json(jewellery.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export default router;
