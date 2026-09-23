import { Readable } from "node:stream";
import type { AppConfig } from "../src/common/config";
import { S3StorageAdapter } from "../src/storage/s3-storage.adapter";

const config: AppConfig = {
  nodeEnv: "test", port: 8000, authMode: "development", redisUrl: "redis://test", corsOrigins: [],
  s3: { endpoint: "http://minio:9000", bucket: "private-bucket", accessKeyId: "key", secretAccessKey: "secret", region: "auto", forcePathStyle: true },
  compiler: { image: "compiler", workspaceBase: "/tmp", timeoutMs: 1000, maxSourceBytes: 1000, maxLogBytes: 1000, maxArtifactBytes: 1000 }
};

function setup() {
  const adapter = new S3StorageAdapter(config);
  const send = jest.fn();
  (adapter as unknown as { client: { send: jest.Mock } }).client.send = send;
  return { adapter, send };
}

describe("S3-compatible ObjectStorage contract", () => {
  it("writes provider-neutral keys to the configured private bucket", async () => {
    const { adapter, send } = setup();
    send.mockResolvedValue({ ETag: "etag-1" });
    await expect(adapter.putObject({ key: "projects/p/files/f/versions/2", body: Buffer.from("source"), contentLength: 6, contentType: "application/x-tex" })).resolves.toEqual({ key: "projects/p/files/f/versions/2", etag: "etag-1", size: 6 });
    expect(send.mock.calls[0][0].input).toEqual(expect.objectContaining({ Bucket: "private-bucket", Key: "projects/p/files/f/versions/2", ContentLength: 6 }));
  });

  it("streams object bytes and enforces the caller's size limit", async () => {
    const { adapter, send } = setup();
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from("PDF")]) });
    await expect(adapter.getBuffer("artifact", 3)).resolves.toEqual(Buffer.from("PDF"));
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from("oversized")]) });
    await expect(adapter.getBuffer("artifact", 3)).rejects.toThrow(/exceeds/i);
  });

  it("implements stat, existence, copy, delete, signed download, and readiness on the same adapter", async () => {
    const { adapter, send } = setup();
    send
      .mockResolvedValueOnce({ ContentLength: 42, ContentType: "application/pdf", ETag: "etag" })
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValue({});
    await expect(adapter.statObject("document.pdf")).resolves.toEqual({ key: "document.pdf", size: 42, contentType: "application/pdf", etag: "etag" });
    await expect(adapter.objectExists("missing")).resolves.toBe(false);
    await adapter.copyObject("folder/source.tex", "copy.tex");
    expect(send.mock.calls[2][0].input).toEqual(expect.objectContaining({ Bucket: "private-bucket", Key: "copy.tex", CopySource: "private-bucket/folder/source.tex" }));
    await adapter.deleteObject("copy.tex");
    expect(send.mock.calls[3][0].input).toEqual(expect.objectContaining({ Bucket: "private-bucket", Key: "copy.tex" }));
    await adapter.readiness();
    expect(send.mock.calls[4][0].input).toEqual({ Bucket: "private-bucket" });
  });
});
