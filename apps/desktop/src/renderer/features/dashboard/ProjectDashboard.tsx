import { LegacyMigrationPanel } from '../account/LegacyMigrationPanel';
import {
  AlertCircle,
  ArrowUpRight,
  ChevronRight,
  ChevronsUpDown,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderInput,
  GraduationCap,
  Grid2X2,
  List,
  LogIn,
  LogOut,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Star,
  User,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, ProjectInvitation, RecentProject, SharedProject, ProjectCollaborationLink } from "@easy-latex/shared-types";

import { projectList, type ProjectCard } from "./projectList";

type ProjectFilter = "all" | "available" | "missing";
type ProjectView = "list" | "grid";

interface ProjectDashboardProps {
  account: Account | null;
  sessionPersistence?: 'secure' | 'memory' | undefined;
  sharedProjects: SharedProject[];
  projectLinks: ProjectCollaborationLink[];
  invitations: ProjectInvitation[];
  busy: boolean;
  onSignIn(): void;
  onSignOut(): void;
  onCollaborate(workspacePath: string): void;
  onOpenShared(projectId: string, invite?: boolean): void;
  onAcceptInvitation(invitation: ProjectInvitation): void;
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
  const [migrationOpen,setMigrationOpen]=useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const allProjects = useMemo(() => projectList(props.recentProjects, props.sharedProjects, props.projectLinks), [props.recentProjects, props.sharedProjects, props.projectLinks]);
  const total = allProjects.length;
  const shortcutLabel = navigator.userAgent.includes("Mac") ? "⌘N" : "Ctrl N";

