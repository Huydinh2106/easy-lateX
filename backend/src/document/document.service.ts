import { createHash, randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { FileKind, Prisma, ProjectRole } from "@prisma/client";
import mime from "mime-types";
import type { AuthUser } from "../common/current-user";
import { baseName, isDescendant, normalizeProjectPath, parentPath, textEditable } from "../common/path";
import { OBJECT_STORAGE } from "../common/tokens";
import { PrismaService } from "../database/prisma.service";
import { ProjectAccessService } from "../projects/project-access.service";
import type { ObjectStorage } from "../storage/object-storage";
import { DocumentEvents } from "./document.events";

export interface ApplyFileUpdateInput {
  projectId: string;
  path: string;
  content: Buffer;
  expectedVersion: number;
  actor: AuthUser;
  operationType?: "INSERT_TEXT" | "REPLACE_RANGE" | "DELETE_RANGE" | "REPLACE_FILE";
  operationMetadata?: Record<string, string | number | null>;
}
export interface ApplyResult { version: number; checksum: string; deduplicated: boolean }
export interface ProjectSnapshot { projectId: string; rootFile: string; files: Array<{ id: string; fileVersionId: string; path: string; version: number; storageKey: string; checksum: string; size: number }> }

@Injectable()
export class ProjectDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly events: DocumentEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage
  ) {}

  private async requireEdit(projectId: string, userId: string): Promise<void> {
    const role = await this.access.role(projectId, userId);
    if (role === ProjectRole.VIEWER) throw new ForbiddenException("Editor access is required");
  }

  async getProjectSnapshot(projectId: string, userId?: string): Promise<ProjectSnapshot> {
    if (userId) await this.access.role(projectId, userId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { rootFile: true } });
    if (!project) throw new NotFoundException("Project not found");
    const files = await this.prisma.fileEntry.findMany({
      where: { projectId, kind: FileKind.FILE, deletedAt: null, currentVersion: { gt: 0 } },
      select: { id: true, path: true, currentVersion: true }, orderBy: { path: "asc" }
    });
    const resolved = await Promise.all(files.map(async (file) => {
      const version = await this.prisma.fileVersion.findUnique({
        where: { fileEntryId_version: { fileEntryId: file.id, version: file.currentVersion } }
      });
      if (!version) throw new Error(`Missing immutable version ${file.currentVersion} for ${file.path}`);
      return { id: file.id, fileVersionId: version.id, path: file.path, version: version.version, storageKey: version.storageKey, checksum: version.checksum, size: version.size };
    }));
    return { projectId, rootFile: project.rootFile, files: resolved };
  }

  async listFiles(projectId: string, userId: string) {
    await this.access.role(projectId, userId);
    return this.prisma.fileEntry.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, path: true, parentPath: true, name: true, kind: true, mimeType: true, currentVersion: true, createdAt: true, updatedAt: true },
      orderBy: [{ kind: "asc" }, { path: "asc" }]
    });
  }

  async getFile(projectId: string, rawPath: string, userId: string) {
    await this.access.role(projectId, userId);
    const path = normalizeProjectPath(rawPath);
    const entry = await this.prisma.fileEntry.findFirst({ where: { projectId, path, deletedAt: null } });
    if (!entry || entry.kind !== FileKind.FILE) throw new NotFoundException("File not found");
    const version = await this.prisma.fileVersion.findUnique({ where: { fileEntryId_version: { fileEntryId: entry.id, version: entry.currentVersion } } });
    if (!version) throw new NotFoundException("File content not found");
    return { entry, version, stream: () => this.storage.getObject(version.storageKey), buffer: () => this.storage.getBuffer(version.storageKey, Math.max(version.size + 1, 1024)) };
  }

  async createEntry(projectId: string, rawPath: string, kind: FileKind, content: Buffer, actor: AuthUser, mimeType?: string) {
    await this.requireEdit(projectId, actor.id);
    const path = normalizeProjectPath(rawPath);
    await this.assertParent(projectId, path);
    const collision = await this.prisma.fileEntry.findFirst({ where: { projectId, path, deletedAt: null } });
    if (collision) throw new ConflictException("A file or folder already exists at this path");
    const id = randomUUID();
    const version = kind === FileKind.FILE ? 1 : 0;
    const checksum = createHash("sha256").update(content).digest("hex");
    const storageKey = `projects/${projectId}/files/${id}/versions/1`;
    const detectedMime = kind === FileKind.FILE ? this.detectMime(path, content, mimeType) : null;
    if (kind === FileKind.FILE) {
      await this.storage.putObject({ key: storageKey, body: content, contentLength: content.length, contentType: detectedMime ?? undefined });
    }
    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const created = await tx.fileEntry.create({ data: {
          id, projectId, path, parentPath: parentPath(path), name: baseName(path), kind,
          mimeType: detectedMime, currentVersion: version
        } });
        if (kind === FileKind.FILE) await tx.fileVersion.create({ data: { fileEntryId: id, version: 1, storageKey, checksum, size: content.length, createdBy: actor.id } });
        await tx.documentOperation.create({ data: { projectId, fileEntryId: id, actorId: actor.id, operationType: kind === FileKind.FILE ? "CREATE_FILE" : "CREATE_DIRECTORY", resultVersion: version || null, metadata: { path, actor: actor.firebaseUid } } });
        return created;
      });
      this.publish(projectId, actor.id, "entry.created", { path, kind });
      return entry;
    } catch (error) {
      if (kind === FileKind.FILE) await this.storage.deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async applyFileUpdate(input: ApplyFileUpdateInput): Promise<ApplyResult> {
    await this.requireEdit(input.projectId, input.actor.id);
    const path = normalizeProjectPath(input.path);
    const entry = await this.prisma.fileEntry.findFirst({ where: { projectId: input.projectId, path, deletedAt: null } });
    if (!entry || entry.kind !== FileKind.FILE) throw new NotFoundException("File not found");
    if (!textEditable(path)) throw new ForbiddenException("Use binary upload to replace this asset");
    if (entry.currentVersion !== input.expectedVersion) {
      throw new ConflictException({ message: "The file changed since it was opened", latestVersion: entry.currentVersion });
    }
    const checksum = createHash("sha256").update(input.content).digest("hex");
    const current = await this.prisma.fileVersion.findUnique({ where: { fileEntryId_version: { fileEntryId: entry.id, version: entry.currentVersion } } });
    if (current?.checksum === checksum) return { version: entry.currentVersion, checksum, deduplicated: true };
    const nextVersion = entry.currentVersion + 1;
    const storageKey = `projects/${input.projectId}/files/${entry.id}/versions/${nextVersion}`;
    await this.storage.putObject({ key: storageKey, body: input.content, contentLength: input.content.length, contentType: entry.mimeType ?? undefined });
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.fileEntry.updateMany({
          where: { id: entry.id, currentVersion: input.expectedVersion, deletedAt: null },
          data: { currentVersion: nextVersion }
        });
        if (updated.count !== 1) throw new ConflictException({ message: "The file changed while it was being saved", latestVersion: (await tx.fileEntry.findUnique({ where: { id: entry.id } }))?.currentVersion });
        await tx.fileVersion.create({ data: { fileEntryId: entry.id, version: nextVersion, storageKey, checksum, size: input.content.length, createdBy: input.actor.id } });
        await tx.documentOperation.create({ data: {
          projectId: input.projectId, fileEntryId: entry.id, actorId: input.actor.id,
          operationType: input.operationType ?? "REPLACE_FILE", baseVersion: input.expectedVersion, resultVersion: nextVersion,
          metadata: {
            path, bytes: input.content.length, checksum, actor: input.actor.firebaseUid,
            ...(input.operationMetadata ?? {})
          }
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.storage.deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
    this.publish(input.projectId, input.actor.id, "file.updated", { path, version: nextVersion });
    return { version: nextVersion, checksum, deduplicated: false };
  }

  async moveEntry(projectId: string, rawPath: string, rawNewPath: string, actor: AuthUser) {
    await this.requireEdit(projectId, actor.id);
    const path = normalizeProjectPath(rawPath);
    const newPath = normalizeProjectPath(rawNewPath);
    if (path === newPath) return;
    const entry = await this.prisma.fileEntry.findFirst({ where: { projectId, path, deletedAt: null } });
    if (!entry) throw new NotFoundException("File or folder not found");
    if (entry.kind === FileKind.DIRECTORY && isDescendant(newPath, path)) throw new ConflictException("A folder cannot be moved inside itself");
    await this.assertParent(projectId, newPath);
    const affected = await this.prisma.fileEntry.findMany({ where: { projectId, deletedAt: null, OR: [{ path }, { path: { startsWith: `${path}/` } }] }, orderBy: { path: "asc" } });
    const destinations = affected.map((item) => item.path === path ? newPath : `${newPath}${item.path.slice(path.length)}`);
    const collisions = await this.prisma.fileEntry.count({ where: { projectId, deletedAt: null, path: { in: destinations }, id: { notIn: affected.map((item) => item.id) } } });
    if (collisions) throw new ConflictException("The destination contains an existing file or folder");
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < affected.length; i += 1) {
        const destination = destinations[i];
        await tx.fileEntry.update({ where: { id: affected[i].id }, data: { path: destination, parentPath: parentPath(destination), name: baseName(destination) } });
      }
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { rootFile: true } });
      if (project && (project.rootFile === path || isDescendant(project.rootFile, path))) {
        await tx.project.update({ where: { id: projectId }, data: { rootFile: `${newPath}${project.rootFile.slice(path.length)}` } });
      }
      await tx.documentOperation.create({ data: { projectId, fileEntryId: entry.id, actorId: actor.id, operationType: "MOVE_FILE", metadata: { from: path, to: newPath, count: affected.length, actor: actor.firebaseUid } } });
    });
    this.publish(projectId, actor.id, "entry.moved", { from: path, to: newPath });
  }

  async deleteEntry(projectId: string, rawPath: string, actor: AuthUser): Promise<void> {
    await this.requireEdit(projectId, actor.id);
    const path = normalizeProjectPath(rawPath);
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { rootFile: true } });
    if (project?.rootFile === path || (project && isDescendant(project.rootFile, path))) throw new ConflictException("Choose another root document before deleting this path");
    const entry = await this.prisma.fileEntry.findFirst({ where: { projectId, path, deletedAt: null } });
    if (!entry) throw new NotFoundException("File or folder not found");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.fileEntry.updateMany({ where: { projectId, deletedAt: null, OR: [{ path }, { path: { startsWith: `${path}/` } }] }, data: { deletedAt: now } });
      await tx.documentOperation.create({ data: { projectId, fileEntryId: entry.id, actorId: actor.id, operationType: "DELETE_FILE", metadata: { path, actor: actor.firebaseUid } } });
    });
    this.publish(projectId, actor.id, "entry.deleted", { path });
  }

  async setRootFile(projectId: string, rawPath: string, actor: AuthUser) {
    await this.requireEdit(projectId, actor.id);
    const path = normalizeProjectPath(rawPath);
    if (!path.toLowerCase().endsWith(".tex")) throw new ForbiddenException("The root document must be a .tex file");
    const entry = await this.prisma.fileEntry.findFirst({ where: { projectId, path, kind: FileKind.FILE, deletedAt: null } });
    if (!entry) throw new NotFoundException("Root file not found");
    await this.prisma.$transaction([
      this.prisma.project.update({ where: { id: projectId }, data: { rootFile: path } }),
      this.prisma.documentOperation.create({ data: { projectId, fileEntryId: entry.id, actorId: actor.id, operationType: "SET_ROOT_FILE", metadata: { path, actor: actor.firebaseUid } } })
    ]);
    this.publish(projectId, actor.id, "project.root-changed", { path });
    return { rootFile: path };
  }

  async createRevision(projectId: string, actor: AuthUser) {
    await this.requireEdit(projectId, actor.id);
    const snapshot = await this.getProjectSnapshot(projectId);
    if (!snapshot.files.some((file) => file.path === snapshot.rootFile)) throw new ConflictException("The root document does not exist");
    const sequence = (await this.prisma.projectRevision.aggregate({ where: { projectId }, _max: { sequence: true } }))._max.sequence ?? 0;
    const id = randomUUID();
    const manifestStorageKey = `projects/${projectId}/revisions/${id}/manifest.json`;
    const manifest = Buffer.from(JSON.stringify({ revisionId: id, sequence: sequence + 1, rootFile: snapshot.rootFile, files: snapshot.files }), "utf8");
    await this.storage.putObject({ key: manifestStorageKey, body: manifest, contentLength: manifest.length, contentType: "application/json" });
    try {
      return await this.prisma.projectRevision.create({ data: {
        id, projectId, sequence: sequence + 1, rootFile: snapshot.rootFile, manifestStorageKey, createdBy: actor.id,
        files: { create: snapshot.files.map((file) => ({ fileEntryId: file.id, fileVersionId: file.fileVersionId, path: file.path, storageKey: file.storageKey, checksum: file.checksum, size: file.size })) }
      }, include: { files: true } });
    } catch (error) {
      await this.storage.deleteObject(manifestStorageKey).catch(() => undefined);
      throw error;
    }
  }

  async listRevisions(projectId: string, userId: string) {
    await this.access.role(projectId, userId);
    return this.prisma.projectRevision.findMany({
      where: { projectId },
      orderBy: { sequence: "desc" },
      take: 100,
      select: {
        id: true,
        sequence: true,
        rootFile: true,
        createdAt: true,
        createdBy: true,
        creator: { select: { displayName: true, email: true } },
        _count: { select: { files: true, builds: true } },
        builds: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, createdAt: true }
        }
      }
    });
  }

  async listHistory(projectId: string, userId: string) {
    await this.access.role(projectId, userId);
    return this.prisma.documentOperation.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        fileEntryId: true,
        operationType: true,
        baseVersion: true,
        resultVersion: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true, email: true } }
      }
    });
  }

  async getRevisionFile(projectId: string, revisionId: string, rawPath: string, userId: string) {
    await this.access.role(projectId, userId);
    const filePath = normalizeProjectPath(rawPath);
    const file = await this.prisma.revisionFile.findFirst({
      where: { revisionId, path: filePath, revision: { projectId } },
      include: { fileVersion: true }
    });
    if (!file) throw new NotFoundException("Revision file not found");
    return {
      path: file.path,
      version: file.fileVersion.version,
      checksum: file.checksum,
      size: file.size,
      binary: !textEditable(file.path),
      buffer: () => this.storage.getBuffer(file.storageKey, Math.max(file.size + 1, 1024))
    };
  }

  subscribe(projectId: string) { return this.events.subscribe(projectId); }

  private async assertParent(projectId: string, path: string): Promise<void> {
    const parent = parentPath(path);
    if (!parent) return;
    const folder = await this.prisma.fileEntry.findFirst({ where: { projectId, path: parent, kind: FileKind.DIRECTORY, deletedAt: null } });
    if (!folder) throw new NotFoundException("Parent folder does not exist");
  }

  private detectMime(path: string, content: Buffer, claimedMime?: string): string {
    const inferred = mime.lookup(path) || "application/octet-stream";
    if (claimedMime && claimedMime !== "application/octet-stream" && inferred !== "application/octet-stream" && claimedMime !== inferred) {
      throw new ForbiddenException("Uploaded MIME type does not match the file extension");
    }
    if (inferred.startsWith("image/") && content.length >= 4) {
      const png = content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = content[0] === 0xff && content[1] === 0xd8;
      const pdf = content.subarray(0, 4).toString() === "%PDF";
      if ((inferred === "image/png" && !png) || (inferred === "image/jpeg" && !jpeg)) throw new ForbiddenException("Uploaded content does not match its image extension");
      if (pdf) throw new ForbiddenException("PDF content cannot be uploaded with an image extension");
    }
    return String(inferred);
  }

  private publish(projectId: string, actorId: string, type: string, metadata: Record<string, unknown>): void {
    this.events.publish({ projectId, actorId, type, metadata, timestamp: new Date().toISOString() });
  }
}
