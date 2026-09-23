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
  OpenProjectResult
} from "@easy-latex/shared-types";
import type { SaveState } from "../features/compile/CompileToolbar";

const idleCompileEvent: CompileEvent = { phase: "idle", message: "Ready to compile" };
const defaultSettings: AppSettings = {
  compilerEngine: "pdflatex",
  latexmkPath: "latexmk",
  explorerWidth: 232,
  pdfWidth: 520,
  problemsHeight: 220,
  recentProjects: []
};

function readableError(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback;
  return caught.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

export interface JumpTarget {
  path: string;
  line: number;
  column?: number;
  nonce: number;
}

export function useWorkspaceController() {
  const [projectResult, setProjectResult] = useState<OpenProjectResult | null>(null);
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
    setGit(await window.desktop.git.status());
  }, [loadFile, refreshFiles]);

  const openProject = useCallback(async (): Promise<void> => {
    if (dirtyRef.current && !await save()) return;
    try {
      const result = await window.desktop.project.open();
      if (result) await hydrateProject(result);
    } catch (caught) {
      setError(readableError(caught, "Could not open the project folder"));
    }
  }, [hydrateProject, save]);

  useEffect(() => {
    void Promise.all([window.desktop.settings.all(), window.desktop.project.current()]).then(async ([loadedSettings, current]) => {
      setSettings(loadedSettings);
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
      setCompileResult((previous) => {
        if (result.success || result.pdfUrl) return result;
        const previousPdf = previous?.pdfUrl;
        return previousPdf ? { ...result, pdfUrl: previousPdf } : result;
      });
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
    openFile,
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
