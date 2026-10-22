export interface Account {
  id: string;
  githubId?: string;
  githubLogin?: string;
  email: string;
  displayName: string;
}
export interface AccountState {
  configured: boolean;
  apiUrl?: string;
  sessionPersistence?: 'secure' | 'memory';
  googleEnabled: boolean;
  account: Account | null;
  recovery: boolean;
}
export interface Credentials { email: string; password: string; }
export interface SharedProject {
  id: string;
  name: string;
  repository?: GitRepository;
  role: "owner" | "editor" | "viewer";
}
export interface ProjectFileInput { path: string; content: string; encoding?: "utf8" | "base64" | undefined; }
export interface SharedFile {
  encoding: "utf8" | "base64";
  id: string;
  projectId: string;
  path: string;
  content: string;
  version: number;
  updatedAt: string;
  editor: { id: string; displayName: string; expiresAt: string } | null;
}
export interface EditLease { token: string; expiresAt: string; file: SharedFile; }
export interface FileRevision { id: string; version: number; author: string; createdAt: string; content: string; }
export interface ProjectInvitation { id: string; projectId: string; projectName: string; role: "editor" | "viewer"; }
export interface DoneInput { fileId: string; token: string; baseVersion: number; content: string; requestId: string; }
export interface SharedProjectInput { name: string; files?: ProjectFileInput[] | undefined; directories?: string[] | undefined; requestId?: string | undefined; }
export interface ProjectCollaborationLink { workspacePath: string; projectId: string; }
export interface ProjectUpdateEvent { projectId: string; type: "connected" | "changed" | "disconnected"; commitSha?: string | null; }
export interface SharedProjectSnapshot { files: SharedFile[]; directories: string[]; workspacePath: string; }
export interface CollaborationApi {
  legacyConfirmation(email:string):Promise<void>;
  linkLegacy(email:string,code:string):Promise<void>;
  legacyProjects():Promise<SharedProject[]>;
  migrateLegacy(projectId:string):Promise<{project:SharedProject;limitations:string}>;
  onProjectUpdate(projectId: string, callback: (event: ProjectUpdateEvent) => void): () => void;
  links(): Promise<ProjectCollaborationLink[]>;
  importProject(): Promise<SharedProject | null>;
  shareCurrentProject(): Promise<SharedProject>;
  projects(): Promise<SharedProject[]>;
  create(input: SharedProjectInput): Promise<SharedProject>;
  files(projectId: string): Promise<SharedFile[]>;
  snapshot(projectId: string): Promise<SharedProjectSnapshot>;
  createFile(projectId: string, path: string): Promise<SharedFile>;
  directories(projectId: string): Promise<string[]>;
  createDirectory(projectId: string, path: string): Promise<string>;
  importFiles(projectId: string, destinationDirectory: string): Promise<string[]>;
  importFolder(projectId: string, destinationDirectory: string): Promise<string[]>;
  importDropped(projectId: string, sourcePaths: string[], destinationDirectory: string): Promise<string[]>;
  acquire(fileId: string): Promise<EditLease>;
  renew(fileId: string, token: string): Promise<{ expiresAt: string }>;
  done(input: DoneInput): Promise<SharedFile>;
  release(fileId: string, token: string): Promise<void>;
  history(fileId: string): Promise<FileRevision[]>;
  invite(projectId: string, email: string, role: "editor" | "viewer"): Promise<void>;
  invitations(): Promise<ProjectInvitation[]>;
  accept(invitationId: string): Promise<void>;
  saveDraft(projectId: string, path: string, content: string, baseVersion: number): Promise<void>;
  draft(projectId: string, path: string): Promise<{ content: string; baseVersion: number } | null>;
  clearDraft(projectId: string, path: string): Promise<void>;
  cancelCompile(): Promise<boolean>;
  compile(projectId: string, files: ProjectFileInput[], rootDocument: string, engine: import("./Project").LatexEngine): Promise<import("./CompileResult").CompileResult>;
}

export interface GitRepository { id:number; owner:string; name:string; branch:string; head:string|null; }
export interface GitFileMetadata extends Omit<SharedFile,'content'> { blobSha:string; }
export interface PublishChange {path:string;blobSha:string;encoding:'utf8'|'base64';}
export interface PublishTicket {projectId:string;requestId:string;baseSha:string|null;commitSha:string|null;status:'prepared'|'pushing'|'confirmed'|'aborted';changes:PublishChange[];expiresAt:string;}
