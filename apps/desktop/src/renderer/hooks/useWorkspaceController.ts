import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  CompileEvent,
  CompileResult,
  Diagnostic,
  FileContent,
  FileEntry,
  GitStatus,
  LatexEngine,
  OpenProjectResult,
  RecentProject
} from "@easy-latex/shared-types";
import type { SaveState } from "../features/compile/CompileToolbar";
import { preserveLastSuccessfulPdf } from "../features/compile/preserveCompileResult";

const idleCompileEvent: CompileEvent = { phase: "idle", message: "Ready to compile" };
const defaultSettings: AppSettings = {
  compilerEngine: "pdflatex",
  projectsDirectory: "",
  explorerWidth: 232,
  pdfWidth: 520,
  problemsHeight: 220,
  recentProjects: []
};

const EDITABLE_FILE_PATTERN = /\.(?:tex|bib|sty|cls|bst|ltx|md|txt)$/i;

function readableError(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback;
  return caught.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function isSameOrDescendant(value: string, ancestor: string): boolean {
  return value === ancestor || value.startsWith(`${ancestor}/`);
}

function remapDescendantPath(value: string, source: string, target: string): string {
  if (value === source) return target;
  return value.startsWith(`${source}/`) ? `${target}${value.slice(source.length)}` : value;
}

export interface JumpTarget {
  path: string;
  line: number;
  column?: number;
  nonce: number;
}

export function useWorkspaceController() {
  const [projectResult, setProjectResult] = useState<OpenProjectResult | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<FileContent | null>(null);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [compileEvent, setCompileEvent] = useState<CompileEvent>(idleCompileEvent);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [git, setGit] = useState<GitStatus>({ available: true, isRepository: false });
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfStale, setPdfStale] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);

  const activeFileRef = useRef<FileContent | null>(null);
  const contentRef = useRef("");
  const dirtyRef = useRef(false);
  const loadingSequence = useRef(0);
  activeFileRef.current = activeFile;
  contentRef.current = content;

  const refreshFiles = useCallback(async (): Promise<FileEntry[]> => {
    const next = await window.desktop.file.list();
    setFiles(next);
    return next;
  }, []);

  const refreshRecentProjects = useCallback(async (): Promise<RecentProject[]> => {
    const recent = await window.desktop.project.recent();
    setRecentProjects(recent);
    return recent;
  }, []);

  const loadFile = useCallback(async (filePath: string): Promise<FileContent> => {
    const sequence = ++loadingSequence.current;
    const loaded = await window.desktop.file.read(filePath);
    if (sequence !== loadingSequence.current) return loaded;
    setActiveFile(loaded);
    activeFileRef.current = loaded;
    setContent(loaded.content);
    contentRef.current = loaded.content;
    dirtyRef.current = false;
    setSaveState("saved");
    setError(null);
    return loaded;
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const file = activeFileRef.current;
    if (!file || !dirtyRef.current) return true;
    setSaveState("saving");
    try {
      const result = await window.desktop.file.write({ path: file.path, content: contentRef.current, expectedModifiedAt: file.modifiedAt });
      const next = { ...file, modifiedAt: result.modifiedAt, size: result.size, content: contentRef.current };
      setActiveFile(next);
      activeFileRef.current = next;
      dirtyRef.current = false;
      setSaveState("saved");
      await refreshFiles();
      return true;
    } catch (caught) {
      const message = readableError(caught, "Could not save the file");
      setError(message);
      setSaveState(/changed on disk/i.test(message) ? "conflict" : "failed");
      return false;
    }
  }, [refreshFiles]);

  const openFile = useCallback(async (filePath: string): Promise<boolean> => {
    if (filePath === activeFileRef.current?.path) return true;
    if (dirtyRef.current && !await save()) return false;
    try {
      await loadFile(filePath);
      return true;
    } catch (caught) {
      setError(readableError(caught, "Could not open the file"));
      return false;
    }
  }, [loadFile, save]);

  const hydrateProject = useCallback(async (result: OpenProjectResult): Promise<void> => {
    setProjectResult(result);
    const tree = await refreshFiles();
    const first = tree.find((entry) => entry.kind === "file" && entry.path === result.project.rootDocument)
      ?? tree.find((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".tex"))
      ?? tree.find((entry) => entry.kind === "file");
    if (first) await loadFile(first.path);
    else {
      setActiveFile(null);
      setContent("");
    }
    setCompileResult(null);
    setCompileEvent(idleCompileEvent);
    setPdfStale(false);
    setError(null);
    const [gitStatus, loadedSettings] = await Promise.all([
      window.desktop.git.status(),
      window.desktop.settings.all(),
      refreshRecentProjects()
    ]);
    setGit(gitStatus);
    setSettings(loadedSettings);
  }, [loadFile, refreshFiles, refreshRecentProjects]);

  const openProject = useCallback(async (): Promise<void> => {
    if (dirtyRef.current && !await save()) return;
    try {
      const result = await window.desktop.project.open();
      if (result) await hydrateProject(result);
    } catch (caught) {
      setError(readableError(caught, "Could not open the project folder"));
    }
  }, [hydrateProject, save]);

  const createProject = useCallback(async (name: string): Promise<boolean> => {
    if (dirtyRef.current && !await save()) return false;
    setError(null);
    try {
      const result = await window.desktop.project.create(name);
      await hydrateProject(result);
      return true;
    } catch (caught) {
      setError(readableError(caught, "Could not create the project"));
      return false;
    }
  }, [hydrateProject, save]);

  const chooseProjectsDirectory = useCallback(async (): Promise<string | null> => {
    try {
      const selected = await window.desktop.project.chooseProjectsDirectory();
      if (selected) setSettings((current) => ({ ...current, projectsDirectory: selected }));
      setError(null);
      return selected;
    } catch (caught) {
      setError(readableError(caught, "Could not change the default projects folder"));
      return null;
    }
  }, []);

  const openRecentProject = useCallback(async (workspacePath: string): Promise<boolean> => {
    if (dirtyRef.current && !await save()) return false;
    setError(null);
    try {
      const result = await window.desktop.project.openRecent(workspacePath);
      await hydrateProject(result);
      return true;
    } catch (caught) {
      setError(readableError(caught, "Could not open the recent project"));
      await refreshRecentProjects().catch(() => undefined);
      return false;
    }
  }, [hydrateProject, refreshRecentProjects, save]);

  const showProjects = useCallback(async (): Promise<void> => {
    if (dirtyRef.current && !await save()) return;
    const compiling = ["starting", "running", "cancelling"].includes(compileEvent.phase);
    if (compiling) await window.desktop.compiler.cancel().catch(() => false);
    loadingSequence.current += 1;
    activeFileRef.current = null;
    contentRef.current = "";
    dirtyRef.current = false;
    setProjectResult(null);
    setFiles([]);
    setActiveFile(null);
    setContent("");
    setCompileResult(null);
    setCompileEvent(idleCompileEvent);
    setPdfOpen(false);
    setPdfStale(false);
    setProblemsOpen(false);
    setError(null);
    await refreshRecentProjects().catch((caught: unknown) => setError(readableError(caught, "Could not refresh recent projects")));
  }, [compileEvent.phase, refreshRecentProjects, save]);

  const forgetRecentProject = useCallback(async (workspacePath: string): Promise<void> => {
    try {
      setRecentProjects(await window.desktop.project.forgetRecent(workspacePath));
      setError(null);
    } catch (caught) {
      setError(readableError(caught, "Could not remove the project from recents"));
    }
  }, []);

  useEffect(() => {
    void Promise.all([window.desktop.settings.all(), window.desktop.project.current(), window.desktop.project.recent()]).then(async ([loadedSettings, current, recent]) => {
      setSettings(loadedSettings);
      setRecentProjects(recent);
      if (current) await hydrateProject(current);
    }).catch((caught: unknown) => setError(readableError(caught, "Application startup failed")));
  }, [hydrateProject]);

  useEffect(() => window.desktop.compiler.onEvent(setCompileEvent), []);

  useEffect(() => window.desktop.file.onChanged((event) => {
    if (!projectResult) return;
    void refreshFiles().catch(() => undefined);
    const current = activeFileRef.current;
    if (!current || (event.path && event.path !== current.path)) return;
    if (dirtyRef.current) {
      setSaveState("conflict");
      setError("The active file changed on disk. Your unsaved editor content was preserved.");
      return;
    }
    void loadFile(current.path).catch(() => undefined);
  }), [loadFile, projectResult, refreshFiles]);

  const changeContent = useCallback((value: string): void => {
    setContent(value);
    contentRef.current = value;
    dirtyRef.current = true;
    setSaveState("modified");
    setPdfStale(Boolean(compileResult?.pdfUrl));
    setError(null);
  }, [compileResult?.pdfUrl]);

  const compile = useCallback(async (): Promise<void> => {
    if (!projectResult?.project.rootDocument) {
      setError("Choose a root .tex document before compiling");
      return;
    }
    if (!await save()) return;
    setPdfOpen(true);
    setError(null);
    try {
      const result = await window.desktop.compiler.build({
        engine: settings.compilerEngine,
        rootDocument: projectResult.project.rootDocument
      });
      setCompileResult((previous) => preserveLastSuccessfulPdf(previous, result));
      setPdfStale(!result.success);
      setProblemsOpen(result.errors.length > 0 || result.warnings.length > 0);
    } catch (caught) {
      const message = readableError(caught, "Compilation could not start");
      setError(message);
      setCompileEvent({ phase: "failed", message });
    }
  }, [projectResult, save, settings.compilerEngine]);

  const cancelCompile = useCallback(async (): Promise<void> => {
    try { await window.desktop.compiler.cancel(); }
    catch (caught) { setError(readableError(caught, "Could not cancel compilation")); }
  }, []);

  const setRoot = useCallback(async (rootDocument: string): Promise<void> => {
    try {
      const project = await window.desktop.project.setRoot(rootDocument);
      setProjectResult((current) => current ? { ...current, project } : current);
    } catch (caught) {
      setError(readableError(caught, "Could not set the root document"));
    }
  }, []);

  const createFile = useCallback(async (filePath: string): Promise<string | null> => {
    setError(null);
    try {
      const created = await window.desktop.file.create(filePath);
      await refreshFiles();
      if (EDITABLE_FILE_PATTERN.test(created.path)) await loadFile(created.path);
      return created.path;
    } catch (caught) {
      setError(readableError(caught, "Could not create the file"));
      return null;
    }
  }, [loadFile, refreshFiles]);

  const createDirectory = useCallback(async (directoryPath: string): Promise<string | null> => {
    setError(null);
    try {
      const result = await window.desktop.file.createDirectory(directoryPath);
      await refreshFiles();
      return result.paths[0] ?? null;
    } catch (caught) {
      setError(readableError(caught, "Could not create the folder"));
      return null;
    }
  }, [refreshFiles]);

  const movePath = useCallback(async (sourcePath: string, targetPath: string): Promise<string | null> => {
    const currentFile = activeFileRef.current;
    const movesActiveFile = Boolean(currentFile && isSameOrDescendant(currentFile.path, sourcePath));
    if (movesActiveFile && dirtyRef.current && !await save()) return null;
    setError(null);
    try {
      const result = await window.desktop.file.move({ sourcePath, targetPath });
      const movedPath = result.paths[0] ?? targetPath;
      const [currentProject] = await Promise.all([window.desktop.project.current(), refreshFiles()]);
      if (currentProject) setProjectResult(currentProject);
      if (currentFile && movesActiveFile) {
        const nextActivePath = remapDescendantPath(currentFile.path, sourcePath, movedPath);
        if (EDITABLE_FILE_PATTERN.test(nextActivePath)) await loadFile(nextActivePath);
        else {
          loadingSequence.current += 1;
          activeFileRef.current = null;
          contentRef.current = "";
          dirtyRef.current = false;
          setActiveFile(null);
          setContent("");
          setSaveState("saved");
        }
      }
      return movedPath;
    } catch (caught) {
      setError(readableError(caught, "Could not move or rename the item"));
      return null;
    }
  }, [loadFile, refreshFiles, save]);

  const removePath = useCallback(async (relativePath: string): Promise<boolean> => {
    const currentFile = activeFileRef.current;
    const removesActiveFile = Boolean(currentFile && isSameOrDescendant(currentFile.path, relativePath));
    setError(null);
    try {
      await window.desktop.file.remove(relativePath);
      if (removesActiveFile) {
        loadingSequence.current += 1;
        activeFileRef.current = null;
        contentRef.current = "";
        dirtyRef.current = false;
        setActiveFile(null);
        setContent("");
        setSaveState("saved");
      }
      const [currentProject] = await Promise.all([window.desktop.project.current(), refreshFiles()]);
      if (currentProject) setProjectResult(currentProject);
      return true;
    } catch (caught) {
      setError(readableError(caught, "Could not delete the item"));
      return false;
    }
  }, [refreshFiles]);

  const importFiles = useCallback(async (destinationDirectory: string): Promise<string[]> => {
    setError(null);
    try {
      const result = await window.desktop.file.importFiles(destinationDirectory);
      if (result.paths.length > 0) await refreshFiles();
      return result.paths;
    } catch (caught) {
      setError(readableError(caught, "Could not add the selected files"));
      return [];
    }
  }, [refreshFiles]);

  const importFolder = useCallback(async (destinationDirectory: string): Promise<string[]> => {
    setError(null);
    try {
      const result = await window.desktop.file.importFolder(destinationDirectory);
      if (result.paths.length > 0) await refreshFiles();
      return result.paths;
    } catch (caught) {
      setError(readableError(caught, "Could not add the selected folder"));
      return [];
    }
  }, [refreshFiles]);

  const importDropped = useCallback(async (droppedFiles: File[], destinationDirectory: string): Promise<string[]> => {
    setError(null);
    try {
      const sourcePaths = [...new Set(droppedFiles.map((file) => window.desktop.file.pathForDroppedFile(file)).filter(Boolean))];
      if (sourcePaths.length === 0) return [];
      const result = await window.desktop.file.importDropped(sourcePaths, destinationDirectory);
      if (result.paths.length > 0) await refreshFiles();
      return result.paths;
    } catch (caught) {
      setError(readableError(caught, "Could not add the dropped files or folders"));
      return [];
    }
  }, [refreshFiles]);

  const setEngine = useCallback(async (engine: LatexEngine): Promise<void> => {
    try { setSettings(await window.desktop.settings.set("compilerEngine", engine)); }
    catch (caught) { setError(readableError(caught, "Could not save compiler settings")); }
  }, []);

  const selectDiagnostic = useCallback(async (diagnostic: Diagnostic): Promise<void> => {
    if (!diagnostic.file || !diagnostic.line) return;
    const match = files.find((entry) => entry.kind === "file" && (entry.path === diagnostic.file || diagnostic.file?.endsWith(`/${entry.path}`)));
    if (!match || !await openFile(match.path)) return;
    setJumpTarget({ path: match.path, line: diagnostic.line, ...(diagnostic.column ? { column: diagnostic.column } : {}), nonce: Date.now() });
  }, [files, openFile]);

  const diagnostics = useMemo(() => compileResult ? [...compileResult.errors, ...compileResult.warnings] : [], [compileResult]);
  const texFiles = useMemo(() => files.filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".tex")), [files]);

  return {
    projectResult,
    recentProjects,
    files,
    texFiles,
    activeFile,
    content,
    saveState,
    compileEvent,
    compileResult,
    diagnostics,
    settings,
    git,
    pdfOpen,
    pdfStale,
    problemsOpen,
    error,
    jumpTarget,
    openProject,
    createProject,
    chooseProjectsDirectory,
    openRecentProject,
    forgetRecentProject,
    showProjects,
    openFile,
    createFile,
    createDirectory,
    movePath,
    removePath,
    importFiles,
    importFolder,
    importDropped,
    save,
    changeContent,
    compile,
    cancelCompile,
    setRoot,
    setEngine,
    selectDiagnostic,
    setPdfOpen,
    setProblemsOpen,
    clearError: () => setError(null)
  };
}
