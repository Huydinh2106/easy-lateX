import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { FileKind } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser } from "../common/current-user";
import { CurrentUser } from "../common/current-user";
import { textEditable } from "../common/path";
import { ProjectDocumentService } from "../document/document.service";
import { LatexParserService } from "../parser/latex-parser.service";
import { CreateFileDto, MoveFileDto, SetRootFileDto, UpdateContentDto } from "./files.dto";

@Controller("projects/:projectId")
export class FilesController {
  constructor(private readonly documents: ProjectDocumentService, private readonly parser: LatexParserService) {}

  @Get("files")
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) { return this.documents.listFiles(projectId, user.id); }

  @Get("files/content")
  async content(@Param("projectId") projectId: string, @Query("path") path: string, @CurrentUser() user: AuthUser) {
    const file = await this.documents.getFile(projectId, path, user.id);
    if (!textEditable(file.entry.path)) return { path: file.entry.path, version: file.entry.currentVersion, mimeType: file.entry.mimeType, binary: true };
    const buffer = await file.buffer();
    return { path: file.entry.path, version: file.entry.currentVersion, mimeType: file.entry.mimeType, binary: false, content: buffer.toString("utf8") };
  }

  @Get("files/download")
  async download(@Param("projectId") projectId: string, @Query("path") path: string, @CurrentUser() user: AuthUser, @Res() reply: FastifyReply) {
    const file = await this.documents.getFile(projectId, path, user.id);
    reply.header("content-type", file.entry.mimeType ?? "application/octet-stream");
    reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.entry.name)}`);
    reply.header("cache-control", "private, no-store");
    return reply.send(await file.stream());
  }

  @Post("files")
  create(@Param("projectId") projectId: string, @Body() body: CreateFileDto, @CurrentUser() user: AuthUser) {
    return this.documents.createEntry(projectId, body.path, body.kind, Buffer.from(body.content ?? "", "utf8"), user, body.mimeType);
  }

  @Post("files/upload")
  async upload(@Param("projectId") projectId: string, @Query("path") path: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthUser) {
    const part = await request.file();
    if (!part) throw new BadRequestException("A multipart file is required");
    const content = await part.toBuffer();
    return this.documents.createEntry(projectId, path || part.filename, FileKind.FILE, content, user, part.mimetype);
  }

  @Put("files/content")
  save(@Param("projectId") projectId: string, @Body() body: UpdateContentDto, @CurrentUser() user: AuthUser) {
    return this.documents.applyFileUpdate({ projectId, path: body.path, content: Buffer.from(body.content, "utf8"), expectedVersion: body.expectedVersion, actor: user });
  }

  @Patch("files")
  move(@Param("projectId") projectId: string, @Body() body: MoveFileDto, @CurrentUser() user: AuthUser) {
    return this.documents.moveEntry(projectId, body.path, body.newPath, user);
  }

  @Delete("files")
  @HttpCode(204)
  remove(@Param("projectId") projectId: string, @Query("path") path: string, @CurrentUser() user: AuthUser) {
    return this.documents.deleteEntry(projectId, path, user);
  }

  @Patch("settings")
  settings(@Param("projectId") projectId: string, @Body() body: SetRootFileDto, @CurrentUser() user: AuthUser) {
    return this.documents.setRootFile(projectId, body.rootFile, user);
  }

  @Get("outline")
  async outline(@Param("projectId") projectId: string, @Query("path") path: string, @CurrentUser() user: AuthUser) {
    const file = await this.documents.getFile(projectId, path, user.id);
    if (!textEditable(file.entry.path)) return [];
    return this.parser.parseOutline((await file.buffer()).toString("utf8"), file.entry.path);
  }

  @Get("revisions")
  revisions(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.documents.listRevisions(projectId, user.id);
  }

  @Get("revisions/:revisionId/files/content")
  async revisionContent(
    @Param("projectId") projectId: string,
    @Param("revisionId") revisionId: string,
    @Query("path") path: string,
    @CurrentUser() user: AuthUser
  ) {
    const file = await this.documents.getRevisionFile(projectId, revisionId, path, user.id);
    if (file.binary) return { path: file.path, version: file.version, checksum: file.checksum, binary: true };
    return { path: file.path, version: file.version, checksum: file.checksum, binary: false, content: (await file.buffer()).toString("utf8") };
  }

  @Get("history")
  history(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.documents.listHistory(projectId, user.id);
  }
}
