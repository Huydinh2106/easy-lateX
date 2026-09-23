import { ProjectRole } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import type { ProjectAccessService } from "../src/projects/project-access.service";
import { ProjectsService } from "../src/projects/projects.service";
import type { ObjectStorage } from "../src/storage/object-storage";

describe("project lifecycle", () => {
  it("deletes revision dependencies in a transaction before removing the project", async () => {
    const calls: string[] = [];
    const deleting = (name: string) => ({
      deleteMany: jest.fn().mockImplementation(async () => { calls.push(name); return { count: 1 }; })
    });
    const tx: any = {
      build: deleting("build"),
      revisionFile: deleting("revisionFile"),
      projectRevision: deleting("projectRevision"),
      documentOperation: deleting("documentOperation"),
      fileVersion: deleting("fileVersion"),
      fileEntry: deleting("fileEntry"),
      projectMember: deleting("projectMember"),
      project: { delete: jest.fn().mockImplementation(async () => { calls.push("project"); }) }
    };
    const prisma: any = {
      fileVersion: { findMany: jest.fn().mockResolvedValue([{ storageKey: "files/v1" }]) },
      build: { findMany: jest.fn().mockResolvedValue([{ pdfStorageKey: "build/pdf", logStorageKey: "build/log", synctexStorageKey: null }]) },
      projectRevision: { findMany: jest.fn().mockResolvedValue([{ manifestStorageKey: "revisions/manifest" }]) },
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<void>) => callback(tx))
    };
    const access = { role: jest.fn().mockResolvedValue(ProjectRole.OWNER) } as unknown as ProjectAccessService;
    const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) } as unknown as ObjectStorage;
    const service = new ProjectsService(prisma as PrismaService, access, storage);

    await service.remove("project-1", "owner-1");

    expect(calls).toEqual([
      "build", "revisionFile", "projectRevision", "documentOperation",
      "fileVersion", "fileEntry", "projectMember", "project"
    ]);
    expect(tx.revisionFile.deleteMany).toHaveBeenCalledWith({ where: { revision: { projectId: "project-1" } } });
    expect(tx.fileVersion.deleteMany).toHaveBeenCalledWith({ where: { fileEntry: { projectId: "project-1" } } });
    expect((storage as any).deleteObject.mock.calls.map(([key]: [string]) => key).sort()).toEqual([
      "build/log", "build/pdf", "files/v1", "revisions/manifest"
    ]);
  });
});
