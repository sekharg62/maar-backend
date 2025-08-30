import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";

const s3 = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const uploadTeacherSignatureS3 = multer({
  storage: multerS3({
    s3,
    bucket: "student-teacher-new",
    //acl: "public-read",
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      cb(null, `teachers/signatures/${Date.now()}_${file.originalname}`);
    },
  }),
});


export const uploadStudentSignatureS3 = multer({
  storage: multerS3({
    s3,
    bucket: "student-teacher-new",
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const insCode = req.user?.code; // from token
      const rollNo = req.user?.rollNo; // from token

      if (!insCode || !rollNo) {
        return cb(new Error("Institute code or roll number missing"));
      }

      // path: students/{insCode}/{rollNo}/signature/{timestamp_filename}
      const fileName = `${Date.now()}_${file.originalname}`;
      const fullPath = `students/${insCode}/${rollNo}/signature/${fileName}`;
      cb(null, fullPath);
    },
  }),
});
export const uploadStudentActivityS3 = multer({
  storage: multerS3({
    s3,
    bucket: "student-teacher-new",
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const insCode = req.user?.code;   // from token
      const rollNo = req.user?.rollNo;  // from token
      console.log("ins codell,,rollno",insCode,rollNo)

      if (!insCode || !rollNo) {
        return cb(new Error("Institute code or roll number missing"));
      }

      // path: students/{insCode}/{rollNo}/activity/{timestamp_filename}
      const fileName = `${Date.now()}_${file.originalname}`;
      const fullPath = `students/${insCode}/${rollNo}/activity/${fileName}`;
      cb(null, fullPath);
    },
  }),
});

export const deleteFileFromS3 = async (fileUrl) => {
  // Extract bucket + key
  const bucketName = "student-teacher-new";
  const key = fileUrl.split(".amazonaws.com/")[1]; // extract after domain

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
    console.log("File deleted successfully:", key);
  } catch (err) {
    console.error("Error deleting file:", err);
    throw err;
  }
};

