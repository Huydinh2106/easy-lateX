import { ConflictException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FileKind, ProjectRole } from "@prisma/client";
import type { AuthUser } from "../src/common/current-user";
import type { PrismaService } from "../src/database/prisma.service";
import type { DocumentEvents } from "../src/document/document.events";
import { ProjectDocumentService } from "../src/document/document.service";
import type { ProjectAccessService } from "../src/projects/project-access.service";
import type { ObjectStorage } from "../src/storage/object-storage";

const actor: AuthUser = { id: "user-1", firebaseUid: "development-user", email: "dev@example.test", displayName: "Dev" };

function setup() {
  const tx = {
    fileEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ currentVersion: 2 }) },
    fileVersion: { create: jest.fn() }, documentOperation: { create: jest.fn() },
    project: { findUnique: jest.fn().mockResolvedValue({ rootFile: "chapters/main.tex" }), update: jest.fn() }
  };
  const prisma: any = {
    fileEntry: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    fileVersion: { findUnique: jest.fn() }, documentOperation: { findMany: jest.fn() },
    projectRevision: { aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 0 } }), create: jest.fn() },
    revisionFile: { findFirst: jest.fn() },
    $transaction: jest.fn(async (value: unknown) => typeof value === "function" ? (value as (client: typeof tx) => unknown)(tx) : Promise.all(value as Promise<unknown>[]))
  };
  const access = { role: jest.fn().mockResolvedValue(ProjectRole.EDITOR) };
  const storage = {
    putObject: jest.fn().mockImplementation(async ({ key, contentLength }: { key: string; contentLength: number }) => ({ key, size: contentLength })),
    getBuffer: jest.fn(), getObject: jest.fn(), deleteObject: jest.fn().mockResolvedValue(undefined), copyObject: jest.fn(), objectExists: jest.fn(), statObject: jest.fn(), readiness: jest.fn()
  };
  const events = { publish: jest.fn(), subscribe: jest.fn() };
  const service = new ProjectDocumentService(prisma as PrismaService, access as unknown as ProjectAccessService, events as unknown as DocumentEvents, storage as unknown as ObjectStorage);
  return { service, prisma, access, storage, events, tx };
}

