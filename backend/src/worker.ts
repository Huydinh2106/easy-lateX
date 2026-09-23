import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { BuildStatus } from "@prisma/client";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { AppModule } from "./app.module";
import { BuildProcessorService } from "./builds/build-processor.service";
import { BUILD_QUEUE } from "./builds/builds.service";
import type { AppConfig } from "./common/config";
import { APP_CONFIG } from "./common/tokens";
import { PrismaService } from "./database/prisma.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  const processor = app.get(BuildProcessorService);
  const prisma = app.get(PrismaService);
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const logger = new Logger("CompileWorker");
  const worker = new Worker(BUILD_QUEUE, async (job: Job<{ buildId: string }>) => processor.process(job.data.buildId, String(job.id)), {
    connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2), lockDuration: config.compiler.timeoutMs + 30000,
    stalledInterval: 30000, maxStalledCount: 1
  });
  worker.on("active", (job) => logger.log({ buildId: job.data.buildId, jobId: job.id, attempt: job.attemptsMade + 1 }, "compile job active"));
  worker.on("completed", (job) => logger.log({ buildId: job.data.buildId, jobId: job.id }, "compile job completed"));
  worker.on("failed", (job, error) => {
    if (!job) return;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.error({ buildId: job.data.buildId, jobId: job.id, attemptsMade: job.attemptsMade, exhausted, errorCode: error.name }, "compile job failed");
    void prisma.build.updateMany({
      where: { id: job.data.buildId, status: { in: [BuildStatus.QUEUED, BuildStatus.RUNNING] } },
      data: exhausted
        ? { status: BuildStatus.FAILED, finishedAt: new Date(), errorSummary: { message: "Compile worker infrastructure failed", code: error.name } }
        : { status: BuildStatus.QUEUED, startedAt: null, errorSummary: { message: "Compile infrastructure retry scheduled", code: error.name } }
    });
  });
  worker.on("error", (error) => logger.error({ errorCode: error.name }, "BullMQ worker error"));
  const shutdown = async () => { await worker.close(); await connection.quit(); await app.close(); process.exit(0); };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void bootstrap();
