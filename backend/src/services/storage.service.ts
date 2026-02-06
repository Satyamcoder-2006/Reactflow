import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { env } from '../config/env';

export class StorageService {
    private uploadDir: string;
    private baseUrl: string;

    constructor() {
        this.uploadDir = path.join(process.cwd(), 'uploads');
        this.baseUrl = `${env.BACKEND_URL}/storage`;

        // Ensure upload directory exists
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    /**
     * Upload a file to local storage
     */
    async uploadFile(key: string, fileStream: any, contentType: string): Promise<string> {
        const filePath = path.join(this.uploadDir, key);
        const dir = path.dirname(filePath);

        // Ensure subdirectory exists
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }

        try {
            // Handle buffer or stream
            if (Buffer.isBuffer(fileStream)) {
                await fs.promises.writeFile(filePath, fileStream);
            } else {
                const writeStream = fs.createWriteStream(filePath);
                await pipeline(fileStream, writeStream);
            }

            // Return public URL
            return `${this.baseUrl}/${key}`;
        } catch (error) {
            console.error('Local storage upload error:', error);
            throw new Error(`Failed to upload file: ${key}`);
        }
    }

    /**
     * Get file read stream
     */
    async getFileStream(key: string): Promise<fs.ReadStream> {
        const filePath = path.join(this.uploadDir, key);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${key}`);
        }
        return fs.createReadStream(filePath);
    }

    /**
     * Get signed URL (For local, just returns the public URL)
     */
    async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
        // For local storage, we just return the direct URL
        // In a real prod environment, you might generate a temporary token here
        return `${this.baseUrl}/${key}`;
    }

    /**
     * Delete file
     */
    async deleteFile(key: string): Promise<void> {
        const filePath = path.join(this.uploadDir, key);
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        } catch (error) {
            console.error('Local storage delete error:', error);
            // Ignore if file doesn't exist
        }
    }

    /**
     * Get file size
     */
    async getFileSize(key: string): Promise<number> {
        // If key is a URL, extract the path
        const fileKey = key.includes(this.baseUrl)
            ? key.replace(`${this.baseUrl}/`, '')
            : key;

        const filePath = path.join(this.uploadDir, fileKey);
        const stats = await fs.promises.stat(filePath);
        return stats.size;
    }
}
