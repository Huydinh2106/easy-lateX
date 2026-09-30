import {
  AlertCircle,
  ArrowUpRight,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  GraduationCap,
  Grid2X2,
  HardDrive,
  List,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Star,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RecentProject } from "@easy-latex/shared-types";

type ProjectFilter = "all" | "available" | "missing";
type ProjectView = "list" | "grid";

interface ProjectDashboardProps {
  recentProjects: RecentProject[];
  projectsDirectory: string;
  error: string | null;
  onCreateProject(name: string): Promise<boolean>;
  onChooseProjectsDirectory(): Promise<string | null>;
  onOpenProject(): Promise<void>;
  onOpenRecent(workspacePath: string): Promise<boolean>;
  onForgetRecent(workspacePath: string): Promise<void>;
  onDismissError(): void;
}

function compactPath(workspacePath: string): string {
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return workspacePath;
  return `…/${parts.slice(-3).join("/")}`;
}

export function ProjectDashboard(props: ProjectDashboardProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [view, setView] = useState<ProjectView>("list");
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const shortcutLabel = navigator.userAgent.includes("Mac") ? "⌘N" : "Ctrl N";

  const projects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return props.recentProjects.filter((project) => {
      if (filter === "available" && !project.available) return false;
      if (filter === "missing" && project.available) return false;
      return !needle || project.name.toLocaleLowerCase().includes(needle) || project.workspacePath.toLocaleLowerCase().includes(needle);
    });
  }, [filter, props.recentProjects, query]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        setLastAttempt(null);
        props.onDismissError();
        setProjectName("");
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [props.onDismissError]);

  const openRecent = async (workspacePath: string): Promise<void> => {
    setLastAttempt(workspacePath);
    await props.onOpenRecent(workspacePath);
  };

  const newProject = (): void => {
    setLastAttempt(null);
    props.onDismissError();
    setProjectName("");
    setCreateOpen(true);
  };

  const createProject = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!projectName.trim() || creating) return;
    setCreating(true);
    const created = await props.onCreateProject(projectName);
    setCreating(false);
    if (created) setCreateOpen(false);
  };

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="dashboard-brand-mark" aria-hidden="true">TeX</span>
          <strong>Easy LaTeX</strong>
        </div>

        <div className="dashboard-profile">
          <span className="dashboard-avatar" aria-hidden="true">EL</span>
          <span><strong>Local workspace</strong><small>On this Mac</small></span>
        </div>

        <nav className="dashboard-nav" aria-label="Workspace">
          <span className="dashboard-nav-label">Workspace</span>
          <button className="dashboard-nav-item dashboard-nav-active" type="button">
            <FileText aria-hidden="true" /><span>Projects</span><small>{props.recentProjects.length}</small>
          </button>
          <button className="dashboard-nav-item" type="button" disabled title="Starred projects are not enabled yet">
            <Star aria-hidden="true" /><span>Starred</span><small>0</small>
          </button>
          <button className="dashboard-nav-item" type="button" disabled title="Project templates are not enabled yet">
            <GraduationCap aria-hidden="true" /><span>Templates</span><small>0</small>
          </button>
        </nav>

        <div className="dashboard-sidebar-footer">
          <LockKeyhole aria-hidden="true" />
          <span><strong>Private workspace</strong><small>Projects stay on this computer</small></span>
        </div>
      </aside>

      <section className="dashboard-stage">
        <header className="dashboard-topbar">
          <div className="dashboard-breadcrumb"><span>Local workspace</span><ChevronRight aria-hidden="true" /><strong>Projects</strong></div>
          <div className="dashboard-topbar-actions">
            <button className="dashboard-quick-new" type="button" onClick={newProject}><Plus aria-hidden="true" /> New <kbd>{shortcutLabel}</kbd></button>
            <span className="dashboard-user-avatar" aria-label="Easy LaTeX local workspace">EL</span>
          </div>
        </header>

        <main className="dashboard-main">
          <header className="dashboard-page-heading">
            <div><h1>Projects</h1><p>Continue writing or open a new LaTeX project from your computer.</p></div>
            <div className="dashboard-heading-actions">
              <button className="button button-secondary dashboard-new-project" type="button" onClick={() => void props.onOpenProject()}><FolderOpen aria-hidden="true" /> Open project</button>
              <button className="button button-primary dashboard-new-project" type="button" onClick={newProject}><Plus aria-hidden="true" /> New project</button>
            </div>
          </header>

          {props.error ? (
            <div className="dashboard-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <span><strong>Project action failed.</strong><small>{props.error}</small></span>
              {lastAttempt ? (
                <button className="button button-secondary" type="button" onClick={() => void openRecent(lastAttempt)}><RefreshCw aria-hidden="true" /> Retry</button>
              ) : (
                <button className="dashboard-dismiss" type="button" onClick={props.onDismissError} aria-label="Dismiss error"><X aria-hidden="true" /></button>
              )}
            </div>
          ) : null}

          <section className="dashboard-projects" aria-label="Recent projects">
            <div className="dashboard-projects-toolbar">
              <div className="dashboard-section-title"><strong>Continue writing</strong><span>{projects.length} of {props.recentProjects.length} projects</span></div>
              <label className="dashboard-search">
                <Search aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" aria-label="Search projects" />
              </label>
              <div className="dashboard-filter" role="tablist" aria-label="Project availability">
                {(["all", "available", "missing"] as const).map((value) => (
                  <button key={value} className={filter === value ? "dashboard-filter-active" : ""} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>
                    {value === "all" ? "All" : value === "available" ? "Available" : "Missing"}
                  </button>
                ))}
              </div>
              <div className="dashboard-view-toggle" aria-label="Project view">
                <button className={view === "list" ? "dashboard-view-active" : ""} type="button" onClick={() => setView("list")} aria-label="List view"><List aria-hidden="true" /></button>
                <button className={view === "grid" ? "dashboard-view-active" : ""} type="button" onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 aria-hidden="true" /></button>
              </div>
            </div>

            <div className={`dashboard-project-list dashboard-project-list-${view}`}>
              {projects.length > 0 ? projects.map((project) => (
                <article className="dashboard-project-card" key={project.workspacePath}>
                  <button className="dashboard-project-open" type="button" onClick={() => void openRecent(project.workspacePath)} title={project.workspacePath}>
                    <span className="dashboard-project-icon"><FolderOpen aria-hidden="true" /></span>
                    <span className="dashboard-project-copy"><strong>{project.name}</strong><small>{compactPath(project.workspacePath)}</small></span>
                    <span className={`dashboard-project-state${project.available ? "" : " dashboard-project-missing"}`}>
                      {project.available ? "Local folder" : "Folder missing"}
                    </span>
                    <ArrowUpRight className="dashboard-project-arrow" aria-hidden="true" />
                  </button>
                  <button className="dashboard-project-forget" type="button" onClick={() => void props.onForgetRecent(project.workspacePath)} aria-label={`Remove ${project.name} from recent projects`} title="Remove from recents"><X aria-hidden="true" /></button>
                </article>
              )) : (
                <div className="dashboard-empty">
                  <span className="dashboard-empty-icon"><FilePlus2 aria-hidden="true" /></span>
                  <h2>{query || filter !== "all" ? "No matching projects" : "Create your first project"}</h2>
                  <p>{query || filter !== "all" ? "Try a different search or availability filter." : "Choose or create a folder and start writing with the isolated Docker compiler."}</p>
                  {!query && filter === "all" ? <div className="dashboard-empty-actions"><button className="button button-primary button-large" type="button" onClick={newProject}><Plus aria-hidden="true" /> New project</button><button className="button button-secondary button-large" type="button" onClick={() => void props.onOpenProject()}><FolderOpen aria-hidden="true" /> Open existing</button></div> : null}
                </div>
              )}
            </div>
          </section>

          <footer className="dashboard-local-note"><HardDrive aria-hidden="true" /> Filesystem-first workspace · no upload required</footer>
        </main>
      </section>

      {createOpen ? (
        <div className="dashboard-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setCreateOpen(false); }}>
          <form className="dashboard-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onSubmit={(event) => void createProject(event)}>
            <header className="dashboard-dialog-header">
              <div><h2 id="create-project-title">Create a LaTeX project</h2><p>A starter document will be created on this Mac.</p></div>
              <button type="button" onClick={() => setCreateOpen(false)} disabled={creating} aria-label="Close"><X aria-hidden="true" /></button>
            </header>
            <label className="dashboard-dialog-field">
              <span>Project name</span>
              <input autoFocus value={projectName} onChange={(event) => { setProjectName(event.target.value); if (props.error) props.onDismissError(); }} placeholder="My research paper" maxLength={80} />
            </label>
            <div className="dashboard-location-field">
              <span>Save new projects to</span>
              <div><code title={props.projectsDirectory}>{props.projectsDirectory || "Loading default location…"}</code><button className="button button-secondary" type="button" onClick={() => void props.onChooseProjectsDirectory()} disabled={creating}>Change…</button></div>
            </div>
            {props.error ? <p className="dashboard-dialog-error" role="alert"><AlertCircle aria-hidden="true" /> {props.error}</p> : null}
            <footer className="dashboard-dialog-actions">
              <button className="button button-secondary" type="button" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={creating || !projectName.trim() || !props.projectsDirectory}>{creating ? "Creating…" : "Create project"}</button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
