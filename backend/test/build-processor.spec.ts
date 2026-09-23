import fs from "node:fs/promises";
import path from "node:path";
import { BuildStatus } from "@prisma/client";
import { BuildProcessorService } from "../src/builds/build-processor.service";
import type { AppConfig } from "../src/common/config";
import type { CompilerAdapter } from "../src/compiler/compiler-adapter";
import type { PrismaService } from "../src/database/prisma.service";
import type { ObjectStorage } from "../src/storage/object-storage";

const workspaceBase = "/tmp/easy-latex-build-processor-tests";

function setup(compile: CompilerAdapter["compile"]) {
  const updates: any[] = [];
  const build = {
    id: "build-1", projectId: "project-1", rootFile: "main.tex", status: BuildStatus.QUEUED,
    revision: { files: [{ path: "main.tex", storageKey: "source-key", size: 30 }] }
  };
  const prisma: any = {
    build: {
      findUnique: jest.fn().mockImplementation(async (query: any) => query.include ? build : { status: BuildStatus.RUNNING }),
      update: jest.fn().mockImplementation(async ({ data }: any) => { updates.push(data); return { ...build, ...data }; })
    },
    project: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (values: Promise<unknown>[]) => Promise.all(values))
  };
  const objects = new Map<string, Buffer>();
  const storage: any = {
    getBuffer: jest.fn().mockResolvedValue(Buffer.from("\\documentclass{article}")),
    putObject: jest.fn().mockImplementation(async ({ key, body }: { key: string; body: Buffer }) => { objects.set(key, body); return { key, size: body.length }; })
  };
  const config: AppConfig = {
    nodeEnv: "test", port: 8000, authMode: "development", redisUrl: "redis://test", corsOrigins: [],
    s3: { bucket: "test", accessKeyId: "test", secretAccessKey: "test", region: "auto", forcePathStyle: true },
    compiler: { image: "compiler", workspaceBase, timeoutMs: 1000, maxSourceBytes: 1000, maxLogBytes: 1000, maxArtifactBytes: 1000 }
  };
  const processor = new BuildProcessorService(prisma as PrismaService, storage as ObjectStorage, { compile } as CompilerAdapter, config);
  return { processor, prisma, storage, objects, updates };
}

describe("compile worker processor", () => {
  beforeEach(async () => fs.rm(workspaceBase, { recursive: true, force: true }));
  afterEach(async () => fs.rm(workspaceBase, { recursive: true, force: true }));

  it("uploads a real-looking PDF/log/SyncTeX result and marks the immutable revision successful", async () => {
    const compile = jest.fn(async ({ workspacePath }: { workspacePath: string }) => {
      const pdfPath = path.join(workspacePath, "main.pdf");
      const synctexPath = path.join(workspacePath, "main.synctex.gz");
      await fs.writeFile(pdfPath, Buffer.from("%PDF-test-artifact"));
      await fs.writeFile(synctexPath, Buffer.from("synctex"));
      return { success: true, timedOut: false, exitCode: 0, durationMs: 25, log: Buffer.from("latexmk success"), pdfPath, synctexPath };
    });
    const { processor, objects, updates, prisma } = setup(compile);
    await processor.process("build-1", "job-1");
    expect(objects.get("projects/project-1/builds/build-1/document.pdf")?.subarray(0, 4).toString()).toBe("%PDF");
    expect(objects.has("projects/project-1/builds/build-1/compile.log")).toBe(true);
    expect(objects.has("projects/project-1/builds/build-1/document.synctex.gz")).toBe(true);
    expect(updates).toContainEqual(expect.objectContaining({ status: BuildStatus.SUCCEEDED, pdfStorageKey: "projects/project-1/builds/build-1/document.pdf" }));
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: "project-1" }, data: { latestSuccessfulBuildId: "build-1" } });
    expect(await fs.readdir(workspaceBase)).toEqual([]);
  });

  it("stores and parses a LaTeX syntax failure without throwing for BullMQ retry", async () => {
    const { processor, updates } = setup(jest.fn().mockResolvedValue({
      success: false, timedOut: false, exitCode: 1, durationMs: 12,
      log: Buffer.from("main.tex:3: Undefined control sequence")
    }));
    await expect(processor.process("build-1", "job-1")).resolves.toBeUndefined();
    expect(updates).toContainEqual(expect.objectContaining({
      status: BuildStatus.FAILED,
      errorSummary: expect.objectContaining({ errors: [{ file: "main.tex", line: 3, message: "Undefined control sequence" }] })
    }));
  });

  it("marks a compiler hard timeout distinctly", async () => {
    const { processor, updates } = setup(jest.fn().mockResolvedValue({ success: false, timedOut: true, exitCode: null, durationMs: 1000, log: Buffer.from("timeout") }));
    await processor.process("build-1", "job-1");
    expect(updates).toContainEqual(expect.objectContaining({ status: BuildStatus.TIMED_OUT, errorSummary: expect.objectContaining({ message: "Compilation timed out" }) }));
  });

  it("always removes the temporary workspace after infrastructure failure", async () => {
    const { processor } = setup(jest.fn().mockRejectedValue(new Error("Docker unavailable")));
    await expect(processor.process("build-1", "job-1")).rejects.toThrow("Docker unavailable");
    expect(await fs.readdir(workspaceBase)).toEqual([]);
  });
});
