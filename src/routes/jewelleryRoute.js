import express from "express";
import {
  createJewellery,
  deleteJewellery,
  getAllJewellery,
  getJewelleryById,
  updateJewellery,
} from "../controllers/jewelleryController.js";

const router = express.Router();

router.post("/create", createJewellery);
router.get("/get-all", getAllJewellery);
router.get("/get-by-id/:id", getJewelleryById);
router.put("/update/:id", updateJewellery);
router.delete("/delete/:id", deleteJewellery);

export default router;
