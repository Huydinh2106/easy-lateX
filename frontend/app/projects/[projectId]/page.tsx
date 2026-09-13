"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Code2,
  Command,
  ExternalLink,
  FileClock,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Image,
  Library,
  LoaderCircle,
  Maximize2,
  Menu,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Play,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Undo2,
  Upload,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth-provider";
import { getProjects, openProject } from "@/lib/api";

type ContextType = "agent" | "pdf" | "references" | "figures" | "comments" | "history" | "collaborators" | "source";
type AgentStatus = "idle" | "reading" | "editing" | "compiling" | "review" | "applied" | "failed" | "cancelled";
type ReviewState = "proposed" | "applied" | "reverted" | "rejected";
type CompileStatus = "ready" | "compiling" | "success" | "warning" | "error";
type ConnectionStatus = "online" | "offline" | "reconnecting";

const commands = [
  { label: "Ask AI about the document", group: "AI", action: "ask", shortcut: "⌘ J" },
  { label: "Rewrite Related Work for academic depth", group: "AI", action: "rewrite" },
  { label: "Find and verify supporting citations", group: "AI", action: "citations" },
  { label: "Compile document with pdfLaTeX", group: "Document", action: "compile", shortcut: "⇧ ⌘ C" },
  { label: "Toggle PDF preview", group: "Document", action: "pdf", shortcut: "⇧ ⌘ P" },
  { label: "View revision history & diffs", group: "Navigate", action: "history" },
  { label: "Open Source / Advanced (code-server)", group: "Advanced", action: "source" },
];

const references = [
  {
    key: "lecun2015deep",
    title: "Deep learning",
    meta: "LeCun, Bengio & Hinton · Nature 521, 436–444 · 2015",
    doi: "10.1038/nature14539",
    used: "Used 3 times",
    verified: true,
  },
  {
    key: "wang2023scientific",
    title: "Scientific discovery in the age of artificial intelligence",
    meta: "Wang et al. · Nature 620, 47–60 · 2023",
    doi: "10.1038/s41586-023-06221-2",
    used: "Used 2 times",
    verified: true,
  },
  {
    key: "karniadakis2021physics",
    title: "Physics-informed machine learning",
    meta: "Karniadakis et al. · Nature Reviews Physics 3, 422–440 · 2021",
    doi: "10.1038/s42254-021-00314-5",
    used: "Used once",
    verified: true,
  },
];

const demoProjectNames: Record<string, string> = {
  demo: "Neural Networks for Scientific Discovery",
  "demo-thesis": "Graph Learning for Urban Mobility",
  "demo-survey": "Reliable AI Systems — Literature Survey",
};

