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
      try {
        const { type } = req.query; // type = "student-doc" | "payment"
        const timestamp = Date.now();
        const fileId = uuidv4();
        const fileName = `${fileId}-${file.originalname}`;

        let key = "";

        if (type === "payment") {
          const { superadminId, paymentId } = req.body;
          key = `superadmins/${superadminId}/payments/${paymentId}/${timestamp}-${file.originalname}`;
        } else if (type === "student-doc") {
          const { teacherId, studentId, admissionYear, yearLevel } = req.body;
          key = `students/${teacherId}/${admissionYear}/${studentId}/docs/${yearLevel}/${fileName}`;
        } else {
          return cb(new Error("Invalid upload type"));
        }

        cb(null, key);
      } catch (err) {
        cb(err);
      }
    },
  }),
});

router.post("/", upload.single("file"), (req, res) => {
  try {
    res.json({
      success: true,
      message: "File uploaded successfully",
      fileUrl: req.file.location,
      key: req.file.key,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Upload failed" });
  }
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
