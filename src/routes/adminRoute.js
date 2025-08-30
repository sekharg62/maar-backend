// routes/adminRoutes.ts
import express from "express";

import { adminLogin, getSuperadmins } from "../controllers/adminController.js";
import verifyToken from "../middlewares/verifyToken.js";
const router = express.Router();

// Admin login route
router.post("/login", adminLogin);
router.get("/getSuperAdmins",verifyToken,getSuperadmins)

export default router;
