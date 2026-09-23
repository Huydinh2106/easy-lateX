import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { BuildStatus, ProjectRole } from "@prisma/client";
import type { FastifyReply } from "fastify";
import { Readable } from "node:stream";
import { BuildsController } from "../src/builds/builds.controller";
import { BuildsService } from "../src/builds/builds.service";
import type { AppConfig } from "../src/common/config";
import type { AuthUser } from "../src/common/current-user";
import type { PrismaService } from "../src/database/prisma.service";
import type { ProjectDocumentService } from "../src/document/document.service";
import type { ProjectAccessService } from "../src/projects/project-access.service";
import type { ObjectStorage } from "../src/storage/object-storage";

const redis = {
  incr: jest.fn(), expire: jest.fn(), quit: jest.fn(), disconnect: jest.fn(),
  on: jest.fn(), once: jest.fn(), status: "ready"
};
const queue = { add: jest.fn(), close: jest.fn(), getJob: jest.fn() };

jest.mock("ioredis", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => redis)
}));
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => queue)
}));

const actor: AuthUser = {
  id: "user-1", firebaseUid: "development-user", email: "dev@example.test", displayName: "Dev"
};
const config: AppConfig = {
  nodeEnv: "test", port: 8000, authMode: "development", redisUrl: "redis://test", corsOrigins: [],
  s3: { bucket: "test", accessKeyId: "test", secretAccessKey: "test", region: "auto", forcePathStyle: true },
  compiler: { image: "compiler", workspaceBase: "/tmp", timeoutMs: 1000, maxSourceBytes: 1000, maxLogBytes: 1000, maxArtifactBytes: 1000 }
};

function serviceSetup() {
  const build = {
    id: "build-1", projectId: "project-1", revisionId: "revision-1", requestedBy: actor.id,
    rootFile: "main.tex", status: BuildStatus.QUEUED, queueJobId: null
  };
  const prisma: any = {
    build: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(build),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...build, ...data }))
    }
  };
  const documents = { createRevision: jest.fn().mockResolvedValue({ id: "revision-1", rootFile: "main.tex" }) };
  const access = { role: jest.fn().mockResolvedValue(ProjectRole.EDITOR) };
  const service = new BuildsService(
    prisma as PrismaService,
    documents as unknown as ProjectDocumentService,
    access as unknown as ProjectAccessService,
    config
  );
  service.onModuleInit();
  return { service, prisma, documents, access, build };
}

describe("build queue and artifact authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    redis.quit.mockResolvedValue("OK");
    queue.add.mockResolvedValue({ id: "build-1" });
    queue.close.mockResolvedValue(undefined);
  });

  it("pins a revision, creates a queued build, and enqueues the build idempotently", async () => {
    const { service, prisma, documents } = serviceSetup();
    await expect(service.create("project-1", actor)).resolves.toEqual(expect.objectContaining({ queueJobId: "build-1" }));
    expect(documents.createRevision).toHaveBeenCalledWith("project-1", actor);
    expect(prisma.build.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      projectId: "project-1", revisionId: "revision-1", status: BuildStatus.QUEUED, compiler: "latexmk"
    }) });
    expect(queue.add).toHaveBeenCalledWith("compile", { buildId: "build-1" }, expect.objectContaining({
      jobId: "build-1", attempts: 3, removeOnComplete: expect.any(Object), removeOnFail: expect.any(Object)
    }));
    await service.onModuleDestroy();
  });

  it("does not create a second build while the project already has an active build", async () => {
    const { service, prisma, documents, build } = serviceSetup();
    prisma.build.findFirst.mockResolvedValue(build);
    await expect(service.create("project-1", actor)).resolves.toBe(build);
    expect(documents.createRevision).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it("forbids a viewer from compiling", async () => {
    const { service, access, documents } = serviceSetup();
    access.role.mockResolvedValue(ProjectRole.VIEWER);
    await expect(service.create("project-1", actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(documents.createRevision).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it.each(["pdf", "log"])("authorizes the project before streaming a %s artifact", async (kind) => {
    const builds = {
      get: jest.fn().mockRejectedValue(new NotFoundException("Build not found"))
    } as unknown as BuildsService;
    const storage = { getObject: jest.fn() } as unknown as ObjectStorage;
    const controller = new BuildsController(builds, storage);
    const reply = { header: jest.fn().mockReturnThis(), send: jest.fn() } as unknown as FastifyReply;
    const call = kind === "pdf"
      ? controller.pdf("private-project", "build-1", actor, reply)
      : controller.log("private-project", "build-1", actor, reply);
    await expect(call).rejects.toBeInstanceOf(NotFoundException);
    expect((builds as any).get).toHaveBeenCalledWith("private-project", "build-1", actor.id);
    expect((storage as any).getObject).not.toHaveBeenCalled();
  });

  it("streams an authorized PDF from its provider-neutral storage key", async () => {
    const builds = {
      get: jest.fn().mockResolvedValue({ pdfStorageKey: "projects/p/builds/b/document.pdf" })
    } as unknown as BuildsService;
    const stream = Readable.from([Buffer.from("%PDF")]);
    const storage = { getObject: jest.fn().mockResolvedValue(stream) } as unknown as ObjectStorage;
    const reply = { header: jest.fn().mockReturnThis(), send: jest.fn().mockReturnValue(stream) } as unknown as FastifyReply;
    const controller = new BuildsController(builds, storage);
    await controller.pdf("project-1", "build-1", actor, reply);
    expect((storage as any).getObject).toHaveBeenCalledWith("projects/p/builds/b/document.pdf");
    expect((reply as any).header).toHaveBeenCalledWith("cache-control", "private, no-store");
  });
});