describe("ProjectDocumentService", () => {
  it("rejects stale writes with optimistic concurrency", async () => {
    const { service, prisma, storage } = setup();
    prisma.fileEntry.findFirst.mockResolvedValue({ id: "file-1", path: "main.tex", kind: FileKind.FILE, currentVersion: 3 });
    await expect(service.applyFileUpdate({ projectId: "project-1", path: "main.tex", content: Buffer.from("new"), expectedVersion: 2, actor })).rejects.toBeInstanceOf(ConflictException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("does not create duplicate immutable versions when the checksum is unchanged", async () => {
    const { service, prisma, storage } = setup();
    const content = Buffer.from("unchanged");
    const checksum = createHash("sha256").update(content).digest("hex");
    prisma.fileEntry.findFirst.mockResolvedValue({ id: "file-1", path: "main.tex", kind: FileKind.FILE, currentVersion: 4, mimeType: "application/x-tex" });
    prisma.fileVersion.findUnique.mockResolvedValue({ checksum });
    await expect(service.applyFileUpdate({ projectId: "project-1", path: "main.tex", content, expectedVersion: 4, actor })).resolves.toEqual({ version: 4, checksum, deduplicated: true });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("uploads an immutable object, advances the version, and records actor metadata", async () => {
    const { service, prisma, storage, tx, events } = setup();
    prisma.fileEntry.findFirst.mockResolvedValue({ id: "file-1", path: "main.tex", kind: FileKind.FILE, currentVersion: 1, mimeType: "application/x-tex" });
    prisma.fileVersion.findUnique.mockResolvedValue({ checksum: "old" });
    const result = await service.applyFileUpdate({ projectId: "project-1", path: "main.tex", content: Buffer.from("version two"), expectedVersion: 1, actor });
    expect(result).toEqual(expect.objectContaining({ version: 2, deduplicated: false }));
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ key: "projects/project-1/files/file-1/versions/2" }));
    expect(tx.fileVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 2, createdBy: actor.id }) });
    expect(tx.documentOperation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ operationType: "REPLACE_FILE", baseVersion: 1, resultVersion: 2, metadata: expect.objectContaining({ actor: actor.firebaseUid }) }) });
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: "file.updated", actorId: actor.id }));
  });

  it("preserves structured source-operation metadata in the shared history", async () => {
    const { service, prisma, tx } = setup();
    prisma.fileEntry.findFirst.mockResolvedValue({ id: "file-1", path: "main.tex", kind: FileKind.FILE, currentVersion: 1, mimeType: "application/x-tex" });
    prisma.fileVersion.findUnique.mockResolvedValue({ checksum: "old" });
    await service.applyFileUpdate({
      projectId: "project-1", path: "main.tex", content: Buffer.from("new source"), expectedVersion: 1, actor,
      operationType: "REPLACE_RANGE", operationMetadata: { start: 4, end: 8, insertedBytes: 3 }
    });
    expect(tx.documentOperation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      operationType: "REPLACE_RANGE",
      metadata: expect.objectContaining({ path: "main.tex", start: 4, end: 8, insertedBytes: 3 })
    }) });
  });

  it("rejects an uploaded image whose bytes do not match its extension", async () => {
    const { service, storage } = setup();
    await expect(service.createEntry("project-1", "figure.png", FileKind.FILE, Buffer.from("not a png"), actor, "image/png"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("cleans up an uploaded object if the database transaction fails", async () => {
    const { service, prisma, storage } = setup();
    prisma.fileEntry.findFirst.mockResolvedValue({ id: "file-1", path: "main.tex", kind: FileKind.FILE, currentVersion: 1 });
    prisma.fileVersion.findUnique.mockResolvedValue({ checksum: "old" });
    prisma.$transaction.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.applyFileUpdate({ projectId: "project-1", path: "main.tex", content: Buffer.from("new"), expectedVersion: 1, actor })).rejects.toThrow("database unavailable");
    expect(storage.deleteObject).toHaveBeenCalledWith("projects/project-1/files/file-1/versions/2");
  });

  it("forbids viewers from mutating canonical source", async () => {
    const { service, access } = setup();
    access.role.mockResolvedValue(ProjectRole.VIEWER);
    await expect(service.applyFileUpdate({ projectId: "project-1", path: "main.tex", content: Buffer.from("x"), expectedVersion: 1, actor })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("moves a folder and descendants atomically and follows the root file", async () => {
    const { service, prisma, tx } = setup();
    prisma.fileEntry.findFirst.mockResolvedValue({ id: "folder-1", path: "chapters", kind: FileKind.DIRECTORY });
    prisma.fileEntry.findMany.mockResolvedValue([
      { id: "folder-1", path: "chapters" },
      { id: "file-1", path: "chapters/main.tex" }
    ]);
    await service.moveEntry("project-1", "chapters", "content", actor);
    expect(tx.fileEntry.update).toHaveBeenNthCalledWith(1, { where: { id: "folder-1" }, data: { path: "content", parentPath: "", name: "content" } });
    expect(tx.fileEntry.update).toHaveBeenNthCalledWith(2, { where: { id: "file-1" }, data: { path: "content/main.tex", parentPath: "content", name: "main.tex" } });
    expect(tx.project.update).toHaveBeenCalledWith({ where: { id: "project-1" }, data: { rootFile: "content/main.tex" } });
  });

  it("creates a revision manifest that pins exact FileVersion ids", async () => {
    const { service, prisma, storage } = setup();
    jest.spyOn(service, "getProjectSnapshot").mockResolvedValue({
      projectId: "project-1", rootFile: "main.tex",
      files: [{ id: "file-1", fileVersionId: "version-id-2", path: "main.tex", version: 2, storageKey: "source-key", checksum: "a".repeat(64), size: 42 }]
    });
    prisma.projectRevision.create.mockImplementation(async ({ data }: any) => data);
    const revision = await service.createRevision("project-1", actor);
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ key: expect.stringMatching(/^projects\/project-1\/revisions\/.+\/manifest\.json$/) }));
    expect((revision as any).files.create[0]).toEqual(expect.objectContaining({ fileEntryId: "file-1", fileVersionId: "version-id-2", storageKey: "source-key" }));
  });
});
