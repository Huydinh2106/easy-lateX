export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  workspace_status: string;
  workspace_identifier: string;
}

export interface Workspace {
  project_id: string;
  status: string;
  workspace_url: string | null;
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // The status-based message remains useful for non-JSON failures.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getProjects(): Promise<Project[]> {
  return request<Project[]>("/projects", { cache: "no-store" });
}

export function createProject(name: string): Promise<Project> {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteProject(projectId: string): Promise<void> {
  return request<void>(`/projects/${projectId}`, { method: "DELETE" });
}

export function openProject(projectId: string): Promise<Workspace> {
  return request<Workspace>(`/projects/${projectId}/open`, { method: "POST" });
}
