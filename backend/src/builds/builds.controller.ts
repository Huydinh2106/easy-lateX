import { Controller, Get, NotFoundException, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthUser } from "../common/current-user";
import { CurrentUser } from "../common/current-user";
import { OBJECT_STORAGE } from "../common/tokens";
import { Inject } from "@nestjs/common";
import type { ObjectStorage } from "../storage/object-storage";
import { BuildsService } from "./builds.service";

@Controller("projects/:projectId/builds")
export class BuildsController {
  constructor(private readonly builds: BuildsService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Post()
  create(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) { return this.builds.create(projectId, user); }

  @Get()
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) { return this.builds.list(projectId, user.id); }

  @Get("latest")
  latest(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) { return this.builds.latest(projectId, user.id); }

  @Get(":buildId")
  get(@Param("projectId") projectId: string, @Param("buildId") buildId: string, @CurrentUser() user: AuthUser) { return this.builds.get(projectId, buildId, user.id); }

  @Get(":buildId/log")
  async log(@Param("projectId") projectId: string, @Param("buildId") buildId: string, @CurrentUser() user: AuthUser, @Res() reply: FastifyReply) {
    const build = await this.builds.get(projectId, buildId, user.id);
    if (!build.logStorageKey) throw new NotFoundException("Compile log is not available");
    reply.header("content-type", "text/plain; charset=utf-8").header("cache-control", "private, no-store");
    return reply.send(await this.storage.getObject(build.logStorageKey));
  }

  @Get(":buildId/pdf")
  async pdf(@Param("projectId") projectId: string, @Param("buildId") buildId: string, @CurrentUser() user: AuthUser, @Res() reply: FastifyReply) {
    const build = await this.builds.get(projectId, buildId, user.id);
    if (!build.pdfStorageKey) throw new NotFoundException("PDF is not available");
    reply.header("content-type", "application/pdf").header("cache-control", "private, no-store");
    return reply.send(await this.storage.getObject(build.pdfStorageKey));
  }

  @Post(":buildId/cancel")
  cancel(@Param("projectId") projectId: string, @Param("buildId") buildId: string, @CurrentUser() user: AuthUser) { return this.builds.cancel(projectId, buildId, user); }
}
