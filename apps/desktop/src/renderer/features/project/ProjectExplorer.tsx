import { Check, ChevronDown, FileCode2, FilePlus2, FileText, FileUp, Folder, FolderOpen, FolderPlus, FolderUp, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@easy-latex/shared-types";

type CreateKind = "file" | "folder";

interface ProjectExplorerProps {
  files: FileEntry[];
  selectedPath?: string | undefined;
  rootDocument?: string | undefined;
  onOpen(path: string): void;
  onCreateFile(path: string): Promise<string | null>;
  onCreateDirectory(path: string): Promise<string | null>;
  onImportFiles(destinationDirectory: string): Promise<string[]>;
  onImportFolder(destinationDirectory: string): Promise<string[]>;
}

function depth(value: string): number {
  return value.split("/").length - 1;
}

function parentPath(value: string): string {
  const separator = value.lastIndexOf("/");
  return separator < 0 ? "" : value.slice(0, separator);
}

function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.kind === "directory") return <Folder aria-hidden="true" />;
  return entry.path.toLowerCase().endsWith(".tex") ? <FileCode2 aria-hidden="true" /> : <FileText aria-hidden="true" />;
}

export function ProjectExplorer(props: ProjectExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(props.files.filter((file) => file.kind === "directory" && depth(file.path) === 0).map((file) => file.path)));
  const [destinationDirectory, setDestinationDirectory] = useState("");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const visibleFiles = useMemo(() => props.files.filter((entry) => {
    if (!entry.parentPath) return true;
    const parts = entry.parentPath.split("/");
    return parts.every((_part, index) => expanded.has(parts.slice(0, index + 1).join("/")));
  }), [expanded, props.files]);

  useEffect(() => {
    if (destinationDirectory && !props.files.some((entry) => entry.kind === "directory" && entry.path === destinationDirectory)) {
      setDestinationDirectory("");
    }
  }, [destinationDirectory, props.files]);

  function expandPath(value: string): void {
    if (!value) return;
    setExpanded((current) => {
      const next = new Set(current);
      const parts = value.split("/");
      for (let index = 0; index < parts.length; index += 1) next.add(parts.slice(0, index + 1).join("/"));
      return next;
    });
  }

  function activate(entry: FileEntry): void {
    if (entry.kind === "directory") {
      setDestinationDirectory(entry.path);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      return;
    }
    setDestinationDirectory(entry.parentPath);
    props.onOpen(entry.path);
  }

  function beginCreate(kind: CreateKind): void {
    setCreateKind(kind);
    setNewName(kind === "file" ? "untitled.tex" : "new-folder");
  }

  async function submitCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    const target = destinationDirectory ? `${destinationDirectory}/${name}` : name;
    setBusy(true);
    const created = createKind === "folder"
      ? await props.onCreateDirectory(target)
      : await props.onCreateFile(target);
    setBusy(false);
    if (!created) return;
    expandPath(createKind === "folder" ? created : parentPath(created));
    if (createKind === "folder") setDestinationDirectory(created);
    setCreateKind(null);
  }

  async function importItems(kind: "files" | "folder"): Promise<void> {
    if (busy) return;
    setBusy(true);
    const imported = kind === "files"
      ? await props.onImportFiles(destinationDirectory)
      : await props.onImportFolder(destinationDirectory);
    setBusy(false);
    if (imported.length > 0) expandPath(destinationDirectory);
  }

  const destinationLabel = destinationDirectory || "Project root";

  return (
    <aside className="project-explorer" aria-label="Project files">
      <header className="explorer-heading">
        <div className="explorer-heading-main">
          <span>Project</span>
          <small>{props.files.filter((file) => file.kind === "file").length} files</small>
          <div className="explorer-actions" aria-label="Project file actions">
            <button type="button" onClick={() => beginCreate("file")} disabled={busy} aria-label="New file" title={`New file in ${destinationLabel}`}><FilePlus2 aria-hidden="true" /></button>
            <button type="button" onClick={() => beginCreate("folder")} disabled={busy} aria-label="New folder" title={`New folder in ${destinationLabel}`}><FolderPlus aria-hidden="true" /></button>
            <button type="button" onClick={() => void importItems("files")} disabled={busy} aria-label="Add files" title={`Add files to ${destinationLabel}`}><FileUp aria-hidden="true" /></button>
            <button type="button" onClick={() => void importItems("folder")} disabled={busy} aria-label="Add folder" title={`Add folder to ${destinationLabel}`}><FolderUp aria-hidden="true" /></button>
          </div>
        </div>
        <button className="explorer-destination" type="button" onClick={() => setDestinationDirectory("")} disabled={!destinationDirectory} title={destinationDirectory ? "Use project root instead" : "New items are added to the project root"}>
          <span>Add to</span><strong>{destinationLabel}</strong>{destinationDirectory ? <X aria-hidden="true" /> : null}
        </button>
      </header>

      {createKind ? (
        <form className="explorer-create-form" onSubmit={(event) => void submitCreate(event)}>
          {createKind === "file" ? <FilePlus2 aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}
          <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onFocus={(event) => event.currentTarget.select()} aria-label={createKind === "file" ? "New file name" : "New folder name"} />
          <button type="submit" disabled={!newName.trim() || busy} aria-label="Create"><Check aria-hidden="true" /></button>
          <button type="button" onClick={() => setCreateKind(null)} disabled={busy} aria-label="Cancel"><X aria-hidden="true" /></button>
        </form>
      ) : null}

      <nav className="file-tree" role="tree" aria-label="LaTeX project files">
        {visibleFiles.length === 0 ? <p className="panel-empty">This folder is empty. Use the actions above to add files.</p> : visibleFiles.map((entry) => {
          const open = entry.kind === "directory" && expanded.has(entry.path);
          const target = entry.kind === "directory" && destinationDirectory === entry.path;
          return (
            <button
              key={entry.path}
              className={`file-row${props.selectedPath === entry.path ? " file-row-selected" : ""}${target ? " file-row-target" : ""}`}
              type="button"
              role="treeitem"
              aria-selected={props.selectedPath === entry.path}
              aria-current={target ? "location" : undefined}
              aria-expanded={entry.kind === "directory" ? open : undefined}
              style={{ paddingLeft: `${8 + depth(entry.path) * 14}px` }}
              onClick={() => activate(entry)}
              title={entry.path}
            >
              {entry.kind === "directory" ? <ChevronDown className={open ? "" : "tree-chevron-collapsed"} aria-hidden="true" /> : <span className="tree-spacer" />}
              {entry.kind === "directory" && open ? <FolderOpen aria-hidden="true" /> : <FileIcon entry={entry} />}
              <span className="file-name">{entry.name}</span>
              {props.rootDocument === entry.path ? <Star className="root-star" aria-label="Root document" /> : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