  const projects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return allProjects.filter((project) => {
      if (filter === "available" && !project.available) return false;
      if (filter === "missing" && project.available) return false;
      return !needle || project.name.toLocaleLowerCase().includes(needle) || project.description.toLocaleLowerCase().includes(needle);
    });
  }, [filter, allProjects, query]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (props.busy) return;
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
  }, [props.onDismissError, props.busy]);

  const openRecent = async (workspacePath: string): Promise<void> => {
    setLastAttempt(workspacePath);
    await props.onOpenRecent(workspacePath);
  };

  const openCard = (project: ProjectCard) => {
    if (project.collaborationId) props.onOpenShared(project.collaborationId);
    else if (project.workspacePath) void openRecent(project.workspacePath);
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
      {migrationOpen?<LegacyMigrationPanel onClose={()=>setMigrationOpen(false)} onMigrated={()=>window.dispatchEvent(new Event("github-migration-completed"))}/>:null}
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="dashboard-brand-mark" aria-hidden="true">TeX</span>
          <strong>Easy LaTeX</strong>
        </div>

        <nav className="dashboard-nav" aria-label="Workspace">
          <span className="dashboard-nav-label">Workspace</span>
          <button className="dashboard-nav-item dashboard-nav-active" type="button">
            <FileText aria-hidden="true" />
            <span>Projects</span>
          </button>
          <button className="dashboard-nav-item" type="button" disabled title="Starred projects are not enabled yet">
            <Star aria-hidden="true" />
            <span>Starred</span>
          </button>
          <button className="dashboard-nav-item" type="button" disabled title="Project templates are not enabled yet">
            <GraduationCap aria-hidden="true" />
            <span>Templates</span>
          </button>
        </nav>

        <div className="dashboard-sidebar-footer" ref={accountMenuRef}>
          {props.account ? (
            <div className="dashboard-account-wrapper">
              {accountMenuOpen ? (
                <div className="dashboard-account-menu" role="menu" aria-label="Account menu">
                  <div className="dashboard-account-menu-header">
                    <span className="dashboard-avatar" aria-hidden="true">
                      {props.account.displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="dashboard-account-menu-meta">
                      <strong>{props.account.displayName}</strong>
                      <small>{props.account.githubLogin ? `@${props.account.githubLogin}` : props.account.email}</small>
                    </div>
                  </div>
                  <div className="dashboard-account-menu-divider" />
                  {props.sessionPersistence==='memory'?<p className="dashboard-session-notice"><LockKeyhole aria-hidden="true"/>Sign in again after closing the app.</p>:null}
                  <button className="dashboard-account-menu-item" type="button" role="menuitem" disabled={props.busy} onClick={()=>{setAccountMenuOpen(false);setMigrationOpen(true);}}><FolderInput aria-hidden="true"/><span>Migrate legacy projects</span></button>
                  <button
                    className="dashboard-account-menu-item dashboard-account-menu-signout"
                    type="button"
                    role="menuitem"
                    disabled={props.busy}
                    onClick={() => {
                      setAccountMenuOpen(false);
                      props.onSignOut();
                    }}
                  >
                    <LogOut aria-hidden="true" />
                    <span>Sign out</span>
                  </button>
                </div>
              ) : null}

              <button
                className="dashboard-account-trigger"
                type="button"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                title="Account menu"
              >
                <span className="dashboard-avatar" aria-hidden="true">
                  {props.account.displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="dashboard-account-name">{props.account.displayName}</span>
                <ChevronsUpDown className="dashboard-account-chevron" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="dashboard-guest-panel">
              <div className="dashboard-account-info">
                <span className="dashboard-avatar dashboard-avatar-guest" aria-hidden="true">
                  <User aria-hidden="true" />
                </span>
                <span className="dashboard-account-name">Local workspace</span>
              </div>
              <button
                className="button button-secondary dashboard-signin-btn"
                type="button"
                disabled={props.busy}
                onClick={props.onSignIn}
              >
                <LogIn aria-hidden="true" />
                <span>Sign in to collaborate</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="dashboard-stage">
        <header className="dashboard-topbar">
          <div className="dashboard-breadcrumb">
            <span>Your workspace</span>
            <ChevronRight aria-hidden="true" />
            <strong>Projects</strong>
          </div>
        </header>

        <main className="dashboard-main">
          <header className="dashboard-page-heading">
            <h1>Projects</h1>
            <div className="dashboard-heading-actions">
              <button className="button button-secondary dashboard-new-project" type="button" disabled={props.busy} onClick={() => void props.onOpenProject()}>
                <FolderOpen aria-hidden="true" />
                <span>Open project</span>
              </button>
              <button className="button button-primary dashboard-new-project" type="button" disabled={props.busy} onClick={newProject}>
                <Plus aria-hidden="true" />
                <span>New project</span>
                <kbd className="dashboard-btn-kbd" aria-hidden="true">{shortcutLabel}</kbd>
              </button>
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

          {props.invitations.length ? <section className="dashboard-invitations" aria-label="Project invitations"><h2>Invitations</h2>{props.invitations.map(invitation => <div className="shared-project-row" key={invitation.id}><span>{invitation.projectName} · {invitation.role === "editor" ? "Can edit" : "View only"}</span><button className="button button-secondary" type="button" disabled={props.busy} onClick={() => props.onAcceptInvitation(invitation)}>Accept invitation</button></div>)}</section> : null}

          <section className="dashboard-projects" aria-label="Recent projects">
            <div className="dashboard-projects-toolbar">
              <div className="dashboard-section-title"><strong>Continue writing</strong><span>{projects.length} of {total} projects</span></div>
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
                <button className={view === "list" ? "dashboard-view-active" : ""} type="button" onClick={() => setView("list")} aria-label="List view" aria-pressed={view === 'list'}><List aria-hidden="true" /></button>
                <button className={view === "grid" ? "dashboard-view-active" : ""} type="button" onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === 'grid'}><Grid2X2 aria-hidden="true" /></button>
              </div>
            </div>

            <div className={`dashboard-project-list dashboard-project-list-${view}`}>
              {projects.length > 0 ? projects.map((project) => (
                <article className={"dashboard-project-card dashboard-project-unified"} key={project.key}>
                  <button className="dashboard-project-open" type="button" disabled={props.busy} onClick={() => openCard(project)} title={project.description}>
                    <span className="dashboard-project-icon">{<FolderOpen aria-hidden="true" />}</span>
                    <span className="dashboard-project-copy"><strong>{project.name}</strong><small>{compactPath(project.description)}</small></span>
                    <span className="visually-hidden">
                      {project.collaborationId ? "Collaboration enabled" : project.available ? "On this device" : "Folder missing"}
                    </span>
                    {!project.available ? (
                      <span className="dashboard-project-missing-badge">Folder missing</span>
                    ) : null}
                    <ArrowUpRight className="dashboard-project-arrow" aria-hidden="true" />
                  </button>
                  <button className="button button-secondary dashboard-collaborate" type="button" disabled={!project.available || props.busy} onClick={() => {if (project.collaborationId) props.onOpenShared(project.collaborationId, true); else if (project.workspacePath) props.onCollaborate(project.workspacePath);}} aria-label={`Collaborate on ${project.name}`}><Users aria-hidden="true" /> Collaborate</button>
                  {!project.collaborationId && project.workspacePath ? <button className="dashboard-project-forget" type="button" disabled={props.busy} onClick={() => {if (project.workspacePath) void props.onForgetRecent(project.workspacePath);}} aria-label={`Remove ${project.name} from recent projects`} title="Remove from recents"><X aria-hidden="true" /></button> : <span className="dashboard-project-spacer" />}
                </article>
              )) : (
                <div className="dashboard-empty">
                  <span className="dashboard-empty-icon"><FilePlus2 aria-hidden="true" /></span>
                  <h2>{query || filter !== "all" ? "No matching projects" : "Create your first project"}</h2>
                  <p>{query || filter !== "all" ? "Try a different search or availability filter." : "Choose or create a folder and start writing."}</p>
                  {!query && filter === "all" ? <div className="dashboard-empty-actions"><button className="button button-primary button-large" type="button" onClick={newProject}><Plus aria-hidden="true" /> New project</button><button className="button button-secondary button-large" type="button" onClick={() => void props.onOpenProject()}><FolderOpen aria-hidden="true" /> Open existing</button></div> : null}
                </div>
              )}
            </div>
          </section>
        </main>
      </section>

      {createOpen ? (
        <div className="dashboard-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setCreateOpen(false); }}>
          <form className="dashboard-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onSubmit={(event) => void createProject(event)}>
            <header className="dashboard-dialog-header">
              <div><h2 id="create-project-title">Create a LaTeX project</h2><p>A starter document will be created on this Mac. You can enable collaboration later.</p></div>
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
