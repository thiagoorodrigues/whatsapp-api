import "../bootstrap";
import multer from "multer";
import AWS from "aws-sdk";
import { logger } from "../utils/logger";

AWS.config.update({
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION
});

const s3 = new AWS.S3();

export const uploadMulterAWS = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 4 * 1024 * 1024, // Not more than 4mb
    },
});

export const uploadToS3 = async (buffer: Buffer, keyName: string): Promise<AWS.S3.ManagedUpload.SendData> => {
    const params: AWS.S3.PutObjectRequest = {
        Bucket: process.env.S3_BUCKET,
        Key: `${process.env.S3_PATH}/${keyName}`,
        Body: buffer
    };

    return await s3.upload(params).promise();
};

export const createPresignedPost = (keyName: string): Promise<AWS.S3.PresignedPost> => {
    const params = {
        Bucket: process.env.S3_BUCKET,
        Fields: {
            key: `${process.env.S3_PATH}/${keyName}`
        },
        Expires: 60 * 60
    };
    return new Promise((resolve, reject) => {
        s3.createPresignedPost(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

export const generateAccessLink = (keyName: string): string => {
    try {
        const params = {
            Bucket: process.env.S3_BUCKET,
            Key: `${process.env.S3_PATH}/${keyName}`,
            Expires: 60 * 90
        };
        return s3.getSignedUrl('getObject', params);
    } catch (error) {
        logger.info("erroGetLink", error)
    }
};