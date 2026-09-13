"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FileUp,
  FolderOpen,
  GraduationCap,
  LayoutGrid,
  LayoutList,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import {
  createProject,
  deleteProject,
  getProjects,
  type Project,
} from "@/lib/api";

type ProjectFilter = "all" | "mine" | "shared" | "favorites";
type ViewMode = "list" | "grid";
type CreatePath = "ai" | "template" | "import";
type SidebarView = "projects" | "templates";

interface AcademicTemplate {
  id: string;
  title: string;
  category: string;
  institution: string;
  description: string;
  docClass: string;
  twoColumn?: boolean;
  defaultPrompt: string;
}

const academicTemplates: AcademicTemplate[] = [
  {
    id: "research-paper",
    title: "Nature & arXiv Research Paper",
    category: "Research paper",
    institution: "Nature / arXiv Standard",
    description: "Single-column layout with structured abstract, semantic headings, equations, and BibTeX.",
    docClass: "article",
    defaultPrompt: "Draft an empirical research paper investigating foundation models for scientific reasoning",
  },
  {
    id: "thesis-dissertation",
    title: "Master & Ph.D. Dissertation",
    category: "Thesis",
    institution: "University Standard",
    description: "Book structure with dedication, abstract, chapters, notation index, and appendices.",
    docClass: "book",
    defaultPrompt: "Structure a Ph.D. dissertation on scalable geometric deep learning algorithms",
  },
  {
    id: "ieee-conference",
    title: "IEEE Conference Proceedings",
    category: "Conference paper",
    institution: "IEEE Computer Society",
    description: "Two-column conference paper formatted for IEEE transactions and conference proceedings.",
    docClass: "IEEEtran",
    twoColumn: true,
    defaultPrompt: "Write an IEEE conference paper on low-latency neural inference for edge hardware",
  },
  {
    id: "acm-sigconf",
    title: "ACM SIGCONF Proceedings",
    category: "Journal article",
    institution: "ACM Digital Library",
    description: "ACM primary conference template with ACM CCS taxonomy codes, keywords, and author bios.",
    docClass: "acmart",
    twoColumn: true,
    defaultPrompt: "Prepare an ACM conference paper on human-AI collaborative document synthesis",
  },
  {
    id: "tech-report",
    title: "Technical Whitepaper & Report",
    category: "Report",
    institution: "Technical Institute",
    description: "Clean institutional research report with executive summary, figures, and benchmark tables.",
    docClass: "report",
    defaultPrompt: "Create a technical specification report for automated typesetting pipelines",
  },
  {
    id: "academic-cv",
    title: "Academic Curriculum Vitae",
    category: "Curriculum Vitae",
    institution: "ModernCV Format",
    description: "Crisp academic CV with publications, education, honors, grants, and teaching records.",
    docClass: "moderncv",
    defaultPrompt: "Generate an academic CV with publication records, grants, and teaching experience",
  },
];

const IS_LOCAL_PREVIEW = process.env.NODE_ENV === "development";

