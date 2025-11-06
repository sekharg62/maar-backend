import s3 from "../config/s3.js";

/**
 * Copy a file inside the same bucket (used for updating "latest" file)
 */
export const copyToLatest = async (sourceKey, destKey) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    CopySource: `${process.env.S3_BUCKET_NAME}/${sourceKey}`,
    Key: destKey,
    ACL: "private",
  };
  await s3.copyObject(params).promise();
};
export const getSignedFileUrl = async (key) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Expires: 60 * 5, // 5 minutes
  };

  return s3.getSignedUrlPromise("getObject", params);
};
