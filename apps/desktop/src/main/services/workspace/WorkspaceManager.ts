import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { findRootCandidates } from "@easy-latex/latex";
import type { OpenProjectResult, Project, RecentProject } from "@easy-latex/shared-types";
import type { FileManager } from "../filesystem/FileManager";
import type { FileWatcher } from "../filesystem/FileWatcher";
import type { SettingsManager } from "../settings/SettingsManager";

interface ProjectMetadata {
  rootDocument?: string;
}

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateProjectName(value: string): string {
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 80) throw new Error("Project name must contain between 1 and 80 characters");
  const hasControlCharacter = [...name].some((character) => character.charCodeAt(0) < 32);
  if (name === "." || name === ".." || /[<>:"/\\|?*]/.test(name) || hasControlCharacter || /[. ]$/.test(name) || WINDOWS_RESERVED_NAMES.test(name)) {
    throw new Error("Project name contains characters that cannot be used in a folder name");
  }
  return name;
}

const INITIAL_DOCUMENT = `\\documentclass{article}

\\title{Untitled Document}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

Start writing here.

\\end{document}
`;

const INITIAL_GITIGNORE = `.easy-latex/build/
*.aux
*.fdb_latexmk
*.fls
*.log
*.out
*.synctex.gz
`;

export class WorkspaceManager {
  private currentProject: OpenProjectResult | null = null;

  constructor(
    private readonly files: FileManager,
    private readonly watcher: FileWatcher,
    private readonly settings: SettingsManager
  ) {}

  async open(parent: BrowserWindow | null): Promise<OpenProjectResult | null> {
    const options = {
      title: "Open LaTeX Project",
      buttonLabel: "Open Project",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    return this.openPath(selected);
  }

  async create(name: string): Promise<OpenProjectResult> {
    const projectName = validateProjectName(name);
    const configuredDirectory = await this.settings.get("projectsDirectory");
    await mkdir(configuredDirectory, { recursive: true });
    const projectsDirectory = await realpath(configuredDirectory);
    const workspacePath = path.join(projectsDirectory, projectName);

    try {
      await mkdir(workspacePath, { mode: 0o755 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`A project named "${projectName}" already exists in the selected location`);
      }
      throw error;
    }

    try {
      await writeFile(path.join(workspacePath, "main.tex"), INITIAL_DOCUMENT, { encoding: "utf8", flag: "wx", mode: 0o644 });
      await writeFile(path.join(workspacePath, ".gitignore"), INITIAL_GITIGNORE, { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    await this.openPath(workspacePath);
    await this.setRoot("main.tex");
    const result = this.current();
    if (!result) throw new Error("The new project could not be opened");
    return result;
  }

  async chooseProjectsDirectory(parent: BrowserWindow | null): Promise<string | null> {
    const current = await this.settings.get("projectsDirectory");
    const options = {
      title: "Choose Default Projects Folder",
      buttonLabel: "Use This Folder",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const canonical = await realpath(selected);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("The selected projects location is not a folder");
    await this.settings.set("projectsDirectory", canonical);
    return canonical;
  }

  async openPath(workspacePath: string): Promise<OpenProjectResult> {
    await this.files.setWorkspace(workspacePath);
    const canonical = this.files.getWorkspaceRoot();
    const rootCandidates = await this.discoverRootCandidates();
    const metadata = await this.readMetadata();
    const configuredRoot = metadata.rootDocument && rootCandidates.includes(metadata.rootDocument) ? metadata.rootDocument : undefined;
    const rootDocument = configuredRoot ?? rootCandidates[0];
    const project: Project = {
      name: path.basename(canonical),
      workspacePath: canonical,
      ...(rootDocument ? { rootDocument } : {})
    };
    this.currentProject = { project, rootCandidates };
    this.watcher.start(canonical);
    await this.settings.addRecentProject(canonical);
    return structuredClone(this.currentProject);
  }

  async openRecent(workspacePath: string): Promise<OpenProjectResult> {
    const recentProjects = await this.settings.get("recentProjects");
    const requested = this.pathKey(path.resolve(workspacePath));
    const remembered = recentProjects.find((candidate) => this.pathKey(path.resolve(candidate)) === requested);
    if (!remembered) throw new Error("This folder is not in your recent projects");
    try {
      return await this.openPath(remembered);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new Error("The project folder is no longer available at its previous location");
      }
      throw error;
    }
  }

  async recent(): Promise<RecentProject[]> {
    const recentProjects = await this.settings.get("recentProjects");
    return Promise.all(recentProjects.map(async (workspacePath) => {
      const available = await stat(workspacePath).then((info) => info.isDirectory()).catch(() => false);
      return { name: path.basename(workspacePath), workspacePath, available };
    }));
  }

  async forgetRecent(workspacePath: string): Promise<RecentProject[]> {
    const recentProjects = await this.settings.get("recentProjects");
    const requested = this.pathKey(path.resolve(workspacePath));
    const remembered = recentProjects.find((candidate) => this.pathKey(path.resolve(candidate)) === requested);
    if (!remembered) throw new Error("This folder is not in your recent projects");
    await this.settings.removeRecentProject(remembered);
    return this.recent();
  }

  current(): OpenProjectResult | null {
    return this.currentProject ? structuredClone(this.currentProject) : null;
  }

  async setRoot(rootDocument: string): Promise<Project> {
    if (!this.currentProject) throw new Error("Open a project folder first");
    const relative = this.files.normalizeRelativePath(rootDocument);
    if (!relative.toLowerCase().endsWith(".tex")) throw new Error("The root document must be a .tex file");
    await this.files.resolveExistingFile(relative);
    const project: Project = { ...this.currentProject.project, rootDocument: relative };
    this.currentProject = {
      project,
      rootCandidates: this.currentProject.rootCandidates.includes(relative)
        ? this.currentProject.rootCandidates
        : [relative, ...this.currentProject.rootCandidates]
    };
    await this.writeMetadata({ rootDocument: relative });
    return structuredClone(project);
  }

  requireRootDocument(override?: string): string {
    if (!this.currentProject) throw new Error("Open a project folder first");
    const candidate = override ?? this.currentProject.project.rootDocument;
    if (!candidate) throw new Error("Choose a root .tex document before compiling");
    return this.files.normalizeRelativePath(candidate);
  }

  private async discoverRootCandidates(): Promise<string[]> {
    const tree = await this.files.list();
    const texFiles = tree.filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".tex")).slice(0, 200);
    const sources = await Promise.all(texFiles.map(async (entry) => {
      try {
        const file = await this.files.read(entry.path);
        return { path: entry.path, content: file.content };
      } catch {
        return null;
      }
    }));
    return findRootCandidates(sources.filter((source): source is { path: string; content: string } => source !== null));
  }

  private async readMetadata(): Promise<ProjectMetadata> {
    const metadataPath = path.join(this.files.getWorkspaceRoot(), ".easy-latex", "project.json");
    try {
      const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as ProjectMetadata;
      return typeof parsed.rootDocument === "string" ? { rootDocument: parsed.rootDocument } : {};
    } catch {
      return {};
    }
  }

  private async writeMetadata(metadata: ProjectMetadata): Promise<void> {
    const directory = await this.files.ensureInternalDirectory(".easy-latex");
    const metadataPath = path.join(directory, "project.json");
    const temporary = `${metadataPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await rename(temporary, metadataPath);
  }

  private pathKey(value: string): string {
    return process.platform === "win32" ? value.toLowerCase() : value;
  }
}
