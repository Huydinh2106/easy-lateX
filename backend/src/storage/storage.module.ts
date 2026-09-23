import { Global, Module } from "@nestjs/common";
import { OBJECT_STORAGE } from "../common/tokens";
import { S3StorageAdapter } from "./s3-storage.adapter";

@Global()
@Module({ providers: [S3StorageAdapter, { provide: OBJECT_STORAGE, useExisting: S3StorageAdapter }], exports: [OBJECT_STORAGE, S3StorageAdapter] })
export class StorageModule {}
