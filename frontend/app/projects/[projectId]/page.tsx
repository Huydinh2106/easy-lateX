"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { editor } from "monaco-editor";
import {
  Bot, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Cloud, CloudOff, Download, File, FileCode2,
  FilePlus2, FileText, Folder, FolderOpen, FolderPlus, LoaderCircle, MessageSquare, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, PanelRight, Play, RefreshCw, Save, Send, Star, Trash2, Upload
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  ApiError, createBuild, createFile, deleteFile, downloadFile, getBuild, getBuildLog, getBuildPdf,
  getFileContent, getFiles, getLatestBuild, getOutline, getProject, moveFile, saveFile, setRootFile,
  uploadFile, type Build, type CompileError, type FileContent, type FileEntry, type OutlineItem, type Project
} from "@/lib/api";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";
type RightPanel = "ai" | "pdf";
type ChatMessage = { role: "user" | "assistant"; text: string };
const terminalStatuses = new Set<Build["status"]>(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);

function language(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["tex", "sty", "cls"].includes(extension ?? "")) return "latex";
  if (extension === "bib") return "bibtex";
  if (extension === "md") return "markdown";
  return "plaintext";
}

function depth(path: string): number { return path.split("/").length - 1; }

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const auth = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [actionTarget, setActionTarget] = useState<FileEntry | null>(null);
  const [document, setDocument] = useState<FileContent | null>(null);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [rightPanel, setRightPanel] = useState<RightPanel>("ai");
  const [build, setBuild] = useState<Build | null>(null);
  const [compileLog, setCompileLog] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([{ role: "assistant", text: "AI provider is not configured in development. Your future agent will apply versioned operations through the same Document Layer." }]);
  const [prompt, setPrompt] = useState("");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const retryRef = useRef(0);
  const pendingLineRef = useRef<number | null>(null);
  const loadSequence = useRef(0);

  const refreshFiles = useCallback(async () => setFiles(await getFiles(projectId)), [projectId]);

  const refreshOutline = useCallback(async (path: string) => {
    if (!/\.(tex|sty|cls|md)$/i.test(path)) { setOutline([]); return; }
    try { setOutline(await getOutline(projectId, path)); } catch { setOutline([]); }
  }, [projectId]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const path = activePathRef.current;
    if (!dirtyRef.current || !path) return true;
    const snapshot = contentRef.current;
    const expectedVersion = versionRef.current;
    setSaveState("saving");
    try {
      const result = await saveFile(projectId, path, snapshot, expectedVersion);
      versionRef.current = result.version;
      setDocument((current) => current && current.path === path ? { ...current, version: result.version } : current);
      if (contentRef.current === snapshot) {
        dirtyRef.current = false;
        retryRef.current = 0;
        setSaveState("saved");
        await refreshOutline(path);
      } else {
        setSaveState("dirty");
        saveTimer.current = setTimeout(() => void saveNow(), 800);
      }
      await refreshFiles();
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) setSaveState("conflict");
      else {
        setSaveState("failed");
        if (retryRef.current < 2) {
          retryRef.current += 1;
          saveTimer.current = setTimeout(() => void saveNow(), 1200 * retryRef.current);
        }
      }
      setError(caught instanceof Error ? caught.message : "Save failed");
      return false;
    }
  }, [projectId, refreshFiles, refreshOutline]);

  const openEntry = useCallback(async (entry: FileEntry, line?: number) => {
    if (entry.kind === "DIRECTORY") {
      setActionTarget(entry);
      setExpanded((current) => { const next = new Set(current); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; });
      return;
    }
    if (activePathRef.current !== entry.path && dirtyRef.current && !await saveNow()) return;
    const sequence = ++loadSequence.current;
    setError(null);
    const loaded = await getFileContent(projectId, entry.path);
    if (sequence !== loadSequence.current) return;
    setSelected(entry);
    setActionTarget(entry);
    setDocument(loaded);
    const value = loaded.content ?? "";
    setContent(value);
    contentRef.current = value;
    versionRef.current = loaded.version;
    activePathRef.current = entry.path;
    dirtyRef.current = false;
    setSaveState("saved");
    await refreshOutline(entry.path);
    if (line) pendingLineRef.current = line;
    window.setTimeout(() => {
      const target = pendingLineRef.current;
      if (!target || !editorRef.current) return;
      editorRef.current.revealLineInCenter(target);
      editorRef.current.setPosition({ lineNumber: target, column: 1 });
      editorRef.current.focus();
      pendingLineRef.current = null;
    }, 100);
  }, [projectId, refreshOutline, saveNow]);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) { router.replace("/login"); return; }
    let cancelled = false;
    void Promise.all([getProject(projectId), getFiles(projectId), getLatestBuild(projectId).catch(() => null)])
      .then(async ([loadedProject, loadedFiles, latest]) => {
        if (cancelled) return;
        setProject(loadedProject); setFiles(loadedFiles); setBuild(latest);
        const initial = loadedFiles.find((file) => file.path === loadedProject.rootFile) ?? loadedFiles.find((file) => file.kind === "FILE");
        if (initial) await openEntry(initial);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Workspace could not load"))
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [auth.loading, auth.user, openEntry, projectId, router]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  useEffect(() => {
    if (!build || terminalStatuses.has(build.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 900;
    const poll = async () => {
      if (cancelled) return;
      if (globalThis.document.visibilityState === "hidden") { timer = setTimeout(poll, 2500); return; }
      try {
        const next = await getBuild(projectId, build.id);
        if (cancelled) return;
        setBuild(next);
        if (!terminalStatuses.has(next.status)) { delay = 900; timer = setTimeout(poll, delay); }
      } catch { delay = Math.min(delay * 2, 8000); timer = setTimeout(poll, delay); }
    };
    timer = setTimeout(poll, delay);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [build?.id, build?.status, projectId]);

  useEffect(() => {
    if (!build || !terminalStatuses.has(build.status)) return;
    let cancelled = false;
    if (build.status === "SUCCEEDED") {
      void getBuildPdf(projectId, build.id).then((blob) => {
        if (cancelled) return;
        setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        setCompileLog("");
      }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load PDF"));
    } else if (build.status === "FAILED" || build.status === "TIMED_OUT") {
      void getBuildLog(projectId, build.id).then((value) => { if (!cancelled) setCompileLog(value); }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [build?.id, build?.status, projectId]);

  function editorChanged(value: string | undefined) {
    const next = value ?? "";
    setContent(next); contentRef.current = next; dirtyRef.current = true; retryRef.current = 0; setSaveState("dirty"); setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), 800);
  }

  async function compile() {
    setRightPanel("pdf");
    setCompileLog("");
    setError(null);
    if (!await saveNow() || dirtyRef.current) { setError("Compile stopped because the current file has not been saved"); return; }
    try { setBuild(await createBuild(projectId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start build"); }
  }

  async function add(kind: "FILE" | "DIRECTORY") {
    const path = window.prompt(kind === "FILE" ? "New file path" : "New folder path");
    if (!path) return;
    try { const created = await createFile(projectId, path, kind); await refreshFiles(); if (kind === "FILE") await openEntry(created); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create entry"); }
  }

  async function renameOrMove() {
    if (!actionTarget) return;
    const target = actionTarget;
    const next = window.prompt("New path", target.path);
    if (!next || next === target.path) return;
    try {
      if (dirtyRef.current && !await saveNow()) return;
      await moveFile(projectId, target.path, next);
      const remap = (path: string) => path === target.path ? next : path.startsWith(`${target.path}/`) ? `${next}${path.slice(target.path.length)}` : path;
      if (selected && (selected.path === target.path || selected.path.startsWith(`${target.path}/`))) {
        const movedPath = remap(selected.path);
        const moved = { ...selected, path: movedPath, name: movedPath.split("/").pop() ?? movedPath, parentPath: movedPath.includes("/") ? movedPath.slice(0, movedPath.lastIndexOf("/")) : "" };
        activePathRef.current = movedPath;
        setSelected(moved);
        setDocument((current) => current ? { ...current, path: movedPath } : current);
      }
      setActionTarget({ ...target, path: next, name: next.split("/").pop() ?? next, parentPath: next.includes("/") ? next.slice(0, next.lastIndexOf("/")) : "" });
      setProject((current) => current && (current.rootFile === target.path || current.rootFile.startsWith(`${target.path}/`)) ? { ...current, rootFile: remap(current.rootFile) } : current);
      await refreshFiles();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not move entry"); }
  }

  async function removeSelected() {
    if (!actionTarget || !window.confirm(`Delete ${actionTarget.path}?`)) return;
    const target = actionTarget;
    try {
      await deleteFile(projectId, target.path);
      if (selected && (selected.path === target.path || selected.path.startsWith(`${target.path}/`))) {
        activePathRef.current = null; setSelected(null); setDocument(null); setContent(""); setOutline([]);
      }
      setActionTarget(null);
      await refreshFiles();
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete entry"); }
  }

  async function makeRoot() {
    if (!actionTarget) return;
    try { await setRootFile(projectId, actionTarget.path); setProject((current) => current ? { ...current, rootFile: actionTarget.path } : current); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not set root file"); }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const target = window.prompt("Upload path", file.name); if (!target) return;
    try { await uploadFile(projectId, target, file); await refreshFiles(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed"); }
    finally { event.target.value = ""; }
  }

  async function downloadSelected() {
    if (!actionTarget || actionTarget.kind !== "FILE") return;
    const blob = await downloadFile(projectId, actionTarget.path);
    const url = URL.createObjectURL(blob); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = actionTarget.name; anchor.click(); URL.revokeObjectURL(url);
  }

  async function jumpTo(target: CompileError | OutlineItem) {
    if (!target.file || !target.line) return;
    const targetFile = target.file;
    const entry = files.find((file) => file.path === targetFile || targetFile.endsWith(`/${file.path}`));
    if (entry) await openEntry(entry, target.line);
  }

  function sendChat(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim()) return;
    setChat((current) => [...current, { role: "user", text: prompt.trim() }, { role: "assistant", text: "No AI provider is configured. This message is kept locally; document writes will use structured, versioned operations when an agent is connected." }]); setPrompt("");
  }

  const visibleFiles = useMemo(() => files.filter((entry) => {
    const parents = entry.parentPath ? entry.parentPath.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/")) : [];
    return parents.every((parent) => expanded.has(parent));
  }), [expanded, files]);

  if (loading) return <main className="auth-loading"><LoaderCircle className="spinner" /> Opening canonical project…</main>;

  const buildRunning = build?.status === "QUEUED" || build?.status === "RUNNING";
  const saveLabel = saveState === "saved" ? `Saved · v${document?.version ?? 0}` : saveState === "dirty" ? "Unsaved" : saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Version conflict" : "Save failed";
  const buildLabel = buildRunning ? (build?.status === "QUEUED" ? "Build queued" : "Compiling…") : build?.status === "SUCCEEDED" ? "PDF ready" : build?.status === "FAILED" ? "Compile failed" : build?.status === "TIMED_OUT" ? "Timed out" : "PDF not ready";

  return (
    <div className={`project-workspace-shell canonical-code-workspace${navCollapsed ? " nav-collapsed" : ""}`}>
      <a className="skip-link" href="#canonical-editor">Skip to editor</a>
      {error ? (
        <div className="workspace-system-banner system-banner-offline" role="alert">
          <CircleAlert aria-hidden="true" /> <span>{error}</span>
          <button className="workspace-icon-button" type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      ) : null}

      <header className="project-topbar">
        <div className="project-location">
          <button className="workspace-icon-button mobile-project-menu" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open project navigation">
            <ChevronRight aria-hidden="true" />
          </button>
          <Link className="workspace-back" href="/projects" aria-label="Back to projects"><ChevronLeft aria-hidden="true" /></Link>
          <span className="project-wordmark" aria-hidden="true">TeX</span>
          <span className="project-name">{project?.name ?? "Project"}</span>
          <span className="project-id">#{projectId.slice(0, 4)}</span>
        </div>

        <div className="project-statuses" aria-label="Document status">
          <span className={`quiet-status canonical-save-${saveState}`} title={error ?? undefined}>
            {saveState === "saving" ? <LoaderCircle className="spinner" /> : saveState === "saved" ? <Cloud /> : saveState === "dirty" ? <Save /> : <CloudOff />}
            {saveLabel}
          </span>
          <button className={`quiet-status compile-status compile-status-${build?.status?.toLowerCase() ?? "ready"}`} type="button" onClick={() => setRightPanel("pdf")}>
            {buildRunning ? <LoaderCircle className="spinner" /> : build?.status === "SUCCEEDED" ? <Check /> : build?.status === "FAILED" || build?.status === "TIMED_OUT" ? <CircleAlert /> : <FileText />}
            {buildLabel}
          </button>
        </div>

        <div className="project-actions">
          <button className="workspace-button workspace-button-secondary pdf-topbar-button" type="button" onClick={() => setRightPanel("pdf")}>
            <PanelRight aria-hidden="true" /> PDF
          </button>
          <button className="workspace-button workspace-button-primary" type="button" aria-label="Compile document" onClick={() => void compile()} disabled={buildRunning}>
            {buildRunning ? <LoaderCircle className="spinner" /> : <Play aria-hidden="true" />} {buildRunning ? "Compiling…" : "Compile"}
          </button>
        </div>
      </header>

      {mobileNavOpen ? <button className="workspace-nav-backdrop" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close project navigation" /> : null}

      <div className="workspace-grid">
        <aside className={`project-sidebar${mobileNavOpen ? " project-sidebar-open" : ""}`} aria-label="Project files and outline">
          <div className="project-sidebar-heading">
            <span>Files</span>
            <div className="file-tree-actions">
              <button type="button" onClick={() => void add("FILE")} title="New file" aria-label="New file"><FilePlus2 /></button>
              <button type="button" onClick={() => void add("DIRECTORY")} title="New folder" aria-label="New folder"><FolderPlus /></button>
              <label className="canonical-upload-button" title="Upload file" aria-label="Upload file"><Upload /><input type="file" onChange={(event) => void handleUpload(event)} /></label>
              <button type="button" onClick={() => setNavCollapsed((value) => !value)} aria-label={navCollapsed ? "Expand file explorer" : "Collapse file explorer"}>
                {navCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </button>
            </div>
          </div>

          <nav className="project-file-tree" role="tree" aria-label="Project files">
            {visibleFiles.length ? visibleFiles.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="treeitem"
                aria-selected={actionTarget?.id === entry.id}
                aria-expanded={entry.kind === "DIRECTORY" ? expanded.has(entry.path) : undefined}
                className={`file-tree-row${entry.kind === "DIRECTORY" ? " file-tree-folder" : ""}${actionTarget?.id === entry.id ? " file-tree-row-active" : ""}`}
                style={{ paddingLeft: 8 + depth(entry.path) * 16 }}
                onClick={() => { void openEntry(entry); setMobileNavOpen(false); }}
              >
                {entry.kind === "DIRECTORY" ? <ChevronDown className={expanded.has(entry.path) ? "" : "file-tree-chevron-collapsed"} /> : <span className="canonical-tree-spacer" />}
                {entry.kind === "DIRECTORY" ? (expanded.has(entry.path) ? <FolderOpen /> : <Folder />) : <File />}
                <span>{entry.name}</span>
                {project?.rootFile === entry.path ? <Star className="canonical-root-star" aria-label="Root document" /> : null}
              </button>
            )) : <div className="canonical-tree-empty">No files in this project.</div>}
          </nav>

          <div className="canonical-file-actions" aria-label="Selected file actions">
            <span title={actionTarget?.path}>{actionTarget?.name ?? "Select a file or folder"}</span>
            <button type="button" onClick={() => void renameOrMove()} disabled={!actionTarget} title="Rename or move"><MoreHorizontal /></button>
            <button type="button" onClick={() => void downloadSelected()} disabled={!actionTarget || actionTarget.kind !== "FILE"} title="Download"><Download /></button>
            <button type="button" onClick={() => void makeRoot()} disabled={!actionTarget?.path.endsWith(".tex") || project?.rootFile === actionTarget?.path} title="Set as root document"><Star /></button>
            <button className="canonical-danger" type="button" onClick={() => void removeSelected()} disabled={!actionTarget} title="Delete"><Trash2 /></button>
          </div>

          <section className="document-outline" aria-label="File outline">
            <div className="sidebar-section-title"><ChevronDown /><span>Outline</span></div>
            {outline.length ? outline.map((item) => (
              <button
                className="outline-item"
                key={`${item.offset}-${item.type}`}
                type="button"
                onClick={() => void jumpTo(item)}
                style={{ paddingLeft: 8 + Math.max(0, ["part", "chapter", "section", "subsection", "subsubsection"].indexOf(item.type)) * 8 }}
              >
                {item.title} <small>· {item.line}</small>
              </button>
            )) : <p className="canonical-outline-empty">No headings in this file.</p>}
          </section>
        </aside>

        <main className="workspace-main" id="canonical-editor">
          <section className="canonical-editor-shell" aria-label="Canonical source editor">
            <header className="canonical-editor-header">
              <span><FileCode2 /> {selected?.path ?? "No file selected"}</span>
              {selected ? <small>v{document?.version ?? selected.currentVersion} · canonical source</small> : null}
            </header>
            <div className="canonical-editor-surface">
              {!document ? <div className="canonical-editor-empty"><FileText /><p>Select or create a text file.</p></div> : document.binary ? (
                <div className="canonical-editor-empty"><File /><p>{document.path} is a binary project asset.</p><button className="workspace-button workspace-button-secondary" type="button" onClick={() => void downloadSelected()}><Download /> Download</button></div>
              ) : (
                <MonacoEditor
                  height="100%" path={document.path} language={language(document.path)} value={content}
                  theme="vs" onChange={editorChanged} onMount={(instance) => { editorRef.current = instance; }}
                  options={{ minimap: { enabled: false }, fontSize: 14, lineNumbersMinChars: 3, wordWrap: "on", automaticLayout: true, padding: { top: 16 }, tabSize: 2, scrollBeyondLastLine: false }}
                />
              )}
            </div>
          </section>
        </main>

        <aside className="context-panel context-panel-agent" aria-label={rightPanel === "ai" ? "AI assistant" : "PDF preview"}>
          <header className="context-panel-header workspace-panel-header">
            <div className="workspace-panel-switch" role="tablist" aria-label="Right panel view">
              <button className={`workspace-panel-tab${rightPanel === "ai" ? " workspace-panel-tab-active" : ""}`} type="button" aria-pressed={rightPanel === "ai"} onClick={() => setRightPanel("ai")}>
                <MessageSquare /> AI Chat
              </button>
              <button className={`workspace-panel-tab${rightPanel === "pdf" ? " workspace-panel-tab-active" : ""}`} type="button" aria-pressed={rightPanel === "pdf"} onClick={() => setRightPanel("pdf")}>
                <FileText /> PDF Preview
              </button>
            </div>
          </header>

          {rightPanel === "ai" ? (
            <>
              <div className="agent-conversation">
                <div className="ai-chat-thread" aria-live="polite">
                  {chat.map((message, index) => (
                    <div className={`ai-chat-message ai-chat-message-${message.role === "assistant" ? "assistant" : "user"}`} key={index}>
                      {message.role === "assistant" ? <span className="ai-chat-avatar"><Bot /></span> : null}
                      <div><span className="ai-chat-author">{message.role === "assistant" ? "Easy LaTeX AI" : "You"}</span><p>{message.text}</p></div>
                    </div>
                  ))}
                </div>
              </div>
              <form className="intent-bar agent-intent-bar" onSubmit={sendChat}>
                <div className="intent-input-row">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask the future document agent…" rows={2} />
                  <button className="intent-submit" type="submit" disabled={!prompt.trim()} aria-label="Send"><Send /></button>
                </div>
                <div className="intent-meta"><span className="canonical-agent-note">Future agent writes through versioned Document Operations.</span></div>
              </form>
            </>
          ) : (
            <div className="canonical-pdf-panel">
              {buildRunning ? <div className="canonical-build-state"><LoaderCircle className="spinner" /><strong>{build?.status === "QUEUED" ? "Build queued" : "Compiling immutable revision"}</strong><span>Revision {build?.revisionId.slice(0, 8)}</span></div> : null}
              {build?.status === "SUCCEEDED" && pdfUrl ? <object key={build.id} data={pdfUrl} type="application/pdf" aria-label="Compiled PDF"><a href={pdfUrl}>Open compiled PDF</a></object> : null}
              {(build?.status === "FAILED" || build?.status === "TIMED_OUT") ? <div className="canonical-build-failed"><CircleAlert /><h3>{build.errorSummary?.message ?? "Compilation failed"}</h3>
                {(build.errorSummary?.errors ?? []).map((item, index) => <button key={index} type="button" onClick={() => void jumpTo(item)}>{item.file ? `${item.file}${item.line ? `:${item.line}` : ""}` : "LaTeX"}: {item.message}</button>)}
                <pre>{compileLog || "Loading compile log…"}</pre></div> : null}
              {!build ? <div className="canonical-build-state"><FileText /><strong>No PDF build yet</strong><span>Compile the saved root document to create one.</span></div> : null}
              {build?.status === "SUCCEEDED" && !pdfUrl ? <div className="canonical-build-state"><RefreshCw className="spinner" /> Loading PDF…</div> : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
