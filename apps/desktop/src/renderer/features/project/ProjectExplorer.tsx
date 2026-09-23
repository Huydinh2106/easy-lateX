import { ChevronDown, FileCode2, FileText, Folder, FolderOpen, Star } from "lucide-react";
import { useMemo, useState } from "react";
import type { FileEntry } from "@easy-latex/shared-types";

interface ProjectExplorerProps {
  files: FileEntry[];
  selectedPath?: string | undefined;
  rootDocument?: string | undefined;
  onOpen(path: string): void;
}

function depth(value: string): number {
  return value.split("/").length - 1;
}

function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.kind === "directory") return <Folder aria-hidden="true" />;
  return entry.path.toLowerCase().endsWith(".tex") ? <FileCode2 aria-hidden="true" /> : <FileText aria-hidden="true" />;
}

export function ProjectExplorer({ files, selectedPath, rootDocument, onOpen }: ProjectExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(files.filter((file) => file.kind === "directory" && depth(file.path) === 0).map((file) => file.path)));
  const visibleFiles = useMemo(() => files.filter((entry) => {
    if (!entry.parentPath) return true;
    const parts = entry.parentPath.split("/");
    return parts.every((_part, index) => expanded.has(parts.slice(0, index + 1).join("/")));
  }), [expanded, files]);

  function activate(entry: FileEntry): void {
    if (entry.kind === "directory") {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      return;
    }
    onOpen(entry.path);
  }

  return (
    <aside className="project-explorer" aria-label="Project files">
      <header className="panel-heading"><span>Project</span><small>{files.filter((file) => file.kind === "file").length} files</small></header>
      <nav className="file-tree" role="tree" aria-label="LaTeX project files">
        {visibleFiles.length === 0 ? <p className="panel-empty">This folder is empty.</p> : visibleFiles.map((entry) => {
          const open = entry.kind === "directory" && expanded.has(entry.path);
          return (
            <button
              key={entry.path}
              className={`file-row${selectedPath === entry.path ? " file-row-selected" : ""}`}
              type="button"
              role="treeitem"
              aria-selected={selectedPath === entry.path}
              aria-expanded={entry.kind === "directory" ? open : undefined}
              style={{ paddingLeft: `${8 + depth(entry.path) * 14}px` }}
              onClick={() => activate(entry)}
              title={entry.path}
            >
              {entry.kind === "directory" ? <ChevronDown className={open ? "" : "tree-chevron-collapsed"} aria-hidden="true" /> : <span className="tree-spacer" />}
              {entry.kind === "directory" && open ? <FolderOpen aria-hidden="true" /> : <FileIcon entry={entry} />}
              <span className="file-name">{entry.name}</span>
              {rootDocument === entry.path ? <Star className="root-star" aria-label="Root document" /> : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
