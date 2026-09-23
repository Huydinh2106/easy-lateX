import { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "../common/config";
import { APP_CONFIG } from "../common/tokens";
import type { ObjectMetadata, ObjectStorage, PutObjectInput, StoredObject } from "./object-storage";

@Injectable()
export class S3StorageAdapter implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.s3.bucket;
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
    });
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.contentLength
    }));
    return { key: input.key, etag: response.ETag, size: input.contentLength ?? (Buffer.isBuffer(input.body) ? input.body.length : 0) };
  }

  async getObject(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`Storage object ${key} has no body`);
    return response.Body as Readable;
  }

  async getBuffer(key: string, limit = 100 * 1024 * 1024): Promise<Buffer> {
    const stream = await this.getObject(key);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += value.length;
      if (size > limit) throw new Error("Storage object exceeds the allowed size");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async copyObject(source: string, destination: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: destination, CopySource: `${this.bucket}/${encodeURIComponent(source).replaceAll("%2F", "/")}` }));
  }

  async objectExists(key: string): Promise<boolean> {
    try { await this.statObject(key); return true; } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (error instanceof NoSuchKey || status === 404) return false;
      throw error;
    }
  }

  async statObject(key: string): Promise<ObjectMetadata> {
    const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { key, size: response.ContentLength ?? 0, contentType: response.ContentType, etag: response.ETag };
  }

  async createDownloadUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async readiness(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
