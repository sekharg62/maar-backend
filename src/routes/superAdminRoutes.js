import express from "express";
import verifyToken from "../middlewares/verifyToken.js";
import {
  createPaymentBySuperadmin,
  getDepartments,
  getSuperadminDetails,
  loginSuperadmin,
  registerSuperadmin,
} from "../controllers/superAdminController.js";

const router = express.Router();

router.post("/register", registerSuperadmin);
router.post("/login", loginSuperadmin);
//router.post("/resetPassword", resetPassword);
router.get("/getDetails", verifyToken, getSuperadminDetails);

router.post("/createPayment", verifyToken, createPaymentBySuperadmin);

router.get("/getAllDepartments", getDepartments);

export default router;
