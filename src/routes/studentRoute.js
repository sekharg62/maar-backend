// routes/teacherRoutes.js
import express from "express";
import {
  activitySubmitByStudent,
  createStudentIndividual,
  createStudentsBulk,
  deleteStudentDetails,
  deleteStudentFile,
  getActivityDetails,
  getAllStudent,
  getStudentDetails,
  getYearlyStudentDetails,
  loginStudent,
  uploadIndividualFile,
  uploadStudentSignature,
  verifyStudentDetails,
} from "../controllers/studentController.js";
import verifyToken from "../middlewares/verifyToken.js";
import {
  uploadStudentActivityS3,
  uploadStudentSignatureS3,
} from "../config/s3.js";

const router = express.Router();

router.post("/create", verifyToken, createStudentIndividual);
router.post("/create/many", verifyToken, createStudentsBulk);
router.get("/getAllStudents", verifyToken, getAllStudent);
router.get("/getYearlyDetails", verifyToken, getYearlyStudentDetails);
router.post("/detailsVerified", verifyToken, verifyStudentDetails);
router.post("/detailsDelete", verifyToken, deleteStudentDetails);

//perform by student

// Student Auth & Profile
router.post("/loginStudent", loginStudent);
router.get("/getDetails", verifyToken, getStudentDetails);
router.get("/getActivityDetails", verifyToken, getActivityDetails);
/* router.post("/resetPassword", resetStudentPassword); */

router.post("/upload-signature", verifyToken, uploadStudentSignature);

// Student Activity
router.post(
  "/individualFile",
  verifyToken,
  uploadStudentActivityS3.single("file"),
  uploadIndividualFile
);
router.post("/deleteFile", verifyToken, deleteStudentFile);

router.post("/activitySubmit", verifyToken, activitySubmitByStudent);

export default router;
