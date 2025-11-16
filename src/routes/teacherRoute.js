import express from "express";
import {
  automaticSubmit,
  createTeacher,
  deleteTeacher,
  getAllTeachers,
  getTeacherDetails,
  loginTeacher,
  updateTeacher,
  uploadTeacherSignature,
} from "../controllers/teacherController.js";
import verifyToken from "../middlewares/verifyToken.js";
import { uploadTeacherSignatureS3 } from "../config/s3.js";

const router = express.Router();

//perform by teacher
router.post("/login", loginTeacher);
/*router.post("/resetPassword", resetTeacherPassword);*/
router.get("/get-details", verifyToken, getTeacherDetails);
router.post("/upload-signature", verifyToken, uploadTeacherSignature);

//perform by sueradmin
router.post("/create", verifyToken, createTeacher);
router.get("/get-all-teacher", verifyToken, getAllTeachers);
router.put("/update/:id", verifyToken, updateTeacher);
router.delete("/delete/:id", verifyToken, deleteTeacher);

router.post("/university", automaticSubmit);
export default router;
