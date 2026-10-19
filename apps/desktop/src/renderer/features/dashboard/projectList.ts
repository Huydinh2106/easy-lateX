import type { ProjectCollaborationLink, RecentProject, SharedProject } from "@easy-latex/shared-types";

export interface ProjectCard {
  key: string;
  name: string;
  workspacePath?: string;
  collaborationId?: string;
  available: boolean;
  description: string;
}
export function projectList(recent: RecentProject[], remote: SharedProject[], links: ProjectCollaborationLink[]): ProjectCard[] {
  const projects: ProjectCard[] = [];
  const seen = new Set<string>();
  for (const local of recent) {
    const link = links.find(entry => entry.workspacePath === local.workspacePath);
    if (link) {
      if (seen.has(link.projectId)) continue;
      seen.add(link.projectId);
      const project = remote.find(entry => entry.id === link.projectId);
      projects.push({key: link.projectId, name: project?.name ?? local.name, workspacePath: local.workspacePath, collaborationId: link.projectId, available: true, description: local.workspacePath});
    } else projects.push({key: local.workspacePath, name: local.name, workspacePath: local.workspacePath, available: local.available, description: local.workspacePath});
  }
  for (const project of remote) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push({key: project.id, name: project.name, collaborationId: project.id, available: true, description: project.role === 'owner' ? 'Your project' : project.role === 'editor' ? 'Invited · Can edit' : 'Invited · View only'});
  }
  return projects;
}