function CommandPalette({
  open,
  onClose,
  onCommand,
}: {
  open: boolean;
  onClose: () => void;
  onCommand: (action: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? commands.filter((item) => item.label.toLocaleLowerCase().includes(normalized)) : commands;
  }, [query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="command-dialog"
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      onClick={(event: MouseEvent<HTMLDialogElement>) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette">
        <label className="command-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search commands</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filteredCommands[0]) {
                event.preventDefault();
                onCommand(filteredCommands[0].action);
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                dialogRef.current?.querySelector<HTMLButtonElement>(".command-result")?.focus();
              }
            }}
            placeholder="Type a command or search…"
          />
          <kbd>ESC</kbd>
        </label>
        <div className="command-results">
          {filteredCommands.length ? (
            filteredCommands.map((item, index) => (
              <button
                className={index === 0 ? "command-result command-result-active" : "command-result"}
                type="button"
                key={item.action}
                onClick={() => {
                  onCommand(item.action);
                  onClose();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const results = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>(".command-result") ?? []);
                  const offset = event.key === "ArrowDown" ? 1 : -1;
                  results[(index + offset + results.length) % results.length]?.focus();
                }}
              >
                <span className="command-result-group">{item.group}</span>
                <span>{item.label}</span>
                {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
              </button>
            ))
          ) : (
            <div className="command-empty">No commands matching “{query}”</div>
          )}
        </div>
        <footer className="command-footer">
          <span>↑↓ Navigate</span>
          <span>↵ Run</span>
          <span>ESC Close</span>
        </footer>
      </div>
    </dialog>
  );
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const auth = useAuth();
  const projectId = String(params.projectId);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const runTimers = useRef<number[]>([]);
  const [projectName, setProjectName] = useState(demoProjectNames[projectId] || "Neural Networks for Scientific Discovery");
  const [projectLoading, setProjectLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [activeScope, setActiveScope] = useState("Document");
  const [runTitle, setRunTitle] = useState("Strengthening Related Work");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("review");
  const [reviewState, setReviewState] = useState<ReviewState>("proposed");
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("ready");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("online");
  const [activeNav, setActiveNav] = useState("Workspace");
  const [activeFile, setActiveFile] = useState("main.tex");
  const [chaptersExpanded, setChaptersExpanded] = useState(true);
  const [figuresExpanded, setFiguresExpanded] = useState(false);
  const [contextType, setContextType] = useState<ContextType | null>("agent");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [pdfZoom, setPdfZoom] = useState(90);
  const [pdfFull, setPdfFull] = useState(false);
  const [showEquationSource, setShowEquationSource] = useState(false);
  const [sourceState, setSourceState] = useState<"idle" | "opening" | "ready" | "error" | "demo">("idle");
  const [workspaceUrl, setWorkspaceUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Floating selection toolbar state
  const [selectionToolbar, setSelectionToolbar] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
  }>({ visible: false, x: 0, y: 0, text: "" });

  // Citation details popover state
  const [citationPopover, setCitationPopover] = useState<{
    title: string;
    meta: string;
    doi: string;
    x: number;
    y: number;
  } | null>(null);

  const clearRunTimers = useCallback(() => {
    runTimers.current.forEach((timer) => window.clearTimeout(timer));
    runTimers.current = [];
  }, []);

  useEffect(() => clearRunTimers, [clearRunTimers]);

  useEffect(() => {
    if (auth.user) return;
    const previewName = window.sessionStorage.getItem(`easy-latex-project:${projectId}`);
    if (previewName) setProjectName(previewName);
    const initialPrompt = window.sessionStorage.getItem(`easy-latex-prompt:${projectId}`);
    if (initialPrompt) {
      setPrompt(initialPrompt);
      window.sessionStorage.removeItem(`easy-latex-prompt:${projectId}`);
    }
  }, [auth.user, projectId]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setContextType(null);
  }, []);

  useEffect(() => {
    if (!auth.user) return;
    setProjectLoading(true);
    void getProjects()
      .then((projects) => {
        const project = projects.find((item) => item.id === projectId);
        if (project) setProjectName(project.name);
      })
      .finally(() => setProjectLoading(false));
  }, [auth.user, projectId]);

  useEffect(() => {
    function handleOffline() { setConnectionStatus("offline"); }
    function handleOnline() {
      setConnectionStatus("reconnecting");
      window.setTimeout(() => setConnectionStatus("online"), 900);
    }
    if (!navigator.onLine) setConnectionStatus("offline");
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Selection detection for floating selection toolbar
  function handleDocumentMouseUp() {
    window.setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        const text = sel.toString().trim();
        if (text.length > 2) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setSelectionToolbar({
            visible: true,
            x: Math.max(120, rect.left + rect.width / 2),
            y: Math.max(60, rect.top - 12),
            text,
          });
          return;
        }
      }
      setSelectionToolbar((v) => ({ ...v, visible: false }));
    }, 20);
  }

  const runCompile = useCallback(() => {
    setContextType("pdf");
    setPdfFull(false);
    setCompileStatus("compiling");
    window.setTimeout(() => {
      setCompileStatus("success");
      setToast("PDF updated · 8 pages compiled successfully");
      window.setTimeout(() => setToast(null), 3000);
    }, 900);
  }, []);

  const focusPrompt = useCallback((value?: string, targetScope?: string) => {
    if (value) setPrompt(value);
    if (targetScope) setActiveScope(targetScope);
    setActiveNav("Workspace");
    setContextType("agent");
    setPdfFull(false);
    setMobileNavOpen(false);
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }, []);

  const startAgentRun = useCallback((request: string) => {
    clearRunTimers();
    setRunTitle(request.length > 42 ? `${request.slice(0, 42)}…` : request);
    setPrompt("");
    setAgentStatus("reading");
    setReviewState("proposed");
    setContextType("agent");
    setActiveNav("Workspace");
    runTimers.current = [
      window.setTimeout(() => setAgentStatus("editing"), 650),
      window.setTimeout(() => setAgentStatus("compiling"), 1450),
      window.setTimeout(() => {
        setAgentStatus("review");
        setCompileStatus("success");
      }, 2300),
    ];
  }, [clearRunTimers]);

  const submitPrompt = useCallback((event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const request = prompt.trim();
    if (!request || connectionStatus === "offline") return;
    startAgentRun(request);
  }, [connectionStatus, prompt, startAgentRun]);

  const openSource = useCallback(async () => {
    setActiveNav("Source");
    setContextType(null);
    setMobileNavOpen(false);

    if (projectId.startsWith("demo")) {
      window.setTimeout(() => setSourceState("demo"), 250);
      return;
    }

    if (workspaceUrl) {
      setSourceState("ready");
      return;
    }

    setSourceState("opening");
    try {
      const workspace = await openProject(projectId);
      if (!workspace.workspace_url) throw new Error("Source workspace is not ready");
      setWorkspaceUrl(workspace.workspace_url);
      setSourceState("ready");
    } catch {
      setSourceState("error");
    }
  }, [projectId, workspaceUrl]);

  const runCommand = useCallback((action: string) => {
    if (action === "ask") focusPrompt();
    if (action === "rewrite") focusPrompt("Rewrite Related Work for a sharper academic argument", "Section: Related Work");
    if (action === "citations") focusPrompt("Find and add supporting citations to Related Work", "Section: Related Work");
    if (action === "compile") runCompile();
    if (action === "pdf") {
      setContextType("pdf");
      setPdfFull(false);
    }
    if (action === "history") showToast("Version history opened");
    if (action === "source") void openSource();
  }, [focusPrompt, openSource, runCompile]);

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (modifier && event.key.toLocaleLowerCase() === "j") {
        event.preventDefault();
        focusPrompt();
      }
      if (modifier && event.shiftKey && event.key.toLocaleLowerCase() === "c") {
        event.preventDefault();
        runCompile();
      }
      if (modifier && event.shiftKey && event.key.toLocaleLowerCase() === "p") {
        event.preventDefault();
        setContextType((current) => current === "pdf" ? null : "pdf");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [focusPrompt, runCompile]);

  const filteredReferences = references.filter((reference) =>
    `${reference.title} ${reference.meta}`.toLocaleLowerCase().includes(referenceQuery.toLocaleLowerCase()),
  );

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 4000);
  }

  function applyChanges() {
    setReviewState("applied");
    setAgentStatus("applied");
    showToast("12 proposed changes applied · Undo is available");
  }

  function undoChanges() {
    setReviewState("reverted");
    setAgentStatus("idle");
    showToast("AI changes reverted to previous version");
  }

  function cancelRun() {
    clearRunTimers();
    setAgentStatus("cancelled");
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitPrompt();
  }

  function selectNavigation(label: string, nextContext: ContextType | null) {
    if (label === "Source") {
      void openSource();
      return;
    }
    setActiveNav(label);
    setContextType(nextContext);
    setPdfFull(false);
    setMobileNavOpen(false);
    if (label === "Document") document.getElementById("visual-document")?.focus();
  }

  function selectProjectFile(fileName: string) {
    setActiveFile(fileName);
    setActiveNav("Workspace");
    setMobileNavOpen(false);
    if (fileName !== "main.tex") showToast(`${fileName} selected`);
  }

  function compileLabel() {
    if (compileStatus === "compiling") return "Compiling…";
    if (compileStatus === "warning") return "1 warning";
    if (compileStatus === "error") return "Compile failed";
    return compileStatus === "success" ? "PDF updated" : "PDF ready";
  }

  function handleCitationClick(key: string, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const ref = references.find((r) => r.key === key) || references[0]!;
    const rect = event.currentTarget.getBoundingClientRect();
    setCitationPopover({
      title: ref.title,
      meta: ref.meta,
      doi: ref.doi || "10.1038/nature14539",
      x: rect.left,
      y: rect.bottom + 6,
    });
  }

  function renderWorkspacePanelHeader(activePanel: "agent" | "pdf") {
    return (
      <header className="context-panel-header workspace-panel-header">
        <div className="workspace-panel-switch" role="tablist" aria-label="Right panel view">
          <button
            className={activePanel === "agent" ? "workspace-panel-tab workspace-panel-tab-active" : "workspace-panel-tab"}
            type="button"
            role="tab"
            aria-selected={activePanel === "agent"}
            onClick={() => {
              setActiveNav("Workspace");
              setContextType("agent");
              setPdfFull(false);
            }}
          >
            <Sparkles aria-hidden="true" /> AI Chat
          </button>
          <button
            className={activePanel === "pdf" ? "workspace-panel-tab workspace-panel-tab-active" : "workspace-panel-tab"}
            type="button"
            role="tab"
            aria-selected={activePanel === "pdf"}
            onClick={() => {
              setContextType("pdf");
              setPdfFull(false);
            }}
          >
            <FileText aria-hidden="true" /> PDF Preview
          </button>
        </div>
        <div className="context-header-actions">
          {activePanel === "pdf" ? (
            <button
              className="workspace-icon-button"
              type="button"
              onClick={() => setPdfFull((value) => !value)}
              aria-label={pdfFull ? "Exit full PDF preview" : "Open full PDF preview"}
              title="Full preview"
            >
              <Maximize2 aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="workspace-icon-button"
            type="button"
            onClick={() => setContextType(null)}
            aria-label={`Close ${activePanel === "agent" ? "AI chat" : "PDF preview"}`}
            title="Close panel"
          >
            <PanelRightClose aria-hidden="true" />
          </button>
        </div>
      </header>
    );
  }

  function renderContextPanel() {
    if (contextType === "pdf") {
      return (
        <>
          {renderWorkspacePanelHeader("pdf")}
          <div className="pdf-toolbar" aria-label="PDF controls">
            <button type="button" onClick={() => setPdfZoom((value) => Math.max(75, value - 15))} aria-label="Zoom out">
              <ZoomOut aria-hidden="true" />
            </button>
            <span>{pdfZoom}%</span>
            <button type="button" onClick={() => setPdfZoom((value) => Math.min(150, value + 15))} aria-label="Zoom in">
              <ZoomIn aria-hidden="true" />
            </button>
            <span className="pdf-page-count">1 / 8</span>
            <button type="button" onClick={runCompile} title="Recompile document">
              <RefreshCw aria-hidden="true" />
            </button>
            <button type="button" aria-label="Open PDF in a new view">
              <ExternalLink aria-hidden="true" />
            </button>
          </div>
          <div className="pdf-viewport">
            <div className="pdf-page" style={{ width: `${pdfZoom}%` }}>
              <span className="pdf-running-head">NEURAL NETWORKS FOR SCIENTIFIC DISCOVERY</span>
              <h3>Neural Networks for<br />Scientific Discovery</h3>
              <p className="pdf-authors">Dinh Viet Huy · Mina Lee · Noah Kim</p>
              <div className="pdf-rule" />
              <h4>Abstract</h4>
              <p>Neural networks are becoming practical instruments for scientific discovery, not only predictive models.</p>
              <h4>1 &nbsp; Introduction</h4>
              <p>The relationship between machine learning and scientific practice is shifting toward active discovery.</p>
            </div>
          </div>
        </>
      );
    }

    if (contextType === "references") {
      return (
        <>
          <header className="context-panel-header">
            <div>
              <span className="context-eyebrow">Document context</span>
              <h2>References</h2>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => setContextType(null)} aria-label="Close references" title="Close panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </header>
          <div className="context-search">
            <Search aria-hidden="true" />
            <input
              value={referenceQuery}
              onChange={(event) => setReferenceQuery(event.target.value)}
              placeholder="Search title, author, DOI…"
              aria-label="Search references"
            />
            {referenceQuery ? (
              <button type="button" onClick={() => setReferenceQuery("")} aria-label="Clear reference search">
                <X aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="context-list">
            {filteredReferences.length ? (
              filteredReferences.map((reference) => (
                <button className="reference-row" type="button" key={reference.title}>
                  <span className="reference-title">{reference.title}</span>
                  <span className="reference-meta">{reference.meta}</span>
                  <span className="reference-foot">
                    <span><CheckCircle2 aria-hidden="true" /> Verified</span>
                    <span>{reference.used}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="context-empty">
                <Library aria-hidden="true" />
                <h3>No results for “{referenceQuery}”</h3>
                <p>Try a title, author, DOI, or citation key.</p>
                <button className="workspace-button workspace-button-secondary" type="button" onClick={() => setReferenceQuery("")}>
                  Clear search
                </button>
              </div>
            )}
          </div>
          <div className="context-sticky-action">
            <button className="workspace-button workspace-button-primary" type="button" onClick={() => showToast("Add Reference modal opened")}>
              <Plus aria-hidden="true" /> Add reference
            </button>
          </div>
        </>
      );
    }

    if (contextType === "comments") {
      return (
        <>
          <header className="context-panel-header">
            <div>
              <span className="context-eyebrow">2 open threads</span>
              <h2>Comments</h2>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => setContextType(null)} aria-label="Close comments" title="Close panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </header>
          <div className="comment-thread">
            <div className="comment-author">
              <span className="presence-avatar presence-avatar-one">ML</span>
              <span><strong>Mina Lee</strong><small>12 minutes ago · Introduction</small></span>
            </div>
            <blockquote>“decide which experiments to run next”</blockquote>
            <p>Should we connect this claim to the active-learning literature?</p>
            <div className="comment-actions">
              <button type="button" onClick={() => showToast("Reply editor opened")}>Reply</button>
              <button type="button" onClick={() => showToast("Thread marked resolved")}>Resolve</button>
            </div>
          </div>
          <div className="comment-thread">
            <div className="comment-author">
              <span className="presence-avatar presence-avatar-two">NK</span>
              <span><strong>Noah Kim</strong><small>Yesterday · Related Work</small></span>
            </div>
            <p>I added the 2023 survey to our library. The agent can use it in this section.</p>
            <div className="comment-actions">
              <button type="button" onClick={() => showToast("Reply editor opened")}>Reply</button>
              <button type="button" onClick={() => showToast("Thread marked resolved")}>Resolve</button>
            </div>
          </div>
        </>
      );
    }

    if (contextType === "figures") {
      return (
        <>
          <header className="context-panel-header">
            <div>
              <span className="context-eyebrow">4 project assets</span>
              <h2>Figures & Assets</h2>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => setContextType(null)} aria-label="Close figures" title="Close panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </header>
          <div className="asset-list">
            <button className="asset-row" type="button">
              <span className="asset-preview">
                <svg viewBox="0 0 80 54" role="img" aria-label="Model pipeline diagram">
                  <path d="M8 27h18m10 0h18m10 0h8" />
                  <rect x="26" y="17" width="10" height="20" />
                  <circle cx="59" cy="27" r="5" />
                </svg>
              </span>
              <span><strong>model-pipeline</strong><small>TikZ · Used once</small></span>
            </button>
            <button className="asset-row" type="button">
              <span className="asset-preview asset-preview-table">
                <Table2 aria-hidden="true" />
              </span>
              <span><strong>benchmark-results</strong><small>Table · Used twice</small></span>
            </button>
          </div>
          <div className="context-sticky-action">
            <button className="workspace-button workspace-button-primary" type="button" onClick={() => showToast("Add Figure upload ready")}>
              <Plus aria-hidden="true" /> Add figure
            </button>
          </div>
        </>
      );
    }

    if (contextType === "history") {
      return (
        <>
          <header className="context-panel-header">
            <div>
              <span className="context-eyebrow">Version history</span>
              <h2>Today</h2>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => setContextType(null)} aria-label="Close history" title="Close panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </header>
          <ol className="history-list">
            <li>
              <span className="history-dot history-dot-ai"><Sparkles aria-hidden="true" /></span>
              <div>
                <strong>Strengthened Related Work</strong>
                <p>AI run · 12 proposed changes</p>
                <time>4:32 PM</time>
              </div>
            </li>
            <li>
              <span className="history-dot">ML</span>
              <div>
                <strong>Mina edited Introduction</strong>
                <p>2 paragraphs changed</p>
                <time>4:18 PM</time>
              </div>
            </li>
            <li>
              <span className="history-dot">DV</span>
              <div>
                <strong>Document compiled</strong>
                <p>Version 18 · 8 pages</p>
                <time>3:56 PM</time>
              </div>
            </li>
          </ol>
        </>
      );
    }

    if (contextType === "collaborators") {
      return (
        <>
          <header className="context-panel-header">
            <div>
              <span className="context-eyebrow">3 people online</span>
              <h2>Collaborators</h2>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => setContextType(null)} aria-label="Close collaborators" title="Close panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </header>
          <div className="collaborator-list">
            <div className="collaborator-row">
              <span className="presence-avatar presence-avatar-three">DV</span>
              <span><strong>You</strong><small>Editing Related Work</small></span>
              <span>Owner</span>
            </div>
            <div className="collaborator-row">
              <span className="presence-avatar presence-avatar-one">ML</span>
              <span><strong>Mina Lee</strong><small>Editing Introduction</small></span>
              <span>Editor</span>
            </div>
            <div className="collaborator-row">
              <span className="presence-avatar presence-avatar-two">NK</span>
              <span><strong>Noah Kim</strong><small>Viewing Document</small></span>
              <span>Editor</span>
            </div>
          </div>
          <div className="context-sticky-action">
            <button className="workspace-button workspace-button-primary" type="button" onClick={() => showToast("Invite link copied to clipboard")}>
              <Plus aria-hidden="true" /> Invite collaborator
            </button>
          </div>
        </>
      );
    }

    if (contextType === "source") {
      return (
        <>
          <header className="context-panel-header">
            <div>
              <span className="context-eyebrow">Advanced mode</span>
              <h2>Source workspace</h2>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => setContextType(null)} aria-label="Close source status" title="Close panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </header>
          <div className="source-panel-state">
            {sourceState === "opening" ? (
              <>
                <LoaderCircle className="spinner" aria-hidden="true" />
                <h3>Opening Source Mode…</h3>
                <p>Starting code-server with LaTeX Workshop and your project tools.</p>
              </>
            ) : null}
            {sourceState === "demo" ? (
              <>
                <Code2 aria-hidden="true" />
                <h3>Source is an advanced workspace</h3>
                <p>In a live project this opens code-server with LaTeX Workshop, files, Git, terminal, and SyncTeX.</p>
                <span className="source-safety"><Braces aria-hidden="true" /> Visual edits preserve unsupported LaTeX blocks.</span>
                <button className="workspace-button workspace-button-secondary" type="button" onClick={() => { setActiveNav("Document"); setContextType(null); }}>
                  Back to Visual Editor
                </button>
              </>
            ) : null}
            {sourceState === "error" ? (
              <>
                <AlertCircle aria-hidden="true" />
                <h3>Source Mode could not open</h3>
                <p>Your document was preserved. Check the workspace service, then try again.</p>
                <button className="workspace-button workspace-button-secondary" type="button" onClick={() => void openSource()}>
                  <RefreshCw aria-hidden="true" /> Retry
                </button>
              </>
            ) : null}
          </div>
        </>
      );
    }

    return (
      <>
        {renderWorkspacePanelHeader("agent")}
        <div className="agent-conversation">
          <div className="ai-chat-thread" aria-live="polite">
            <div className="ai-chat-message ai-chat-message-user">
              <span className="ai-chat-author">You</span>
              <p>{runTitle}</p>
            </div>
            <div className="ai-chat-message ai-chat-message-assistant">
              <span className="ai-chat-avatar" aria-hidden="true"><Sparkles /></span>
              <div>
                <span className="ai-chat-author">Easy LaTeX AI</span>
                {agentStatus === "reading" ? <p>Reading the document and gathering context…</p> : null}
                {agentStatus === "editing" ? <p>Working on the requested changes…</p> : null}
                {agentStatus === "compiling" ? <p>Checking the edits against the compiled document…</p> : null}
                {agentStatus === "review" ? <p>I prepared the revision. The proposed edits are highlighted directly in the document.</p> : null}
                {agentStatus === "applied" ? <p>The proposed edits have been applied to the document.</p> : null}
                {agentStatus === "cancelled" ? <p>The request was cancelled. No changes were applied.</p> : null}
                {agentStatus === "failed" ? <p>I could not verify the result. Your document has not been changed.</p> : null}
                {agentStatus === "idle" ? <p>What would you like to change or understand about this document?</p> : null}
              </div>
            </div>
          </div>
        </div>
        <form className="intent-bar agent-intent-bar" onSubmit={submitPrompt}>
          <div className="intent-input-row">
            <span className="intent-spark" aria-hidden="true"><Sparkles /></span>
            <label htmlFor="agent-prompt" className="sr-only">Ask AI to work on the document</label>
            <textarea
              ref={promptRef}
              id="agent-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Ask AI about this document…"
              rows={2}
              disabled={connectionStatus === "offline"}
            />
            <button className="workspace-icon-button" type="button" aria-label="Attach context" title="Attach context" onClick={() => showToast("Context attachment: references & figures")}>
              <Paperclip aria-hidden="true" />
            </button>
            <button className="intent-submit" type="submit" disabled={!prompt.trim() || connectionStatus === "offline"} aria-label="Run AI request" title="Run AI request">
              <ArrowUp aria-hidden="true" />
            </button>
          </div>
          <div className="intent-meta">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="scope-chip" type="button">
                  {activeScope} <ChevronDown aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dropdown-content" align="start" sideOffset={4}>
                  <DropdownMenu.Item className="dropdown-item" onSelect={() => setActiveScope("Document")}>Document (Full paper)</DropdownMenu.Item>
                  <DropdownMenu.Item className="dropdown-item" onSelect={() => setActiveScope("Section: Related Work")}>Section: Related Work</DropdownMenu.Item>
                  <DropdownMenu.Item className="dropdown-item" onSelect={() => setActiveScope("Section: Introduction")}>Section: Introduction</DropdownMenu.Item>
                  <DropdownMenu.Item className="dropdown-item" onSelect={() => setActiveScope("Selection")}>Active Selection</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div className="prompt-suggestions" aria-label="Suggested AI actions">
              <button type="button" onClick={() => focusPrompt("Strengthen the argument in Related Work", "Section: Related Work")}>Strengthen argument</button>
              <button type="button" onClick={() => focusPrompt("Find and add supporting citations", "Section: Related Work")}>Add citations</button>
              <button type="button" onClick={() => focusPrompt("Format equations and verify mathematical definitions", "Document")}>Check math</button>
              <button type="button" onClick={() => focusPrompt("Check the document structure against Nature guidelines", "Document")}>Check structure</button>
            </div>
            <span className="intent-shortcut">⌘ ↵ to run</span>
          </div>
        </form>
      </>
    );
  }

  return (
    <div
      className={`project-workspace-shell${navCollapsed ? " nav-collapsed" : ""}${contextType ? "" : " context-closed"}${pdfFull ? " pdf-full" : ""}${activeNav === "Source" ? " source-mode" : ""}`}
      onClick={() => setCitationPopover(null)}
    >
      <a className="skip-link" href="#visual-document">Skip to document</a>
      {connectionStatus !== "online" ? (
        <div className={`workspace-system-banner system-banner-${connectionStatus}`} role="status">
          {connectionStatus === "offline" ? (
            <><AlertCircle aria-hidden="true" /> Offline — edits stay on this device. AI and reference search are unavailable.</>
          ) : (
            <><LoaderCircle className="spinner" aria-hidden="true" /> Reconnecting… Your local edits are safe.</>
          )}
        </div>
      ) : null}

      <header className="project-topbar">
        <div className="project-location">
          <button className="workspace-icon-button mobile-project-menu" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open project navigation" title="Project navigation">
            <Menu aria-hidden="true" />
          </button>
          {activeNav === "Source" ? (
            <button
              className="workspace-button workspace-button-primary back-to-visual-btn"
              type="button"
              onClick={() => selectNavigation("Document", null)}
              aria-label="Back to Visual Editor"
              title="Return to visual document editor"
            >
              <ChevronLeft aria-hidden="true" />
              <span>Back to Visual</span>
            </button>
          ) : (
            <a className="workspace-back" href="/projects" aria-label="Back to projects" title="Back to projects">
              <ChevronLeft aria-hidden="true" />
            </a>
          )}
          <span className="project-wordmark" aria-hidden="true">TeX</span>
          {projectLoading ? (
            <span className="project-title-skeleton" aria-label="Loading project title" />
          ) : (
            <span className="project-name">{projectName}</span>
          )}
          <span className="project-id">#{projectId.slice(0, 4)}</span>
          {activeNav === "Source" ? (
            <span className="source-mode-badge" title="Source workspace powered by code-server">
              <Code2 aria-hidden="true" /> Advanced Mode
            </span>
          ) : null}
        </div>

        <div className="project-statuses" aria-label="Document status">
          <span className="quiet-status"><Check aria-hidden="true" /> Saved</span>
          <button className={`quiet-status compile-status compile-status-${compileStatus}`} type="button" onClick={() => setContextType("pdf")}>
            {compileStatus === "compiling" ? <LoaderCircle className="spinner" aria-hidden="true" /> : compileStatus === "error" ? <AlertCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
            {compileLabel()}
          </button>
        </div>

        <div className="project-actions">
          {activeNav === "Source" && workspaceUrl ? (
            <a
              className="workspace-button workspace-button-secondary source-newtab-btn"
              href={workspaceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open code-server in a separate full browser tab"
            >
              <ExternalLink aria-hidden="true" />
              <span>Open in new tab</span>
            </a>
          ) : null}
          <button className="command-trigger" type="button" onClick={() => setCommandOpen(true)} aria-label="Open command palette">
            <Search aria-hidden="true" />
            <span>Commands</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="avatar-stack" aria-label="Three collaborators online">
            <span className="presence-avatar presence-avatar-one" title="Mina Lee — Editing Introduction">ML</span>
            <span className="presence-avatar presence-avatar-two" title="Noah Kim — Viewing Related Work">NK</span>
            <span className="presence-avatar presence-avatar-three" title="You — Owner">DV</span>
          </div>
          <button className="workspace-button workspace-button-secondary" type="button" onClick={() => showToast("Share options opened")}>
            Share
          </button>
          <button className="workspace-button workspace-button-secondary pdf-topbar-button" type="button" onClick={() => setContextType((current) => current === "pdf" ? null : "pdf")}>
            PDF
          </button>
          <button className="workspace-button workspace-button-primary" type="button" onClick={runCompile} disabled={compileStatus === "compiling"}>
            {compileStatus === "compiling" ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {compileStatus === "compiling" ? "Compiling…" : "Compile"}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="workspace-icon-button" type="button" aria-label="More project actions" title="More project actions">
                <MoreHorizontal aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="dropdown-content workspace-overflow" align="end" sideOffset={4}>
                <DropdownMenu.Item className="dropdown-item" onSelect={() => setCommandOpen(true)}>
                  <Command aria-hidden="true" /> Command palette <kbd>⌘ K</kbd>
                </DropdownMenu.Item>
                <DropdownMenu.Item className="dropdown-item" onSelect={() => showToast("Version history opened")}>
                  <FileClock aria-hidden="true" /> View history
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="dropdown-separator" />
                <DropdownMenu.Item className="dropdown-item" onSelect={() => void openSource()}>
                  <Code2 aria-hidden="true" /> Open Source / Advanced
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {mobileNavOpen ? <button className="workspace-nav-backdrop" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close project navigation" /> : null}

      <div className="workspace-grid">
        <aside className={`project-sidebar${mobileNavOpen ? " project-sidebar-open" : ""}`} aria-label="Project navigation">
          <div className="project-sidebar-heading">
            <span>Files</span>
            <div className="file-tree-actions">
              <button type="button" onClick={() => showToast("New file ready")} aria-label="New file" title="New file"><FilePlus2 aria-hidden="true" /></button>
              <button type="button" onClick={() => showToast("New folder ready")} aria-label="New folder" title="New folder"><FolderPlus aria-hidden="true" /></button>
              <button type="button" onClick={() => showToast("Upload files ready")} aria-label="Upload files" title="Upload files"><Upload aria-hidden="true" /></button>
              <button type="button" onClick={() => setNavCollapsed((value) => !value)} aria-label={navCollapsed ? "Expand file explorer" : "Collapse file explorer"} title={navCollapsed ? "Expand file explorer" : "Collapse file explorer"}>
                {navCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </button>
            </div>
          </div>
          <nav className="project-file-tree" aria-label="Project files">
            <button className={`file-tree-row${activeFile === "main.tex" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("main.tex")}>
              <FileText aria-hidden="true" /><span>main.tex</span>
            </button>
            <button className={`file-tree-row${activeFile === "preamble.tex" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("preamble.tex")}>
              <FileText aria-hidden="true" /><span>preamble.tex</span>
            </button>
            <button className="file-tree-row file-tree-folder" type="button" onClick={() => setChaptersExpanded((value) => !value)} aria-expanded={chaptersExpanded}>
              <ChevronDown className={chaptersExpanded ? "" : "file-tree-chevron-collapsed"} aria-hidden="true" />
              {chaptersExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
              <span>chapters</span>
            </button>
            {chaptersExpanded ? (
              <div className="file-tree-children">
                <button className={`file-tree-row${activeFile === "introduction.tex" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("introduction.tex")}><FileText aria-hidden="true" /><span>introduction.tex</span></button>
                <button className={`file-tree-row${activeFile === "related-work.tex" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("related-work.tex")}><FileText aria-hidden="true" /><span>related-work.tex</span></button>
                <button className={`file-tree-row${activeFile === "methods.tex" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("methods.tex")}><FileText aria-hidden="true" /><span>methods.tex</span></button>
              </div>
            ) : null}
            <button className="file-tree-row file-tree-folder" type="button" onClick={() => setFiguresExpanded((value) => !value)} aria-expanded={figuresExpanded}>
              <ChevronDown className={figuresExpanded ? "" : "file-tree-chevron-collapsed"} aria-hidden="true" />
              {figuresExpanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
              <span>figures</span><span className="file-tree-count">4</span>
            </button>
            {figuresExpanded ? (
              <div className="file-tree-children">
                <button className={`file-tree-row${activeFile === "model-pipeline.svg" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("model-pipeline.svg")}><Image aria-hidden="true" /><span>model-pipeline.svg</span></button>
                <button className={`file-tree-row${activeFile === "results-chart.pdf" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("results-chart.pdf")}><Image aria-hidden="true" /><span>results-chart.pdf</span></button>
              </div>
            ) : null}
            <button className={`file-tree-row${activeFile === "references.bib" ? " file-tree-row-active" : ""}`} type="button" onClick={() => selectProjectFile("references.bib")}>
              <Library aria-hidden="true" /><span>references.bib</span>
            </button>
          </nav>
          <div className="document-outline">
            <div className="sidebar-section-title"><ChevronDown aria-hidden="true" /><span>Outline</span></div>
            <button type="button" className="outline-item" onClick={() => document.getElementById("abstract")?.scrollIntoView({ behavior: "smooth" })}>
              Abstract
            </button>
            <button type="button" className="outline-item" onClick={() => document.getElementById("introduction")?.scrollIntoView({ behavior: "smooth" })}>
              1. Introduction
            </button>
            <button type="button" className="outline-item outline-item-active" onClick={() => document.getElementById("related-work")?.scrollIntoView({ behavior: "smooth" })}>
              2. Related Work
            </button>
            <button type="button" className="outline-item outline-indent" onClick={() => document.getElementById("related-work")?.scrollIntoView({ behavior: "smooth" })}>
              2.1 Foundation models
            </button>
            <button type="button" className="outline-item" onClick={() => document.getElementById("objective-equation")?.scrollIntoView({ behavior: "smooth" })}>
              3. Objective formulation
            </button>
            <button type="button" className="outline-item" onClick={() => document.getElementById("model-diagram")?.scrollIntoView({ behavior: "smooth" })}>
              4. Model Architecture
            </button>
          </div>
        </aside>

        <main className="workspace-main" onMouseUp={handleDocumentMouseUp}>
          {activeNav === "Source" ? (
            <div className="source-workspace-container">
              {sourceState === "opening" ? (
                <div className="source-state-screen">
                  <LoaderCircle className="spinner" aria-hidden="true" />
                  <h3>Opening Source Mode…</h3>
                  <p>Starting code-server with LaTeX Workshop and your project tools.</p>
                  <button className="workspace-button workspace-button-secondary" type="button" onClick={() => selectNavigation("Document", null)}>
                    Back to Visual Editor
                  </button>
                </div>
              ) : null}

              {sourceState === "error" ? (
                <div className="source-state-screen">
                  <AlertCircle aria-hidden="true" />
                  <h3>Source Mode could not open</h3>
                  <p>Your document was preserved. Check the workspace service, then try again.</p>
                  <div className="source-state-actions">
                    <button className="workspace-button workspace-button-primary" type="button" onClick={() => void openSource()}>
                      <RefreshCw aria-hidden="true" /> Retry
                    </button>
                    <button className="workspace-button workspace-button-secondary" type="button" onClick={() => selectNavigation("Document", null)}>
                      Back to Visual Editor
                    </button>
                  </div>
                </div>
              ) : null}

              {sourceState === "demo" ? (
                <div className="source-state-screen">
                  <Code2 aria-hidden="true" />
                  <h3>Source is an advanced workspace</h3>
                  <p>In a live project this opens code-server with LaTeX Workshop, files, Git, terminal, and SyncTeX.</p>
                  <span className="source-safety"><Braces aria-hidden="true" /> Visual edits preserve unsupported LaTeX blocks.</span>
                  <button className="workspace-button workspace-button-secondary" type="button" onClick={() => selectNavigation("Document", null)}>
                    Back to Visual Editor
                  </button>
                </div>
              ) : null}

              {workspaceUrl ? (
                <iframe
                  src={workspaceUrl}
                  className="source-iframe"
                  title="LaTeX Code Server Workspace"
                  allow="clipboard-read; clipboard-write; fullscreen"
                  style={{ display: sourceState === "ready" ? "block" : "none" }}
                />
              ) : null}
            </div>
          ) : null}

          <div className="workspace-scroll" style={{ display: activeNav === "Source" ? "none" : undefined }}>
            {projectLoading ? (
              <div className="document-loading" role="status">
                <span className="sr-only">Loading document…</span>
                <span /><span /><span /><span />
              </div>
            ) : (
              <article className="visual-document" id="visual-document" aria-label="Visual document editor" tabIndex={-1}>
                <div className="document-kicker">
                  <span>Research paper · Article</span>
                  <span>4,218 words</span>
                </div>
                <h1>{projectName}</h1>
                <p className="document-authors">Dinh Viet Huy · Mina Lee · Noah Kim</p>

                <section className="document-section" id="abstract">
                  <h2>Abstract</h2>
                  <p contentEditable suppressContentEditableWarning>
                    Neural networks are becoming practical instruments for scientific discovery, not only predictive models. We examine how learned representations support hypothesis generation, simulation, and the interpretation of complex physical systems.
                  </p>
                </section>

                <section className="document-section document-section-selected" id="introduction">
                  <div className="block-toolbar" aria-label="Selected paragraph actions">
                    <button type="button" aria-label="Bold" onClick={() => document.execCommand("bold")}><strong>B</strong></button>
                    <button type="button" aria-label="Italic" onClick={() => document.execCommand("italic")}><em>I</em></button>
                    <span />
                    <button type="button" onClick={() => showToast("Comment thread opened in the editor")}>
                      <MessageSquare aria-hidden="true" /> Comment
                    </button>
                    <button className="ask-ai-action" type="button" onClick={() => focusPrompt("Improve the selected paragraph in Introduction", "Section: Introduction")}>
                      <Sparkles aria-hidden="true" /> Ask AI
                    </button>
                    <button type="button" aria-label="More text actions">
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                  </div>
                  <h2>1. Introduction</h2>
                  <p contentEditable suppressContentEditableWarning>
                    The relationship between machine learning and scientific practice is shifting. Instead of fitting models only after a theory has been formed, researchers increasingly use neural systems to surface useful structure in data and decide which experiments to run next.
                  </p>
                  <span className="collaborator-caret" aria-label="Mina is editing this paragraph">
                    <span>Mina</span>
                  </span>
                </section>

                {/* AI-Reviewed Section with Semantic Diff (DESIGN.md Section 12) */}
                <section className={`document-section ai-reviewed-section ai-reviewed-${reviewState}`} id="related-work">
                  <span className="ai-change-marker">
                    <Sparkles aria-hidden="true" /> {reviewState === "proposed" ? "Proposed" : reviewState === "applied" ? "Applied by AI" : reviewState === "reverted" ? "Reverted" : "Reviewed"}
                  </span>
                  <h2>2. Related Work</h2>
                  {reviewState === "proposed" ? (
                    <p className="semantic-diff">
                      <span>Earlier work focused on surrogate models for expensive simulations. </span>
                      <del>Recent foundation models extend this role</del>
                      <ins>Foundation models now broaden that role</ins>
                      <span> by connecting literature, symbolic representations, and experimental observations, </span>
                      <ins>enabling evidence-aware reasoning across the scientific workflow</ins>
                      <span>.</span>
                      <button
                        className="citation-chip"
                        type="button"
                        onClick={(e) => handleCitationClick("lecun2015deep", e)}
                        aria-label="Citation LeCun and others, 2015"
                      >
                        <CheckCircle2 aria-hidden="true" /> LeCun et al., 2015
                      </button>
                      <button
                        className="citation-chip"
                        type="button"
                        onClick={(e) => handleCitationClick("wang2023scientific", e)}
                        aria-label="Citation Wang and others, 2023"
                      >
                        <CheckCircle2 aria-hidden="true" /> Wang et al., 2023
                      </button>
                    </p>
                  ) : reviewState === "applied" ? (
                    <p>
                      Earlier work focused on surrogate models for expensive simulations. Foundation models now broaden that role by connecting literature, symbolic representations, and experimental observations, enabling evidence-aware reasoning across the scientific workflow.
                      <button
                        className="citation-chip"
                        type="button"
                        onClick={(e) => handleCitationClick("lecun2015deep", e)}
                        aria-label="Citation LeCun and others, 2015"
                      >
                        <CheckCircle2 aria-hidden="true" /> LeCun et al., 2015
                      </button>
                    </p>
                  ) : (
                    <p>
                      Earlier work focused on surrogate models for expensive simulations. Recent foundation models extend this role by connecting literature, symbolic representations, and experimental observations.
                      <button
                        className="citation-chip"
                        type="button"
                        onClick={(e) => handleCitationClick("lecun2015deep", e)}
                        aria-label="Citation LeCun and others, 2015"
                      >
                        <CheckCircle2 aria-hidden="true" /> LeCun et al., 2015
                      </button>
                    </p>
                  )}

                  {reviewState === "proposed" ? (
                    <div className="ai-review-strip" id="ai-change-review">
                      <div>
                        <span className="status-badge status-badge-review">Medium impact</span>
                        <strong>AI proposes 12 changes</strong>
                        <p>
                          <span className="change-added">+ 42 words</span>
                          <span className="change-removed">− 18 words</span> · 2 verified citations added
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: "var(--space-2)" }}>
                        <button className="workspace-button workspace-button-secondary" type="button" onClick={() => { setReviewState("rejected"); setAgentStatus("idle"); }}>
                          Reject
                        </button>
                        <button className="workspace-button workspace-button-primary" type="button" onClick={applyChanges}>
                          Apply changes
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {reviewState === "applied" ? (
                    <div className="applied-change-bar">
                      <CheckCircle2 aria-hidden="true" />
                      <span><strong>AI updated this section.</strong> 12 changes applied.</span>
                      <button type="button" onClick={undoChanges}>
                        <Undo2 aria-hidden="true" /> Undo
                      </button>
                    </div>
                  ) : null}

                  {reviewState === "reverted" ? (
                    <div className="applied-change-bar reverted-change-bar">
                      <Undo2 aria-hidden="true" />
                      <span><strong>AI changes reverted.</strong> Earlier version restored.</span>
                      <button type="button" onClick={() => { setReviewState("proposed"); setAgentStatus("review"); }}>
                        Review again
                      </button>
                    </div>
                  ) : null}
                </section>

                {/* Display Equation Block (DESIGN.md Section 13.3) */}
                <figure className="equation-block" id="objective-equation">
                  <span className="equation-label">Equation 1</span>
                  {showEquationSource ? (
                    <div className="code-surface" style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
                      <code>{"\\theta^* = \\arg\\min_{\\theta} \\mathcal{L}(f_{\\theta}(x), y)"}</code>
                    </div>
                  ) : (
                    <div role="math" aria-label="theta star equals arg min over theta of loss of f theta of x and y">
                      θ* = arg min<sub>θ</sub> 𝓛(f<sub>θ</sub>(x), y)
                    </div>
                  )}
                  <figcaption>Equation 1 · Training objective for the learned scientific surrogate.</figcaption>
                  <div className="block-actions">
                    <button type="button" onClick={() => setShowEquationSource((v) => !v)}>
                      {showEquationSource ? "Render math" : "TeX source"}
                    </button>
                    <button type="button" onClick={() => focusPrompt("Explain Equation 1 training objective in plain language")}>
                      Explain with AI
                    </button>
                    <button type="button" onClick={() => void openSource()}>
                      Open source
                    </button>
                  </div>
                </figure>

                {/* Preserved TikZ Diagram Block (DESIGN.md Section 13.5) */}
                <figure className="custom-latex-block" id="model-diagram">
                  <div className="custom-block-header">
                    <span>
                      <Braces aria-hidden="true" />
                      <strong>TikZ diagram</strong>
                    </span>
                    <span className="source-preserved-label">
                      <Check aria-hidden="true" /> Source preserved
                    </span>
                  </div>
                  <svg className="tikz-preview" viewBox="0 0 600 120" role="img" aria-label="Rendered model pipeline diagram">
                    <rect x="24" y="36" width="120" height="48" rx="6" />
                    <rect x="240" y="36" width="120" height="48" rx="6" />
                    <rect x="456" y="36" width="120" height="48" rx="6" />
                    <path d="M144 60h96m120 0h96" />
                    <path d="m228 52 12 8-12 8m216-16 12 8-12 8" />
                    <text x="84" y="65" textAnchor="middle">Observations</text>
                    <text x="300" y="65" textAnchor="middle">Neural model</text>
                    <text x="516" y="65" textAnchor="middle">Hypothesis</text>
                  </svg>
                  <figcaption>Visual Mode keeps this custom block read-only to avoid unsafe source changes.</figcaption>
                  <div className="custom-block-actions">
                    <button className="workspace-button workspace-button-secondary" type="button" onClick={() => void openSource()}>
                      <Code2 aria-hidden="true" /> Open in Source
                    </button>
                    <button className="workspace-button workspace-button-secondary" type="button" onClick={() => focusPrompt("Explain the TikZ model pipeline diagram")}>
                      Explain with AI
                    </button>
                  </div>
                </figure>
              </article>
            )}
          </div>
        </main>

        {contextType ? (
          <aside className={`context-panel context-panel-open${contextType === "agent" ? " context-panel-agent" : ""}`} aria-label={contextType === "agent" ? "AI assistant" : `${contextType} panel`}>
            {renderContextPanel()}
          </aside>
        ) : null}
      </div>

      {/* Floating Selection Toolbar (DESIGN.md Section 13 & 14) */}
      {selectionToolbar.visible ? (
        <div
          className="floating-selection-toolbar"
          style={{
            position: "fixed",
            left: `${selectionToolbar.x}px`,
            top: `${selectionToolbar.y}px`,
            transform: "translate(-50%, -100%)",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" onClick={() => document.execCommand("bold")} aria-label="Bold">
            <strong>B</strong>
          </button>
          <button type="button" onClick={() => document.execCommand("italic")} aria-label="Italic">
            <em>I</em>
          </button>
          <span className="floating-divider" />
          <button type="button" onClick={() => showToast("Comment thread opened in the editor")}>
            <MessageSquare aria-hidden="true" style={{ width: 13, height: 13 }} />
            Comment
          </button>
          <button
            className="ask-ai-btn"
            type="button"
            onClick={() => {
              focusPrompt(`Improve the selected text: "${selectionToolbar.text}"`, "Selection");
              setSelectionToolbar((v) => ({ ...v, visible: false }));
            }}
          >
            <Sparkles aria-hidden="true" style={{ width: 13, height: 13 }} />
            Ask AI
          </button>
        </div>
      ) : null}

      {/* Citation Popover Card */}
      {citationPopover ? (
        <div
          className="citation-preview-popover"
          style={{
            position: "fixed",
            left: `${citationPopover.x}px`,
            top: `${citationPopover.y}px`,
            zIndex: 90,
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "var(--radius-panel)",
            boxShadow: "var(--shadow-popover)",
            padding: "var(--space-3)",
            maxWidth: "320px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: "var(--color-accent)" }} />
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-accent)" }}>Verified Source</span>
          </div>
          <strong style={{ display: "block", fontSize: "13px", lineHeight: "18px", marginBottom: 4 }}>
            {citationPopover.title}
          </strong>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "0 0 8px" }}>
            {citationPopover.meta}
          </p>
          <button
            className="workspace-button workspace-button-secondary"
            type="button"
            style={{ width: "100%", height: 26, fontSize: 11 }}
            onClick={() => {
              setActiveFile("references.bib");
              setCitationPopover(null);
              showToast("references.bib selected");
            }}
          >
            Open references.bib
          </button>
        </div>
      ) : null}

      {/* Toast Notification */}
      {toast ? (
        <div className="workspace-toast" role="status">
          <CheckCircle2 aria-hidden="true" />
          <span>{toast}</span>
          {reviewState === "applied" ? (
            <button type="button" onClick={undoChanges}>Undo</button>
          ) : null}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onCommand={runCommand} />
    </div>
  );
}
