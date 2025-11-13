import express from "express";
import multer from "multer";
import multerS3 from "multer-s3";
import { v4 as uuidv4 } from "uuid";
import s3 from "../config/s3.js";
import { copyToLatest } from "../utils/s3Utils.js";

const router = express.Router();

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET_NAME,
    key: async function (req, file, cb) {
      try {
        const { type } = req.query; // teacher | student
        const timestamp = Date.now();
        const fileId = uuidv4();
        const fileName = `${timestamp}-${file.originalname}`;

        let key = "";

        if (type === "teacher") {
          const { teacherId } = req.body;
          key = `teachers/${teacherId}/signatures/${fileName}`;
        } else if (type === "student") {
          const { teacherId, studentId, admissionYear } = req.body;
          key = `students/${teacherId}/${admissionYear}/${studentId}/signature/${fileName}`;
        } else {
          return cb(new Error("Invalid signature type"));
        }

        cb(null, key);
      } catch (err) {
        cb(err);
      }
    },
  }),
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { type } = req.query;
    // console.log("type:", type);
    const { teacherId, admissionYear } = req.body;
    const studentId = req.user.id;

    let sourceKey = req.file.key;
    let latestKey = "";

    if (type === "teacher") {
      latestKey = `teachers/${teacherId}/signatures/latest.png`;
    } else if (type === "student") {
      latestKey = `students/${teacherId}/${admissionYear}/${studentId}/signature/latest.png`;
    }

    await copyToLatest(sourceKey, latestKey);

    res.status(200).json({
      success: true,
      message: "Signature uploaded successfully",
      fileUrl: req.file.location,
      key: req.file.key,
      latestUrl: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${latestKey}`,
    });
  } catch (error) {
    console.error("Signature upload error:", error);
    res
      .status(500)
      .json({ success: false, message: "Signature upload failed" });
  }
});

export default router;
