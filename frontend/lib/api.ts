import { getFirebaseAuth } from "@/lib/firebase";

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  rootFile: string;
  latestSuccessfulBuildId: string | null;
  createdAt: string;
  updatedAt: string;
  currentRole?: "OWNER" | "EDITOR" | "VIEWER";
}

export interface FileEntry {
  id: string;
  path: string;
  parentPath: string;
  name: string;
  kind: "FILE" | "DIRECTORY";
  mimeType: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileContent {
  path: string;
  version: number;
  mimeType: string | null;
  binary: boolean;
  content?: string;
}

export interface CompileError { file: string | null; line: number | null; message: string }
export interface Build {
  id: string;
  projectId: string;
  revisionId: string;
  rootFile: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  exitCode: number | null;
  durationMs: number | null;
  errorSummary: { message?: string; errors?: CompileError[] } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface OutlineItem {
  type: string;
  title: string;
  file: string;
  line: number;
  column: number;
  offset: number;
  sourceRange: { start: number; end: number };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) { super(message); }
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const DEVELOPMENT_AUTH = process.env.NEXT_PUBLIC_AUTH_MODE === "development";

async function authHeaders(json = true): Promise<HeadersInit> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (!DEVELOPMENT_AUTH) {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("Please sign in to continue");
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  return headers;
}

async function parseFailure(response: Response): Promise<never> {
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  const body = payload as { message?: string | string[]; detail?: string } | undefined;
  const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message ?? body?.detail ?? `Request failed with status ${response.status}`;
  throw new ApiError(message, response.status, payload);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...(await authHeaders(init.body !== undefined)), ...init.headers } });
  if (!response.ok) return parseFailure(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const getProjects = () => request<Project[]>("/projects", { cache: "no-store" });
export const getProject = (id: string) => request<Project>(`/projects/${id}`, { cache: "no-store" });
export const createProject = (name: string) => request<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) });
export const updateProject = (id: string, name: string) => request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const deleteProject = (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" });

export const getFiles = (id: string) => request<FileEntry[]>(`/projects/${id}/files`, { cache: "no-store" });
export const getFileContent = (id: string, path: string) => request<FileContent>(`/projects/${id}/files/content?path=${encodeURIComponent(path)}`, { cache: "no-store" });
export const createFile = (id: string, path: string, kind: FileEntry["kind"], content = "") => request<FileEntry>(`/projects/${id}/files`, { method: "POST", body: JSON.stringify({ path, kind, content }) });
export const saveFile = (id: string, path: string, content: string, expectedVersion: number) => request<{ version: number; checksum: string; deduplicated: boolean }>(`/projects/${id}/files/content`, { method: "PUT", body: JSON.stringify({ path, content, expectedVersion }) });
export const moveFile = (id: string, path: string, newPath: string) => request<void>(`/projects/${id}/files`, { method: "PATCH", body: JSON.stringify({ path, newPath }) });
export const deleteFile = (id: string, path: string) => request<void>(`/projects/${id}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
export const setRootFile = (id: string, rootFile: string) => request<{ rootFile: string }>(`/projects/${id}/settings`, { method: "PATCH", body: JSON.stringify({ rootFile }) });
export const getOutline = (id: string, path: string) => request<OutlineItem[]>(`/projects/${id}/outline?path=${encodeURIComponent(path)}`, { cache: "no-store" });
export const createBuild = (id: string) => request<Build>(`/projects/${id}/builds`, { method: "POST" });
export const getBuild = (id: string, buildId: string) => request<Build>(`/projects/${id}/builds/${buildId}`, { cache: "no-store" });
export const getLatestBuild = (id: string) => request<Build | null>(`/projects/${id}/builds/latest`, { cache: "no-store" });

export async function authorizedBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: await authHeaders(false), cache: "no-store" });
  if (!response.ok) return parseFailure(response);
  return response.blob();
}

export async function getBuildLog(projectId: string, buildId: string): Promise<string> {
  const blob = await authorizedBlob(`/projects/${projectId}/builds/${buildId}/log`);
  return blob.text();
}

export const getBuildPdf = (projectId: string, buildId: string) => authorizedBlob(`/projects/${projectId}/builds/${buildId}/pdf`);
export const downloadFile = (projectId: string, path: string) => authorizedBlob(`/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`);

export async function uploadFile(projectId: string, path: string, file: File): Promise<FileEntry> {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}/files/upload?path=${encodeURIComponent(path)}`, { method: "POST", headers: await authHeaders(false), body: data });
  if (!response.ok) return parseFailure(response);
  return response.json() as Promise<FileEntry>;
}
