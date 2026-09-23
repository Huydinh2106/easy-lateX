import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";
import type { AuthUser } from "../common/current-user";
import { CurrentUser } from "../common/current-user";
import { PrismaService } from "../database/prisma.service";
import { ProjectAccessService } from "./project-access.service";
import { AddMemberDto, UpdateMemberDto } from "./projects.dto";

@Controller("projects/:projectId/members")
export class MembersController {
  constructor(private readonly prisma: PrismaService, private readonly access: ProjectAccessService) {}

  private async owner(projectId: string, userId: string): Promise<void> {
    if (await this.access.role(projectId, userId) !== ProjectRole.OWNER) throw new ForbiddenException("Owner access is required");
  }

  @Get()
  async list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    await this.access.role(projectId, user.id);
    return this.prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, email: true, displayName: true } } } });
  }

  @Post()
  async add(@Param("projectId") projectId: string, @Body() body: AddMemberDto, @CurrentUser() user: AuthUser) {
    await this.owner(projectId, user.id);
    if (body.role === ProjectRole.OWNER) throw new ForbiddenException("Ownership transfer is not supported by this endpoint");
    const member = await this.prisma.user.findFirst({ where: { email: { equals: body.email, mode: "insensitive" } } });
    if (!member) throw new ForbiddenException("The user must sign in once before being added");
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: member.id } },
      update: { role: body.role }, create: { projectId, userId: member.id, role: body.role }
    });
  }

  @Patch(":memberId")
  async update(@Param("projectId") projectId: string, @Param("memberId") memberId: string, @Body() body: UpdateMemberDto, @CurrentUser() user: AuthUser) {
    await this.owner(projectId, user.id);
    if (body.role === ProjectRole.OWNER) throw new ForbiddenException("Ownership transfer is not supported by this endpoint");
    return this.prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: memberId } }, data: { role: body.role } });
  }

  @Delete(":memberId")
  async remove(@Param("projectId") projectId: string, @Param("memberId") memberId: string, @CurrentUser() user: AuthUser) {
    await this.owner(projectId, user.id);
    return this.prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId: memberId } } });
  }
}
