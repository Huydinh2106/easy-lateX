import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import IORedis from "ioredis";
import type { AppConfig } from "../common/config";
import { Public } from "../common/public";
import { APP_CONFIG, OBJECT_STORAGE } from "../common/tokens";
import { PrismaService } from "../database/prisma.service";
import type { ObjectStorage } from "../storage/object-storage";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Public()
  @Get("live")
  live() { return { status: "ok" }; }

  @Public()
  @Get("ready")
  async ready() {
    const redis = new IORedis(this.config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await redis.connect();
      await redis.ping();
      await this.storage.readiness();
      return { status: "ready", checks: { postgres: "ok", redis: "ok", storage: "ok" } };
    } catch {
      throw new ServiceUnavailableException("A required dependency is unavailable");
    } finally {
      redis.disconnect();
    }
  }
}
