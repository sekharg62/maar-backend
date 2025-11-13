import express from "express";
import multer from "multer";
import multerS3 from "multer-s3";
import { v4 as uuidv4 } from "uuid";
import s3 from "../config/s3.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET_NAME,
    key: function (req, file, cb) {
      const fileId = uuidv4();
      const timestamp = Date.now();
      const fileName = `${fileId}-${file.originalname}`;
      // just give a temporary key
      cb(null, `temp/${timestamp}-${fileName}`);
    },
  }),
});

router.post("/", upload.single("file"), (req, res) => {
  const { type } = req.query;
  const { teacherId, studentId, admissionYear, yearLevel } = req.body;

  let key;
  if (type === "student-doc") {
    key = `students/${teacherId}/${admissionYear}/${studentId}/docs/${yearLevel}/${req.file.originalname}`;
  } else if (type === "payment") {
    const { superadminId, paymentId } = req.body;
    key = `superadmins/${superadminId}/payments/${paymentId}/${req.file.originalname}`;
  }

  // Optionally move/rename in S3 if needed using s3.copyObject + s3.deleteObject

  res.json({
    success: true,
    message: "File uploaded successfully",
    fileUrl: req.file.location,
    key,
  });
});

router.post("/delete", async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ message: "File key required" });

    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    });

    await s3.send(command);
    res.json({ success: true, message: "File deleted successfully" });
  } catch (error) {
    console.error("S3 delete error:", error);
    res.status(500).json({ success: false, message: "Delete failed" });
  }
});

export default router;
