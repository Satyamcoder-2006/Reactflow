import { s3, S3_BUCKET } from '../config/s3';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export class StorageService {
    /**
     * Upload file to S3
     */
    async uploadFile(localPath: string, s3Key: string): Promise<string> {
        const fileStream = fs.createReadStream(localPath);
        const fileName = path.basename(localPath);

        const params = {
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: fileStream,
            ContentType: this.getContentType(fileName),
        };

        logger.info(`Uploading ${localPath} to s3://${S3_BUCKET}/${s3Key}`);

        await s3.upload(params).promise();

        const url = `s3://${S3_BUCKET}/${s3Key}`;
        logger.info(`Upload complete: ${url}`);

        return url;
    }

    /**
     * Download file from S3
     */
    async downloadFile(s3Url: string, localPath: string): Promise<void> {
        const { bucket, key } = this.parseS3Url(s3Url);

        const params = {
            Bucket: bucket,
            Key: key,
        };

        logger.info(`Downloading ${s3Url} to ${localPath}`);

        const data = await s3.getObject(params).promise();

        fs.writeFileSync(localPath, data.Body as Buffer);

        logger.info(`Download complete: ${localPath}`);
    }

    /**
     * Get file size from S3
     */
    async getFileSize(s3Url: string): Promise<number> {
        const { bucket, key } = this.parseS3Url(s3Url);

        const params = {
            Bucket: bucket,
            Key: key,
        };

        const metadata = await s3.headObject(params).promise();

        return metadata.ContentLength || 0;
    }

    /**
     * Generate signed URL for download
     */
    async getSignedUrl(s3Url: string, expiresIn: number = 3600): Promise<string> {
        const { bucket, key } = this.parseS3Url(s3Url);

        const params = {
            Bucket: bucket,
            Key: key,
            Expires: expiresIn,
        };

        return s3.getSignedUrlPromise('getObject', params);
    }

    /**
     * Delete file from S3
     */
    async deleteFile(s3Url: string): Promise<void> {
        const { bucket, key } = this.parseS3Url(s3Url);

        const params = {
            Bucket: bucket,
            Key: key,
        };

        await s3.deleteObject(params).promise();

        logger.info(`Deleted ${s3Url}`);
    }

    /**
     * Parse S3 URL into bucket and key
     */
    private parseS3Url(s3Url: string): { bucket: string; key: string } {
        const match = s3Url.match(/^s3:\/\/([^\/]+)\/(.+)$/);

        if (!match) {
            throw new Error(`Invalid S3 URL: ${s3Url}`);
        }

        return {
            bucket: match[1],
            key: match[2],
        };
    }

    /**
     * Get content type from file extension
     */
    private getContentType(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();

        const contentTypes: Record<string, string> = {
            '.apk': 'application/vnd.android.package-archive',
            '.json': 'application/json',
            '.log': 'text/plain',
            '.txt': 'text/plain',
        };

        return contentTypes[ext] || 'application/octet-stream';
    }
}
