import s3 from "../config/s3.js";
import { CopyObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const copyToLatest = async (sourceKey, destKey) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    CopySource: `${process.env.S3_BUCKET_NAME}/${sourceKey}`,
    Key: destKey,
    ACL: "private",
  };
  await s3.send(new CopyObjectCommand(params));
};

export const getSignedFileUrl = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 60 * 5 }); // 5 minutes
};
