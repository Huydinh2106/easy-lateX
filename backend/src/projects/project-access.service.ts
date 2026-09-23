import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

const rank: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async role(projectId: string, userId: string): Promise<ProjectRole> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, members: { where: { userId }, select: { role: true } } }
    });
    if (!project) throw new NotFoundException("Project not found");
    if (project.ownerId === userId) return ProjectRole.OWNER;
    const membership = project.members[0];
    if (!membership) throw new NotFoundException("Project not found");
    return membership.role;
  }

  async require(projectId: string, userId: string, minimum: ProjectRole): Promise<ProjectRole> {
    const role = await this.role(projectId, userId);
    if (rank[role] < rank[minimum]) throw new ForbiddenException("Your project role does not allow this action");
    return role;
  }
}
