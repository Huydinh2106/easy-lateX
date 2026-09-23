import fs from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { BuildStatus, Prisma } from "@prisma/client";
import type { AppConfig } from "../common/config";
import { normalizeProjectPath } from "../common/path";
import { APP_CONFIG, COMPILER_ADAPTER, OBJECT_STORAGE } from "../common/tokens";
import type { CompilerAdapter } from "../compiler/compiler-adapter";
import { PrismaService } from "../database/prisma.service";
import type { ObjectStorage } from "../storage/object-storage";
import { parseCompileErrors } from "./log-parser";

@Injectable()
export class BuildProcessorService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(COMPILER_ADAPTER) private readonly compiler: CompilerAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  async process(buildId: string, jobId: string): Promise<void> {
    const build = await this.prisma.build.findUnique({ where: { id: buildId }, include: { revision: { include: { files: true } } } });
    if (!build) throw new Error(`Build ${buildId} does not exist`);
    if (build.status === BuildStatus.CANCELLED || build.status === BuildStatus.SUCCEEDED) return;
    await this.prisma.build.update({ where: { id: buildId }, data: { status: BuildStatus.RUNNING, startedAt: new Date(), queueJobId: jobId } });
    const total = build.revision.files.reduce((sum, file) => sum + file.size, 0);
    if (total > this.config.compiler.maxSourceBytes) {
      await this.prisma.build.update({ where: { id: buildId }, data: { status: BuildStatus.FAILED, finishedAt: new Date(), errorSummary: { message: "Project source exceeds compile size limit" } } });
      return;
    }
    await fs.mkdir(this.config.compiler.workspaceBase, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(this.config.compiler.workspaceBase, `build-${buildId}-`));
    try {
      for (const file of build.revision.files) {
        const safePath = normalizeProjectPath(file.path);
        const destination = path.join(workspace, ...safePath.split("/"));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, await this.storage.getBuffer(file.storageKey, file.size + 1));
      }
      const result = await this.compiler.compile({ workspacePath: workspace, rootFile: build.rootFile, buildId });
      const logKey = `projects/${build.projectId}/builds/${buildId}/compile.log`;
      await this.storage.putObject({ key: logKey, body: result.log, contentLength: result.log.length, contentType: "text/plain; charset=utf-8" });
      const current = await this.prisma.build.findUnique({ where: { id: buildId }, select: { status: true } });
      if (current?.status === BuildStatus.CANCELLED) return;
      if (result.success && result.pdfPath) {
        const pdf = await fs.readFile(result.pdfPath);
        if (!pdf.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("Compiler output is not a PDF");
        const pdfKey = `projects/${build.projectId}/builds/${buildId}/document.pdf`;
        await this.storage.putObject({ key: pdfKey, body: pdf, contentLength: pdf.length, contentType: "application/pdf" });
        let synctexKey: string | null = null;
        if (result.synctexPath) {
          const synctex = await fs.readFile(result.synctexPath);
          if (synctex.length <= this.config.compiler.maxArtifactBytes) {
            synctexKey = `projects/${build.projectId}/builds/${buildId}/document.synctex.gz`;
            await this.storage.putObject({ key: synctexKey, body: synctex, contentLength: synctex.length, contentType: "application/gzip" });
          }
        }
        await this.prisma.$transaction([
          this.prisma.build.update({ where: { id: buildId }, data: {
            status: BuildStatus.SUCCEEDED, finishedAt: new Date(), exitCode: result.exitCode, durationMs: result.durationMs,
            pdfStorageKey: pdfKey, logStorageKey: logKey, synctexStorageKey: synctexKey, errorSummary: Prisma.JsonNull
          } }),
          this.prisma.project.update({ where: { id: build.projectId }, data: { latestSuccessfulBuildId: buildId } })
        ]);
      } else {
        const errors = parseCompileErrors(result.log.toString("utf8"));
        await this.prisma.build.update({ where: { id: buildId }, data: {
          status: result.timedOut ? BuildStatus.TIMED_OUT : BuildStatus.FAILED,
          finishedAt: new Date(), exitCode: result.exitCode, durationMs: result.durationMs, logStorageKey: logKey,
          errorSummary: { message: result.timedOut ? "Compilation timed out" : (errors[0]?.message ?? "LaTeX compilation failed"), errors } as unknown as Prisma.InputJsonValue
        } });
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
}
