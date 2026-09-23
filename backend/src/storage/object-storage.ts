import type { Readable } from "node:stream";

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType?: string;
  contentLength?: number;
}

export interface StoredObject { key: string; etag?: string; size: number }
export interface ObjectMetadata { key: string; size: number; contentType?: string; etag?: string }

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(key: string): Promise<Readable>;
  getBuffer(key: string, limit?: number): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  copyObject(source: string, destination: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  statObject(key: string): Promise<ObjectMetadata>;
  createDownloadUrl?(key: string, expiresIn: number): Promise<string>;
  readiness(): Promise<void>;
}
