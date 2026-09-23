import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { FileKind, ProjectRole } from "@prisma/client";
import type { AuthUser } from "../common/current-user";
import { OBJECT_STORAGE } from "../common/tokens";
import { PrismaService } from "../database/prisma.service";
import type { ObjectStorage } from "../storage/object-storage";
import { ProjectAccessService } from "./project-access.service";

const DEFAULT_MAIN = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\title{Untitled Project}
\author{}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Start writing your document here.

\end{document}
`;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage
  ) {}

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, ownerId: true, name: true, rootFile: true, latestSuccessfulBuildId: true, createdAt: true, updatedAt: true,
        members: { where: { userId }, select: { role: true }, take: 1 }
      }
    });
    return projects.map(({ members, ...project }) => ({
      ...project,
      currentRole: project.ownerId === userId ? ProjectRole.OWNER : members[0]?.role ?? ProjectRole.VIEWER
    }));
  }

  async get(projectId: string, userId: string) {
    const currentRole = await this.access.role(projectId, userId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true, name: true, rootFile: true, latestSuccessfulBuildId: true, createdAt: true, updatedAt: true }
    });
    if (!project) throw new NotFoundException("Project not found");
    return { ...project, currentRole };
  }

  async create(name: string, actor: AuthUser) {
    const projectId = randomUUID();
    const fileId = randomUUID();
    const content = Buffer.from(DEFAULT_MAIN, "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const storageKey = `projects/${projectId}/files/${fileId}/versions/1`;
    await this.storage.putObject({ key: storageKey, body: content, contentLength: content.length, contentType: "application/x-tex" });
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.project.create({ data: { id: projectId, ownerId: actor.id, name: name.trim(), rootFile: "main.tex" } });
        await tx.projectMember.create({ data: { projectId, userId: actor.id, role: ProjectRole.OWNER } });
        await tx.fileEntry.create({
          data: {
            id: fileId, projectId, path: "main.tex", parentPath: "", name: "main.tex",
            kind: FileKind.FILE, mimeType: "application/x-tex", currentVersion: 1,
            versions: { create: { version: 1, storageKey, checksum, size: content.length, createdBy: actor.id } },
            operations: { create: { projectId, actorId: actor.id, operationType: "CREATE_FILE", resultVersion: 1, metadata: { path: "main.tex", actor: actor.firebaseUid } } }
          }
        });
      });
    } catch (error) {
      await this.storage.deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
    return this.get(projectId, actor.id);
  }

  async update(projectId: string, userId: string, name: string) {
    const role = await this.access.role(projectId, userId);
    if (role !== ProjectRole.OWNER) throw new NotFoundException("Project not found");
    await this.prisma.project.update({ where: { id: projectId }, data: { name: name.trim() } });
    return this.get(projectId, userId);
  }

  async remove(projectId: string, userId: string): Promise<void> {
    const role = await this.access.role(projectId, userId);
    if (role !== ProjectRole.OWNER) throw new NotFoundException("Project not found");
    const keys = await this.prisma.fileVersion.findMany({ where: { fileEntry: { projectId } }, select: { storageKey: true } });
    const builds = await this.prisma.build.findMany({ where: { projectId }, select: { pdfStorageKey: true, logStorageKey: true, synctexStorageKey: true } });
    const revisions = await this.prisma.projectRevision.findMany({ where: { projectId }, select: { manifestStorageKey: true } });
    // RevisionFile intentionally protects immutable revision snapshots with
    // restrictive foreign keys. Remove the project aggregate from the leaves
    // inward so project deletion remains atomic without weakening that model.
    await this.prisma.$transaction(async (tx) => {
      await tx.build.deleteMany({ where: { projectId } });
      await tx.revisionFile.deleteMany({ where: { revision: { projectId } } });
      await tx.projectRevision.deleteMany({ where: { projectId } });
      await tx.documentOperation.deleteMany({ where: { projectId } });
      await tx.fileVersion.deleteMany({ where: { fileEntry: { projectId } } });
      await tx.fileEntry.deleteMany({ where: { projectId } });
      await tx.projectMember.deleteMany({ where: { projectId } });
      await tx.project.delete({ where: { id: projectId } });
    });
    const allKeys = [
      ...keys.map((item) => item.storageKey), ...revisions.map((item) => item.manifestStorageKey),
      ...builds.flatMap((item) => [item.pdfStorageKey, item.logStorageKey, item.synctexStorageKey]).filter((key): key is string => Boolean(key))
    ];
    await Promise.allSettled([...new Set(allKeys)].map((key) => this.storage.deleteObject(key)));
  }
}
