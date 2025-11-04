// routes/teacherRoutes.js
import express from "express";
import multer from "multer";
import {
  activitySubmitByStudent,
  createStudentByExcel,
  createStudentIndividual,
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
  deleteFileFromS3,
  uploadStudentActivityS3,
  uploadStudentSignatureS3,
} from "../config/s3.js";

const router = express.Router();

const upload = multer({ dest: "uploads/" });
//perform by teacher

router.post(
  "/createByExcel",
  verifyToken,
  upload.single("file"),
  createStudentByExcel
);
router.post("/createIndividual", verifyToken, createStudentIndividual);
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

router.post(
  "/uploadSignature",
  verifyToken,
  uploadStudentSignatureS3.single("signature"),
  uploadStudentSignature
);

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
