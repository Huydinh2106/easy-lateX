import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ProjectRole } from "@prisma/client";
import { AuthGuard } from "../src/auth/auth.guard";
import type { AppConfig } from "../src/common/config";
import type { PrismaService } from "../src/database/prisma.service";
import { ProjectAccessService } from "../src/projects/project-access.service";

const config = (authMode: "development" | "firebase"): AppConfig => ({
  nodeEnv: "test", port: 8000, authMode, redisUrl: "redis://test", corsOrigins: [],
  s3: { bucket: "test", accessKeyId: "test", secretAccessKey: "test", region: "auto", forcePathStyle: true },
  compiler: { image: "compiler", workspaceBase: "/tmp", timeoutMs: 1000, maxSourceBytes: 1000, maxLogBytes: 1000, maxArtifactBytes: 1000 }
});

describe("authentication and project authorization", () => {
  it("upserts the fixed development identity and attaches it to the request", async () => {
    const request: Record<string, unknown> = { headers: {} };
    const prisma = { user: { upsert: jest.fn().mockResolvedValue({ id: "user-1", firebaseUid: "development-user", email: "developer@easy-latex.local", displayName: "Development User" }) } } as unknown as PrismaService;
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    const guard = new AuthGuard(reflector, prisma, config("development"));
    const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((prisma as any).user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { firebaseUid: "development-user" } }));
    expect(request.user).toEqual(expect.objectContaining({ id: "user-1", firebaseUid: "development-user" }));
  });

  it("requires a bearer token in Firebase mode", async () => {
    const prisma = { user: { upsert: jest.fn() } } as unknown as PrismaService;
    const guard = new AuthGuard({ getAllAndOverride: () => false } as unknown as Reflector, prisma, config("firebase"));
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect((prisma as any).user.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [{ ownerId: "owner", members: [] }, "owner", ProjectRole.OWNER],
    [{ ownerId: "owner", members: [{ role: ProjectRole.EDITOR }] }, "editor", ProjectRole.EDITOR],
    [{ ownerId: "owner", members: [{ role: ProjectRole.VIEWER }] }, "viewer", ProjectRole.VIEWER]
  ])("resolves owner/member roles", async (project, userId, expected) => {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue(project) } } as unknown as PrismaService;
    await expect(new ProjectAccessService(prisma).role("project", userId)).resolves.toBe(expected);
  });

  it("hides projects from non-members to prevent IDOR", async () => {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue({ ownerId: "owner", members: [] }) } } as unknown as PrismaService;
    await expect(new ProjectAccessService(prisma).role("private-project", "intruder")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("enforces the role hierarchy", async () => {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue({ ownerId: "owner", members: [{ role: ProjectRole.VIEWER }] }) } } as unknown as PrismaService;
    await expect(new ProjectAccessService(prisma).require("project", "viewer", ProjectRole.EDITOR)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
