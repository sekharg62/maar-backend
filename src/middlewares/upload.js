import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() }); // store in memory or use diskStorage if needed

export const uploadFields = upload.fields([
  { name: "excel", maxCount: 1 },
  { name: "signature", maxCount: 1 },
]);
