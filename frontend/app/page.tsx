"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  createProject,
  deleteProject,
  getProjects,
  openProject,
  type Project,
} from "@/lib/api";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      setError(null);
      setProjects(await getProjects());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setCreating(true);
    setError(null);
    try {
      await createProject(trimmedName);
      setName("");
      await loadProjects();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function handleOpen(project: Project) {
    setOpeningId(project.id);
    setError(null);
    try {
      const workspace = await openProject(project.id);
      if (!workspace.workspace_url) throw new Error("The editor did not return a URL");
      window.location.assign(workspace.workspace_url);
    } catch (caught) {
      setError(errorMessage(caught));
      setOpeningId(null);
    }
  }

  async function handleDelete(project: Project) {
    if (!window.confirm(`Delete “${project.name}” and all of its files? This cannot be undone.`)) {
      return;
    }

    setDeletingId(project.id);
    setError(null);
    try {
      await deleteProject(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Easy LaTeX projects">
          <span className="brand-mark" aria-hidden="true">
            TeX
          </span>
          <span>Easy LaTeX</span>
        </a>
        <span className="local-label">Local workspace</span>
      </header>

      <section className="workspace" aria-labelledby="projects-heading">
        <div className="title-row">
          <div>
            <p className="eyebrow">Project library</p>
            <h1 id="projects-heading">My Projects</h1>
          </div>
          <p className="project-count" aria-live="polite">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </p>
        </div>

        <form className="create-form" onSubmit={handleCreate}>
          <div className="field-group">
            <label htmlFor="project-name">New project</label>
            <input
              id="project-name"
              name="project-name"
              type="text"
              maxLength={128}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Machine Learning Paper"
              autoComplete="off"
              disabled={creating}
            />
          </div>
          <button className="button button-primary" type="submit" disabled={creating || !name.trim()}>
            <span aria-hidden="true">+</span>
            {creating ? "Creating…" : "New Project"}
          </button>
        </form>

        {error ? (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadProjects()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="project-panel" aria-busy={loading}>
          <div className="table-heading" aria-hidden="true">
            <span>Project</span>
            <span>Created</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {loading ? (
            <div className="state-message">
              <span className="spinner" aria-hidden="true" />
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <span className="empty-symbol" aria-hidden="true">
                ∅
              </span>
              <h2>No projects yet</h2>
              <p>Name your first document above. Its LaTeX files and Git repository are created for you.</p>
            </div>
          ) : (
            <ul className="project-list">
              {projects.map((project) => {
                const isOpening = openingId === project.id;
                const isDeleting = deletingId === project.id;
                return (
                  <li className="project-row" key={project.id}>
                    <div className="project-name-cell">
                      <span className="file-icon" aria-hidden="true">
                        .tex
                      </span>
                      <div>
                        <h2>{project.name}</h2>
                        <span className="project-id">{project.id.slice(0, 8)}</span>
                      </div>
                    </div>
                    <time dateTime={project.created_at}>{formatDate(project.created_at)}</time>
                    <span className={`status status-${project.workspace_status}`}>
                      <span aria-hidden="true" />
                      {project.workspace_status}
                    </span>
                    <div className="actions">
                      <button
                        className="button button-open"
                        type="button"
                        onClick={() => void handleOpen(project)}
                        disabled={isOpening || isDeleting}
                      >
                        {isOpening ? "Starting workspace…" : "Open Project"}
                      </button>
                      <button
                        className="button button-delete"
                        type="button"
                        onClick={() => void handleDelete(project)}
                        disabled={isOpening || isDeleting}
                        aria-label={`Delete ${project.name}`}
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
