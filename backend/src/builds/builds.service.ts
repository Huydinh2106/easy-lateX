import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BuildStatus, ProjectRole } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { AppConfig } from "../common/config";
import type { AuthUser } from "../common/current-user";
import { APP_CONFIG } from "../common/tokens";
import { PrismaService } from "../database/prisma.service";
import { ProjectDocumentService } from "../document/document.service";
import { ProjectAccessService } from "../projects/project-access.service";

export const BUILD_QUEUE = "latex-builds";

@Injectable()
export class BuildsService implements OnModuleInit, OnModuleDestroy {
  private readonly connection: IORedis;
  private queue!: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ProjectDocumentService,
    private readonly access: ProjectAccessService,
    @Inject(APP_CONFIG) config: AppConfig
  ) { this.connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null }); }

  onModuleInit(): void { this.queue = new Queue(BUILD_QUEUE, { connection: this.connection }); }
  async onModuleDestroy(): Promise<void> { await this.queue?.close(); await this.connection.quit(); }

  async create(projectId: string, actor: AuthUser) {
    const role = await this.access.role(projectId, actor.id);
    if (role === ProjectRole.VIEWER) throw new ForbiddenException("Editor access is required");
    const active = await this.prisma.build.findFirst({ where: { projectId, status: { in: [BuildStatus.QUEUED, BuildStatus.RUNNING] } }, orderBy: { createdAt: "desc" } });
    if (active) return active;
    const count = await this.connection.incr(`compile-rate:${actor.id}`);
    if (count === 1) await this.connection.expire(`compile-rate:${actor.id}`, 60);
    if (count > 10) throw new ConflictException("Compile rate limit exceeded; wait one minute");
    const revision = await this.documents.createRevision(projectId, actor);
    const build = await this.prisma.build.create({ data: {
      projectId, revisionId: revision.id, requestedBy: actor.id, rootFile: revision.rootFile,
      status: BuildStatus.QUEUED, compiler: "latexmk"
    } });
    try {
      const job = await this.queue.add("compile", { buildId: build.id }, {
        jobId: build.id, attempts: 3, backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 86400, count: 500 }, removeOnFail: { age: 604800, count: 1000 }
      });
      return this.prisma.build.update({ where: { id: build.id }, data: { queueJobId: String(job.id) } });
    } catch (error) {
      await this.prisma.build.update({ where: { id: build.id }, data: { status: BuildStatus.FAILED, finishedAt: new Date(), errorSummary: { message: "The build queue is unavailable" } } });
      throw error;
    }
  }

  async list(projectId: string, userId: string) {
    await this.access.role(projectId, userId);
    return this.prisma.build.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async latest(projectId: string, userId: string) {
    await this.access.role(projectId, userId);
    return this.prisma.build.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
  }

  async get(projectId: string, buildId: string, userId: string) {
    await this.access.role(projectId, userId);
    const build = await this.prisma.build.findFirst({ where: { id: buildId, projectId } });
    if (!build) throw new NotFoundException("Build not found");
    return build;
  }

  async cancel(projectId: string, buildId: string, actor: AuthUser) {
    const role = await this.access.role(projectId, actor.id);
    if (role === ProjectRole.VIEWER) throw new ForbiddenException("Editor access is required");
    const build = await this.get(projectId, buildId, actor.id);
    const terminal = new Set<BuildStatus>([BuildStatus.SUCCEEDED, BuildStatus.FAILED, BuildStatus.CANCELLED, BuildStatus.TIMED_OUT]);
    if (terminal.has(build.status)) return build;
    const job = await this.queue.getJob(build.queueJobId ?? build.id);
    if (job && !await job.isActive()) await job.remove().catch(() => undefined);
    return this.prisma.build.update({ where: { id: build.id }, data: { status: BuildStatus.CANCELLED, finishedAt: new Date() } });
  }

}