const previewProjects: Project[] = [
  {
    id: "demo",
    owner_id: "preview-user",
    name: "Neural Networks for Scientific Discovery",
    created_at: "2026-09-08T03:20:00.000Z",
    updated_at: "2026-09-12T09:42:00.000Z",
    workspace_status: "running",
    workspace_identifier: "preview-neural-networks",
  },
  {
    id: "demo-thesis",
    owner_id: "preview-user",
    name: "Graph Learning for Urban Mobility",
    created_at: "2026-08-21T08:00:00.000Z",
    updated_at: "2026-09-11T14:16:00.000Z",
    workspace_status: "stopped",
    workspace_identifier: "preview-graph-learning",
  },
  {
    id: "demo-survey",
    owner_id: "preview-user",
    name: "Reliable AI Systems — Literature Survey",
    created_at: "2026-09-01T02:30:00.000Z",
    updated_at: "2026-09-10T04:28:00.000Z",
    workspace_status: "running",
    workspace_identifier: "preview-reliable-ai",
  },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function statusLabel(status: string): string {
  if (status === "running") return "Ready";
  if (status === "starting") return "Starting";
  if (status === "stopped") return "Stopped";
  return status.replaceAll("_", " ");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function ProjectsPage() {
  const router = useRouter();
  const auth = useAuth();
  const [projects, setProjects] = useState<Project[]>(IS_LOCAL_PREVIEW ? previewProjects : []);
  const [name, setName] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<AcademicTemplate>(academicTemplates[0]!);
  const [createPath, setCreatePath] = useState<CreatePath>("ai");
  const [sidebarView, setSidebarView] = useState<SidebarView>("projects");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [favorites, setFavorites] = useState<Set<string>>(new Set(["demo"]));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [docClass, setDocClass] = useState("article");
  const [loading, setLoading] = useState(!IS_LOCAL_PREVIEW);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const savedFavorites = window.localStorage.getItem("easy-latex-favorites");
      if (savedFavorites) setFavorites(new Set(JSON.parse(savedFavorites)));
      const savedView = window.localStorage.getItem("easy-latex-view-mode");
      if (savedView === "list" || savedView === "grid") setViewMode(savedView);
    } catch {
      // Storage access may be restricted; fallback to default
    }
  }, []);

  function toggleFavorite(projectId: string, event?: MouseEvent) {
    event?.stopPropagation();
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      try {
        window.localStorage.setItem("easy-latex-favorites", JSON.stringify(Array.from(next)));
      } catch {
        // Ignored
      }
      return next;
    });
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem("easy-latex-view-mode", mode);
    } catch {
      // Ignored
    }
  }

  const loadProjects = useCallback(async () => {
    if (!auth.user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setError(null);
      setProjects(await getProjects());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    if (IS_LOCAL_PREVIEW && !auth.user) {
      setLoading(false);
      return;
    }
    if (!auth.loading && !auth.user) {
      router.replace("/login");
      return;
    }
    if (auth.user) void loadProjects();
  }, [auth.loading, auth.user, loadProjects, router]);

  useEffect(() => {
    if (createOpen) projectNameRef.current?.focus();
  }, [createOpen]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return projects.filter((project) => {
      const matchesQuery =
        normalizedQuery.length === 0 || project.name.toLocaleLowerCase().includes(normalizedQuery);
      let matchesFilter = true;
      if (filter === "favorites") {
        matchesFilter = favorites.has(project.id);
      } else if (filter === "mine") {
        matchesFilter = !project.owner_id.startsWith("shared-");
      } else if (filter === "shared") {
        matchesFilter = project.owner_id.startsWith("shared-");
      }
      return matchesQuery && matchesFilter;
    });
  }, [favorites, filter, projects, query]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let finalTitle = name.trim();

    if (!finalTitle) {
      if (createPath === "ai" && aiPrompt.trim()) {
        finalTitle = aiPrompt.trim().slice(0, 48);
      } else if (createPath === "template") {
        finalTitle = selectedTemplate.title;
      } else if (createPath === "import") {
        finalTitle = "Imported Document";
      }
    }

    if (!finalTitle) return;

    setCreating(true);
    setError(null);

    const generatedId = `project-${Date.now()}`;
    const initialPrompt = createPath === "ai" && aiPrompt.trim() ? aiPrompt.trim() : "";

    if (initialPrompt) {
      try {
        window.sessionStorage.setItem(`easy-latex-prompt:${generatedId}`, initialPrompt);
      } catch {
        // Ignored
      }
    }

    if (IS_LOCAL_PREVIEW && !auth.user) {
      const now = new Date().toISOString();
      const newProj: Project = {
        id: generatedId,
        owner_id: "preview-user",
        name: finalTitle,
        created_at: now,
        updated_at: now,
        workspace_status: "running",
        workspace_identifier: `preview-${Date.now()}`,
      };
      setProjects((current) => [newProj, ...current]);
      try {
        window.sessionStorage.setItem(`easy-latex-project:${generatedId}`, finalTitle);
      } catch {
        // Ignored
      }
      setName("");
      setAiPrompt("");
      setCreateOpen(false);
      setCreating(false);
      router.push(`/projects/${generatedId}`);
      return;
    }

    try {
      const created = await createProject(finalTitle);
      setName("");
      setAiPrompt("");
      setCreateOpen(false);
      await loadProjects();
      router.push(`/projects/${created.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  function handleOpen(project: Project) {
    setOpeningId(project.id);
    setError(null);
    if (IS_LOCAL_PREVIEW) window.sessionStorage.setItem(`easy-latex-project:${project.id}`, project.name);
    router.push(`/projects/${project.id}`);
  }

  function handleCreateFromTemplate(template: AcademicTemplate) {
    setSelectedTemplate(template);
    setName(template.title);
    setCreatePath("template");
    setDocClass(template.docClass);
    setCreateOpen(true);
  }

  async function handleDelete(project: Project) {
    setDeletingId(project.id);
    setError(null);
    if (IS_LOCAL_PREVIEW && !auth.user) {
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setDeletingId(null);
      return;
    }
    try {
      await deleteProject(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeletingId(null);
    }
  }

  function openCreateForm() {
    setCreateOpen(true);
    setSidebarOpen(false);
  }

  function showProjects(nextFilter: ProjectFilter = "all") {
    setSidebarView("projects");
    setFilter(nextFilter);
    setSidebarOpen(false);
    document.getElementById("workspace-content")?.scrollIntoView({ behavior: "smooth" });
  }

  function showTemplates() {
    setSidebarView("templates");
    setSidebarOpen(false);
    document.getElementById("workspace-content")?.scrollIntoView({ behavior: "smooth" });
  }

  const userName = auth.user?.displayName || auth.user?.email?.split("@")[0] || (IS_LOCAL_PREVIEW ? "Dinh Viet Huy" : "Account");
  const userInitials = initials(userName) || "U";

  if (!IS_LOCAL_PREVIEW && (auth.loading || !auth.user)) {
    return (
      <main className="auth-loading" aria-busy="true">
        <LoaderCircle className="spinner" aria-hidden="true" />
        <span>Opening your workspace…</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>

      {sidebarOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        />
      ) : null}

      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`} aria-label="Product navigation">
        <div className="sidebar-brand-row">
          <a className="brand" href="/projects" aria-label="Easy LaTeX projects">
            <span className="brand-mark" aria-hidden="true">
              TeX
            </span>
            <span>Easy LaTeX</span>
          </a>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            title="Close navigation"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="workspace-identity">
          <span className="workspace-avatar" aria-hidden="true">
            {userInitials}
          </span>
          <span>
            <strong>{userName}</strong>
            <small>Personal workspace</small>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace">
          <p className="nav-label">Workspace</p>
          <button
            className={`nav-item${sidebarView === "projects" && filter !== "favorites" ? " nav-item-selected" : ""}`}
            type="button"
            onClick={() => showProjects("all")}
            aria-current={sidebarView === "projects" && filter !== "favorites" ? "page" : undefined}
          >
            <FileText aria-hidden="true" />
            <span>Projects</span>
            <span className="nav-count">{projects.length}</span>
          </button>
          <button
            className={`nav-item${sidebarView === "projects" && filter === "favorites" ? " nav-item-selected" : ""}`}
            type="button"
            onClick={() => showProjects("favorites")}
            aria-current={sidebarView === "projects" && filter === "favorites" ? "page" : undefined}
          >
            <Star aria-hidden="true" />
            <span>Starred</span>
            <span className="nav-count">{favorites.size}</span>
          </button>
          <button
            className={`nav-item${sidebarView === "templates" ? " nav-item-selected" : ""}`}
            type="button"
            onClick={showTemplates}
            aria-current={sidebarView === "templates" ? "page" : undefined}
          >
            <GraduationCap aria-hidden="true" />
            <span>Templates</span>
            <span className="nav-count">{academicTemplates.length}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <Check aria-hidden="true" />
          <span>
            <strong>Private workspace</strong>
            <small>Only your projects are shown</small>
          </span>
        </div>
      </aside>

      <div className="app-frame">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button menu-button"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              title="Open navigation"
            >
              <Menu aria-hidden="true" />
            </button>
            <span className="breadcrumb-muted">Personal workspace</span>
            <ChevronRight className="breadcrumb-separator" aria-hidden="true" />
            <span>{sidebarView === "templates" ? "Templates" : "Projects"}</span>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              type="button"
              onClick={openCreateForm}
              aria-label="New project"
            >
              <Plus aria-hidden="true" />
              <span>New</span>
              <kbd>C</kbd>
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="account-button" type="button" aria-label={`Open account menu for ${userName}`}>
                  <span className="user-avatar" aria-hidden="true">{userInitials}</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dropdown-content account-menu" align="end" sideOffset={4}>
                  <DropdownMenu.Label className="account-menu-header">
                    <strong>{userName}</strong>
                    <span>{auth.user?.email || "Preview workspace"}</span>
                  </DropdownMenu.Label>
                  <DropdownMenu.Separator className="dropdown-separator" />
                  <DropdownMenu.Item
                    className="dropdown-item"
                    onSelect={() => {
                      void auth.signOut().then(() => router.replace("/login"));
                    }}
                  >
                    <LogOut aria-hidden="true" />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <main className="page" id="workspace-content">
          <section className="page-header" aria-labelledby="workspace-heading">
            <div>
              <h1 id="workspace-heading">{sidebarView === "templates" ? "Templates" : "Projects"}</h1>
              <p>
                {sidebarView === "templates"
                  ? "Choose an academic structure to start a new LaTeX document."
                  : "Continue writing or start a new document with LaTeX precision."}
              </p>
            </div>
            {sidebarView === "projects" ? (
              <button
                className="button button-primary"
                type="button"
                onClick={openCreateForm}
                aria-expanded={createOpen}
              >
                <Plus aria-hidden="true" />
                New project
              </button>
            ) : null}
          </section>

          {sidebarView === "templates" ? (
          <section className="template-section" aria-labelledby="templates-heading">
            <div className="template-section-header">
              <h2 id="templates-heading">Academic templates</h2>
              <span className="project-meta">{academicTemplates.length} verified structures</span>
            </div>
            <div className="template-strip">
              {academicTemplates.map((template) => (
                <button
                  key={template.id}
                  className="template-card"
                  type="button"
                  onClick={() => handleCreateFromTemplate(template)}
                  aria-label={`Use template: ${template.title}`}
                >
                  <div className="template-thumbnail" aria-hidden="true">
                    <div className="template-thumbnail-header" />
                    <div className="template-thumbnail-line" />
                    <div className="template-thumbnail-line template-thumbnail-line-short" />
                    {template.twoColumn ? (
                      <div className="template-thumbnail-columns">
                        <div>
                          <div className="template-thumbnail-line" style={{ marginTop: 4 }} />
                          <div className="template-thumbnail-line" />
                          <div className="template-thumbnail-line" />
                        </div>
                        <div>
                          <div className="template-thumbnail-line" style={{ marginTop: 4 }} />
                          <div className="template-thumbnail-line" />
                          <div className="template-thumbnail-line template-thumbnail-line-short" />
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 4 }}>
                        <div className="template-thumbnail-line" />
                        <div className="template-thumbnail-line" />
                        <div className="template-thumbnail-line template-thumbnail-line-short" />
                      </div>
                    )}
                  </div>
                  <strong className="template-title">{template.title}</strong>
                  <span className="template-category">{template.category}</span>
                </button>
              ))}
            </div>
          </section>
          ) : null}

          {sidebarView === "projects" && error ? (
            <div className="alert" role="alert">
              <AlertCircle aria-hidden="true" />
              <span>
                <strong>Projects could not be updated.</strong>
                {error}
              </span>
              <button className="button button-secondary" type="button" onClick={() => void loadProjects()}>
                <RefreshCw aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : null}

          {sidebarView === "projects" ? (
          <section className="project-section" aria-labelledby="continue-heading">
            <div className="section-heading">
              <div>
                <h2 id="continue-heading">Continue writing</h2>
                <p className="project-count" aria-live="polite">
                  {visibleProjects.length} of {projects.length} {projects.length === 1 ? "document" : "documents"}
                </p>
              </div>
              <div className="project-tools">
                <label className="search-field">
                  <span className="sr-only">Search projects</span>
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search documents…"
                  />
                  {query ? (
                    <button type="button" onClick={() => setQuery("")} aria-label="Clear project search">
                      <X aria-hidden="true" />
                    </button>
                  ) : null}
                </label>

                {/* Canonical Filter Tabs (DESIGN.md Section 9.1) */}
                <div className="filter-tabs" aria-label="Filter projects">
                  <button
                    type="button"
                    className={filter === "all" ? "filter-active" : undefined}
                    onClick={() => setFilter("all")}
                    aria-pressed={filter === "all"}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={filter === "mine" ? "filter-active" : undefined}
                    onClick={() => setFilter("mine")}
                    aria-pressed={filter === "mine"}
                  >
                    Mine
                  </button>
                  <button
                    type="button"
                    className={filter === "shared" ? "filter-active" : undefined}
                    onClick={() => setFilter("shared")}
                    aria-pressed={filter === "shared"}
                  >
                    Shared
                  </button>
                  <button
                    type="button"
                    className={filter === "favorites" ? "filter-active" : undefined}
                    onClick={() => setFilter("favorites")}
                    aria-pressed={filter === "favorites"}
                  >
                    Favorites
                  </button>
                </div>

                {/* View Switcher: List vs Grid */}
                <div className="view-mode-toggle" role="group" aria-label="Display style">
                  <button
                    className={`view-mode-btn${viewMode === "list" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleViewModeChange("list")}
                    aria-label="List view"
                    title="List view"
                  >
                    <LayoutList aria-hidden="true" />
                  </button>
                  <button
                    className={`view-mode-btn${viewMode === "grid" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleViewModeChange("grid")}
                    aria-label="Grid view"
                    title="Grid view"
                  >
                    <LayoutGrid aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div className="project-list-frame" aria-busy={loading}>
              {loading ? (
                <div className="loading-state" role="status">
                  <span className="sr-only">Loading projects…</span>
                  {[0, 1, 2].map((item) => (
                    <div className="skeleton-row" key={item} aria-hidden="true">
                      <span className="skeleton-icon" />
                      <span className="skeleton-lines">
                        <span />
                        <span />
                      </span>
                      <span className="skeleton-meta" />
                      <span className="skeleton-meta" />
                    </div>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <div className="empty-state">
                  <FilePlus2 aria-hidden="true" />
                  <h3>Create your first project</h3>
                  <p>Describe your paper to AI or start from an academic template.</p>
                  <button className="button button-primary" type="button" onClick={openCreateForm}>
                    <Plus aria-hidden="true" />
                    New project
                  </button>
                </div>
              ) : visibleProjects.length === 0 ? (
                <div className="empty-state">
                  <Search aria-hidden="true" />
                  <h3>{query ? `No results for “${query}”` : "No projects found in this filter"}</h3>
                  <p>{query ? "Try another search term or reset filters." : "Choose 'All' to view all active documents."}</p>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              ) : viewMode === "grid" ? (
                /* Grid View (DESIGN.md Section 9.1) */
                <ul className="project-grid">
                  {visibleProjects.map((project) => {
                    const isOpening = openingId === project.id;
                    const isDeleting = deletingId === project.id;
                    const isFavorite = favorites.has(project.id);
                    return (
                      <li
                        key={project.id}
                        className="project-grid-card"
                        onClick={() => void handleOpen(project)}
                      >
                        <div className="project-grid-header">
                          <span className="document-icon" aria-hidden="true">
                            <FileText />
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <button
                              className={`favorite-star-btn${isFavorite ? " is-favorite" : ""}`}
                              type="button"
                              onClick={(e) => toggleFavorite(project.id, e)}
                              aria-label={isFavorite ? "Unstar project" : "Star project"}
                              title={isFavorite ? "Starred" : "Star"}
                            >
                              <Star aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} />
                            </button>
                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  className="icon-button"
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  disabled={isOpening || isDeleting}
                                  aria-label={`Options for ${project.name}`}
                                >
                                  <MoreHorizontal aria-hidden="true" />
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={4}>
                                  <DropdownMenu.Item
                                    className="dropdown-item"
                                    onSelect={() => void handleOpen(project)}
                                  >
                                    <FolderOpen aria-hidden="true" />
                                    Open document
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    className="dropdown-item"
                                    onSelect={() => toggleFavorite(project.id)}
                                  >
                                    <Star aria-hidden="true" />
                                    {isFavorite ? "Remove from starred" : "Add to starred"}
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Separator className="dropdown-separator" />
                                  <DropdownMenu.Item
                                    className="dropdown-item dropdown-item-danger"
                                    onSelect={() => setDeleteTarget(project)}
                                  >
                                    <Trash2 aria-hidden="true" />
                                    Delete project
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          </div>
                        </div>

                        <h3 className="project-grid-title">{project.name}</h3>
                        <p className="project-meta" style={{ margin: "4px 0 16px" }}>
                          Academic document
                        </p>

                        <div className="project-grid-meta">
                          <time dateTime={project.updated_at} suppressHydrationWarning>
                            {formatDate(project.updated_at)}
                          </time>
                          <span className={`status status-${project.workspace_status}`}>
                            {project.workspace_status === "running" ? <Check aria-hidden="true" /> : null}
                            {project.workspace_status === "starting" ? (
                              <LoaderCircle className="spinner" aria-hidden="true" />
                            ) : null}
                            {!["running", "starting"].includes(project.workspace_status) ? (
                              <span className="status-dot" aria-hidden="true" />
                            ) : null}
                            {statusLabel(project.workspace_status)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                /* List View (DESIGN.md Section 9.1: Entire row is clickable) */
                <>
                  <div className="table-heading" aria-hidden="true">
                    <span>Project</span>
                    <span>Last edited</span>
                    <span>Status</span>
                    <span>Actions</span>
                  </div>
                  <ul className="project-list">
                    {visibleProjects.map((project) => {
                      const isOpening = openingId === project.id;
                      const isDeleting = deletingId === project.id;
                      const isFavorite = favorites.has(project.id);
                      return (
                        <li
                          className="project-row project-row-clickable"
                          key={project.id}
                          onClick={() => void handleOpen(project)}
                        >
                          <div className="project-name-cell">
                            <button
                              className={`favorite-star-btn${isFavorite ? " is-favorite" : ""}`}
                              type="button"
                              onClick={(e) => toggleFavorite(project.id, e)}
                              aria-label={isFavorite ? "Unstar project" : "Star project"}
                              title={isFavorite ? "Starred" : "Star"}
                            >
                              <Star aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} />
                            </button>
                            <span className="document-icon" aria-hidden="true">
                              <FileText />
                            </span>
                            <div>
                              <span className="project-title">
                                {project.name}
                              </span>
                              <span className="project-meta">Academic document</span>
                            </div>
                          </div>
                          <time dateTime={project.updated_at} suppressHydrationWarning>
                            {formatDate(project.updated_at)}
                          </time>
                          <span className={`status status-${project.workspace_status}`}>
                            {project.workspace_status === "running" ? <Check aria-hidden="true" /> : null}
                            {project.workspace_status === "starting" ? (
                              <LoaderCircle className="spinner" aria-hidden="true" />
                            ) : null}
                            {!["running", "starting"].includes(project.workspace_status) ? (
                              <span className="status-dot" aria-hidden="true" />
                            ) : null}
                            {statusLabel(project.workspace_status)}
                          </span>
                          <div className="actions" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  className="icon-button"
                                  type="button"
                                  disabled={isOpening || isDeleting}
                                  aria-label={`More actions for ${project.name}`}
                                  title="More actions"
                                >
                                  {isDeleting ? (
                                    <LoaderCircle className="spinner" aria-hidden="true" />
                                  ) : (
                                    <MoreHorizontal aria-hidden="true" />
                                  )}
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={4}>
                                  <DropdownMenu.Item
                                    className="dropdown-item"
                                    onSelect={() => void handleOpen(project)}
                                  >
                                    <FolderOpen aria-hidden="true" />
                                    Open document
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    className="dropdown-item"
                                    onSelect={() => toggleFavorite(project.id)}
                                  >
                                    <Star aria-hidden="true" />
                                    {isFavorite ? "Remove from starred" : "Add to starred"}
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Separator className="dropdown-separator" />
                                  <DropdownMenu.Item
                                    className="dropdown-item dropdown-item-danger"
                                    onSelect={() => setDeleteTarget(project)}
                                  >
                                    <Trash2 aria-hidden="true" />
                                    Delete project
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </section>
          ) : null}
        </main>
      </div>

      {/* Multi-Path Project Creation Dialog (DESIGN.md Section 8.3) */}
      {createOpen ? (
        <div className="create-modal-overlay" onClick={() => !creating && setCreateOpen(false)}>
          <div
            className="create-modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-dialog-title"
          >
            <div className="create-modal-header">
              <h2 id="create-dialog-title">Create a new document</h2>
              <p>Choose an intent path to start your LaTeX writing workspace.</p>
            </div>

            {/* Three peer paths */}
            <div className="create-path-tabs" role="tablist">
              <button
                className={`create-path-tab${createPath === "ai" ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={createPath === "ai"}
                onClick={() => setCreatePath("ai")}
              >
                <Sparkles aria-hidden="true" />
                Describe to AI
              </button>
              <button
                className={`create-path-tab${createPath === "template" ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={createPath === "template"}
                onClick={() => setCreatePath("template")}
              >
                <BookOpen aria-hidden="true" />
                Use a Template
              </button>
              <button
                className={`create-path-tab${createPath === "import" ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={createPath === "import"}
                onClick={() => setCreatePath("import")}
              >
                <FileUp aria-hidden="true" />
                Import Work
              </button>
            </div>

            <form onSubmit={handleCreate}>
              {createPath === "ai" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <div className="field-group">
                    <label htmlFor="ai-prompt-input">What are you writing?</label>
                    <textarea
                      id="ai-prompt-input"
                      rows={3}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="e.g. A research paper investigating diffusion models for molecular graph generation with PyTorch benchmarks..."
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "14px",
                        borderRadius: "var(--radius-control)",
                        border: "1px solid var(--color-border-default)",
                        resize: "vertical",
                      }}
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="project-name">Working title (optional)</label>
                    <input
                      ref={projectNameRef}
                      id="project-name"
                      type="text"
                      maxLength={128}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Leave blank to infer from description"
                    />
                  </div>
                </div>
              ) : createPath === "template" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <div className="field-group">
                    <label htmlFor="template-select">Select Academic Template</label>
                    <select
                      id="template-select"
                      value={selectedTemplate.id}
                      onChange={(e) => {
                        const found = academicTemplates.find((t) => t.id === e.target.value);
                        if (found) {
                          setSelectedTemplate(found);
                          setName(found.title);
                          setDocClass(found.docClass);
                        }
                      }}
                      style={{
                        width: "100%",
                        height: "36px",
                        padding: "0 10px",
                        borderRadius: "var(--radius-control)",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-bg-surface)",
                      }}
                    >
                      {academicTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title} ({t.category})
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="project-meta">{selectedTemplate.description}</p>
                  <div className="field-group">
                    <label htmlFor="project-name">Document title</label>
                    <input
                      ref={projectNameRef}
                      id="project-name"
                      type="text"
                      maxLength={128}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={selectedTemplate.title}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <div className="import-dropzone" onClick={() => projectNameRef.current?.focus()}>
                    <UploadCloud aria-hidden="true" />
                    <p style={{ margin: "0 0 4px", fontWeight: 500 }}>
                      Drop .tex, .zip, or .bib file here
                    </p>
                    <span className="project-meta">Supports standard Overleaf archives and BibTeX</span>
                  </div>
                  <div className="field-group">
                    <label htmlFor="project-name">Project name</label>
                    <input
                      ref={projectNameRef}
                      id="project-name"
                      type="text"
                      maxLength={128}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My Imported Paper"
                    />
                  </div>
                </div>
              )}

              {/* Collapsible Advanced Options (DESIGN.md Section 8.3) */}
              <div className="advanced-options-section">
                <button
                  type="button"
                  className="advanced-options-trigger"
                  onClick={() => setShowAdvanced((v) => !v)}
                  aria-expanded={showAdvanced}
                >
                  <ChevronDown
                    aria-hidden="true"
                    style={{ transform: showAdvanced ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
                  />
                  <span>Advanced options</span>
                </button>
                {showAdvanced ? (
                  <div style={{ marginTop: "var(--space-3)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                    <div className="field-group">
                      <label htmlFor="doc-class-select">Document Class</label>
                      <input
                        id="doc-class-select"
                        type="text"
                        value={docClass}
                        onChange={(e) => setDocClass(e.target.value)}
                        placeholder="article"
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="tex-engine-select">TeX Engine</label>
                      <select
                        id="tex-engine-select"
                        defaultValue="pdflatex"
                        style={{
                          height: "32px",
                          padding: "0 8px",
                          borderRadius: "var(--radius-control)",
                          border: "1px solid var(--color-border-default)",
                          background: "var(--color-bg-surface)",
                        }}
                      >
                        <option value="pdflatex">pdfLaTeX (Fastest)</option>
                        <option value="xelatex">XeLaTeX (Full Unicode)</option>
                        <option value="lualatex">LuaLaTeX</option>
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="create-actions" style={{ marginTop: "var(--space-5)" }}>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={creating || (!name.trim() && !aiPrompt.trim() && createPath === "ai")}
                  aria-busy={creating}
                >
                  {creating ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                  {creating ? "Creating workspace…" : "Create project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog-content">
            <AlertDialog.Title>Delete “{deleteTarget?.name}”?</AlertDialog.Title>
            <AlertDialog.Description>
              This permanently removes the project and all of its files. This action cannot be undone.
            </AlertDialog.Description>
            <div className="dialog-actions">
              <AlertDialog.Cancel asChild>
                <button className="button button-secondary" type="button">
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="button button-destructive"
                  type="button"
                  onClick={() => {
                    if (deleteTarget) void handleDelete(deleteTarget);
                  }}
                >
                  Delete project
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
