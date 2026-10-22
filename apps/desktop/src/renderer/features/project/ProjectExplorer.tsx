import {
  Check,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Pencil,
  Star,
  Trash2,
  X
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { OutlineItem } from "@easy-latex/latex";
import type { FileEntry } from "@easy-latex/shared-types";
import { FileOutline } from "./FileOutline";

type CreateKind = "file" | "folder";

interface ProjectExplorerProps {
  capabilities?: { createFile: boolean; createDirectory: boolean; move: boolean; remove: boolean; import: boolean };
  disabled?: boolean;
  fileNotes?: Record<string, string>;
  files: FileEntry[];
  selectedPath?: string | undefined;
  rootDocument?: string | undefined;
  outlineFilePath?: string | undefined;
  outlineItems: OutlineItem[];
  outlineActiveLine?: number | undefined;
  onOpen(path: string): void;
  onCreateFile(path: string): Promise<string | null>;
  onCreateDirectory(path: string): Promise<string | null>;
  onMove(sourcePath: string, targetPath: string): Promise<string | null>;
  onRemove(path: string): Promise<boolean>;
  onImportFiles(destinationDirectory: string): Promise<string[]>;
  onImportFolder(destinationDirectory: string): Promise<string[]>;
  onImportDropped(files: File[], destinationDirectory: string): Promise<string[]>;
  onSelectOutline(item: OutlineItem): void;
}

interface ContextMenuState {
  entry: FileEntry;
  x: number;
  y: number;
}

interface DropTarget {
  destination: string;
  rowPath?: string;
}

const INTERNAL_DRAG_TYPE = "application/x-easy-latex-project-path";

function depth(value: string): number {
  return value.split("/").length - 1;
}

function parentPath(value: string): string {
  const separator = value.lastIndexOf("/");
  return separator < 0 ? "" : value.slice(0, separator);
}

function itemName(value: string): string {
  const separator = value.lastIndexOf("/");
  return separator < 0 ? value : value.slice(separator + 1);
}

function isSameOrDescendant(value: string, ancestor: string): boolean {
  return value === ancestor || value.startsWith(`${ancestor}/`);
}

function remapDescendantPath(value: string, source: string, target: string): string {
  if (value === source) return target;
  return value.startsWith(`${source}/`) ? `${target}${value.slice(source.length)}` : value;
}

function FileIcon({ entry, open }: { entry: FileEntry; open?: boolean }) {
  if (entry.kind === "directory") {
    return open ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />;
  }
  return entry.path.toLowerCase().endsWith(".tex") ? (
    <FileCode2 aria-hidden="true" />
  ) : (
    <FileText aria-hidden="true" />
  );
}

export function ProjectExplorer(props: ProjectExplorerProps) {
  const permissions = props.capabilities ?? {createFile: true, createDirectory: true, move: true, remove: true, import: true};
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(props.files.filter((file) => file.kind === "directory" && depth(file.path) === 0).map((file) => file.path)));
  const [destinationDirectory, setDestinationDirectory] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [newName, setNewName] = useState("");
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [outlineHeight, setOutlineHeight] = useState(260);
  const explorerRef = useRef<HTMLElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const visibleFiles = useMemo(() => props.files.filter((entry) => {
    if (!entry.parentPath) return true;
    const parts = entry.parentPath.split("/");
    return parts.every((_part, index) => expanded.has(parts.slice(0, index + 1).join("/")));
  }), [expanded, props.files]);

  useEffect(() => {
    if (destinationDirectory && !props.files.some((entry) => entry.kind === "directory" && entry.path === destinationDirectory)) {
      setDestinationDirectory("");
    }
    if (selectedFolder && !props.files.some((entry) => entry.kind === "directory" && entry.path === selectedFolder)) {
      setSelectedFolder(null);
    }
    if (renamePath && !props.files.some((entry) => entry.path === renamePath)) setRenamePath(null);
    if (contextMenu && !props.files.some((entry) => entry.path === contextMenu.entry.path)) setContextMenu(null);
  }, [contextMenu, destinationDirectory, props.files, renamePath, selectedFolder]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event: PointerEvent): void => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [contextMenu]);

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
    if (busy || props.disabled || renamePath) return;
    if (entry.kind === "directory") {
      setDestinationDirectory(entry.path);
      setSelectedFolder(entry.path);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      return;
    }
    setDestinationDirectory(entry.parentPath);
    setSelectedFolder(null);
    props.onOpen(entry.path);
  }

  function beginCreate(kind: CreateKind): void {
    if (props.disabled || !(kind === "file" ? permissions.createFile : permissions.createDirectory)) return;
    setContextMenu(null);
    setRenamePath(null);
    if (destinationDirectory) {
      expandPath(destinationDirectory);
      setSelectedFolder(destinationDirectory);
    }
    setCreateKind(kind);
    setNewName(kind === "file" ? "untitled.tex" : "new-folder");
  }

  async function submitCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy || props.disabled || !(createKind === "folder" ? permissions.createDirectory : permissions.createFile)) return;
    const target = destinationDirectory ? `${destinationDirectory}/${name}` : name;
    setBusy(true);
    const created = createKind === "folder"
      ? await props.onCreateDirectory(target)
      : await props.onCreateFile(target);
    setBusy(false);
    if (!created) return;
    expandPath(createKind === "folder" ? created : parentPath(created));
    if (createKind === "folder") {
      setDestinationDirectory(created);
      setSelectedFolder(created);
    }
    setCreateKind(null);
  }

  async function submitRename(event: React.FormEvent, entry: FileEntry): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const name = renameName.trim();
    if (!name || /[\\/]/.test(name) || busy || props.disabled || !permissions.move) return;
    if (name === entry.name) {
      setRenamePath(null);
      return;
    }
    const target = entry.parentPath ? `${entry.parentPath}/${name}` : name;
    setBusy(true);
    const moved = await props.onMove(entry.path, target);
    setBusy(false);
    if (!moved) return;
    remapExplorerPaths(entry.path, moved);
    setRenamePath(null);
  }

  async function importItems(kind: "files" | "folder"): Promise<void> {
    if (busy || props.disabled || !permissions.import) return;
    setBusy(true);
    const imported = kind === "files"
      ? await props.onImportFiles(destinationDirectory)
      : await props.onImportFolder(destinationDirectory);
    setBusy(false);
    if (imported.length > 0) expandPath(destinationDirectory);
  }

  function remapExplorerPaths(source: string, target: string): void {
    setExpanded((current) => new Set([...current].map((value) => remapDescendantPath(value, source, target))));
    setDestinationDirectory((current) => remapDescendantPath(current, source, target));
    setSelectedFolder((current) => (current ? remapDescendantPath(current, source, target) : null));
  }

  async function moveItem(source: string, destination: string): Promise<void> {
    const target = destination ? `${destination}/${itemName(source)}` : itemName(source);
    if (source === target || busy || props.disabled || !permissions.move) return;
    setBusy(true);
    const moved = await props.onMove(source, target);
    setBusy(false);
    if (!moved) return;
    remapExplorerPaths(source, moved);
    expandPath(destination);
  }

  async function handleDrop(event: React.DragEvent, destination: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (props.disabled || (!permissions.move && !permissions.import)) return;
    const internalSource = event.dataTransfer.getData(INTERNAL_DRAG_TYPE) || dragSource;
    const droppedFiles = Array.from(event.dataTransfer.files);
    setDropTarget(null);
    setDragSource(null);
    if (internalSource) {
      await moveItem(internalSource, destination);
      return;
    }
    if (droppedFiles.length === 0 || busy || !permissions.import) return;
    setBusy(true);
    const imported = await props.onImportDropped(droppedFiles, destination);
    setBusy(false);
    if (imported.length > 0) expandPath(destination);
  }

  function handleDragOver(event: React.DragEvent, destination: string, rowPath?: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (props.disabled || (!permissions.move && !permissions.import)) {event.dataTransfer.dropEffect = "none"; return;}
    event.dataTransfer.dropEffect = dragSource || event.dataTransfer.types.includes(INTERNAL_DRAG_TYPE) ? "move" : "copy";
    setDropTarget((current) => current?.destination === destination && current.rowPath === rowPath ? current : { destination, ...(rowPath ? { rowPath } : {}) });
  }

  async function deleteEntry(entry: FileEntry): Promise<void> {
    if (props.disabled || !permissions.remove) return;
    setContextMenu(null);
    const description = entry.kind === "directory" ? `the folder “${entry.name}” and all of its contents` : `“${entry.name}”`;
    if (!window.confirm(`Delete ${description}? This action cannot be undone.`)) return;
    setBusy(true);
    const removed = await props.onRemove(entry.path);
    setBusy(false);
    if (!removed) return;
    setExpanded((current) => new Set([...current].filter((value) => !isSameOrDescendant(value, entry.path))));
    setDestinationDirectory((current) => isSameOrDescendant(current, entry.path) ? "" : current);
    setSelectedFolder((current) => (current && isSameOrDescendant(current, entry.path) ? null : current));
  }

  const destinationLabel = destinationDirectory || "Project root";

  return (
    <aside ref={explorerRef} className="project-explorer" aria-label="Project files">
      <section className="project-files-panel" aria-label="Project file tree">
        <header className="explorer-heading">
          <div className="explorer-heading-main">
            <span className="explorer-title">Project</span>
            <div className="explorer-actions" aria-label="Project file actions">
              {permissions.createFile ? <button type="button" onClick={() => beginCreate("file")} disabled={busy || props.disabled} aria-label="New file" title={`New file in ${destinationLabel}`}><FilePlus2 aria-hidden="true" /></button> : null}
              {permissions.createDirectory ? <button type="button" onClick={() => beginCreate("folder")} disabled={busy || props.disabled} aria-label="New folder" title={`New folder in ${destinationLabel}`}><FolderPlus aria-hidden="true" /></button> : null}
              {permissions.import ? <><button type="button" onClick={() => void importItems("files")} disabled={busy || props.disabled} aria-label="Add files" title={`Add files to ${destinationLabel}`}><FileUp aria-hidden="true" /></button>
              <button type="button" onClick={() => void importItems("folder")} disabled={busy || props.disabled} aria-label="Add folder" title={`Add folder to ${destinationLabel}`}><FolderUp aria-hidden="true" /></button></> : null}
            </div>
          </div>
        </header>

        <nav
          className={`file-tree${dropTarget && !dropTarget.rowPath ? " file-tree-drop" : ""}`}
          role="tree"
          aria-label="LaTeX project files"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setDestinationDirectory("");
              setSelectedFolder(null);
            }
          }}
          onDragOver={(event) => handleDragOver(event, "")}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
          onDrop={(event) => void handleDrop(event, "")}
        >
          {(() => {
            const createDepth = destinationDirectory ? depth(destinationDirectory) + 1 : 0;
            const targetInVisible = Boolean(destinationDirectory && visibleFiles.some((entry) => entry.kind === "directory" && entry.path === destinationDirectory));

            const renderCreateForm = () => {
              if (!createKind) return null;
              return (
                <form
                  key="__create_form__"
                  className="file-row file-create-row"
                  style={{ paddingLeft: `${8 + createDepth * 14}px` }}
                  onSubmit={(event) => void submitCreate(event)}
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="tree-spacer" aria-hidden="true" />
                  {createKind === "file" ? (
                    <FilePlus2 className="file-create-icon" aria-hidden="true" />
                  ) : (
                    <FolderPlus className="file-create-icon" aria-hidden="true" />
                  )}
                  <input
                    autoFocus
                    className="file-create-input"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setCreateKind(null);
                    }}
                    aria-label={createKind === "file" ? "New file name" : "New folder name"}
                  />
                  <div className="file-create-actions">
                    <button type="submit" disabled={!newName.trim() || busy} aria-label="Create">
                      <Check aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setCreateKind(null)} disabled={busy} aria-label="Cancel">
                      <X aria-hidden="true" />
                    </button>
                  </div>
                </form>
              );
            };

            if (visibleFiles.length === 0) {
              return createKind ? renderCreateForm() : <p className="panel-empty">Drop files or folders here, or use the actions above.</p>;
            }

            return (
              <>
                {(!destinationDirectory || !targetInVisible) ? renderCreateForm() : null}
                {visibleFiles.map((entry) => {
                  const open = entry.kind === "directory" && expanded.has(entry.path);
                  const target = entry.kind === "directory" && selectedFolder === entry.path;
                  const dropDestination = entry.kind === "directory" ? entry.path : entry.parentPath;
                  const isDropTarget = dropTarget?.rowPath === entry.path;
                  const renaming = renamePath === entry.path;
                  const isTargetDir = entry.kind === "directory" && destinationDirectory === entry.path;

                  return (
                    <Fragment key={entry.path}>
                      <div
                        className={`file-row${props.selectedPath === entry.path ? " file-row-selected" : ""}${target ? " file-row-target" : ""}${isDropTarget ? " file-row-drop" : ""}${dragSource === entry.path ? " file-row-dragging" : ""}`}
                        role="treeitem"
                        tabIndex={0}
                        aria-selected={props.selectedPath === entry.path || target}
                        aria-current={target ? "location" : undefined}
                        aria-expanded={entry.kind === "directory" ? open : undefined}
                        draggable={permissions.move && !busy && !props.disabled && !renaming}
                        style={{ paddingLeft: `${8 + depth(entry.path) * 14}px` }}
                        onClick={() => activate(entry)}
                        onKeyDown={(event) => {
                          if ((event.key === "Enter" || event.key === " ") && !renaming) {
                            event.preventDefault();
                            activate(entry);
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (props.disabled || (!permissions.move && !permissions.remove)) return;
                          if (entry.kind === "directory") {
                            setSelectedFolder(entry.path);
                            setDestinationDirectory(entry.path);
                          }
                          setContextMenu({ entry, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 110) });
                        }}
                        onDragStart={(event) => {
                          setContextMenu(null);
                          setDragSource(entry.path);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(INTERNAL_DRAG_TYPE, entry.path);
                          event.dataTransfer.setData("text/plain", entry.path);
                        }}
                        onDragEnd={() => { setDragSource(null); setDropTarget(null); }}
                        onDragEnter={() => { if (entry.kind === "directory") expandPath(entry.path); }}
                        onDragOver={(event) => handleDragOver(event, dropDestination, entry.path)}
                        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
                        onDrop={(event) => void handleDrop(event, dropDestination)}
                        title={entry.path}
                      >
                        {entry.kind === "directory" ? (
                          <ChevronRight className={`tree-chevron${open ? " tree-chevron-open" : ""}`} aria-hidden="true" />
                        ) : (
                          <span className="tree-spacer" aria-hidden="true" />
                        )}
                        <FileIcon entry={entry} open={open} />
                        {renaming ? (
                          <form className="file-rename-form" onSubmit={(event) => void submitRename(event, entry)} onClick={(event) => event.stopPropagation()}>
                            <input
                              autoFocus
                              value={renameName}
                              onChange={(event) => setRenameName(event.target.value)}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => { if (event.key === "Escape") setRenamePath(null); }}
                              aria-label={`Rename ${entry.name}`}
                              aria-invalid={!renameName.trim() || /[\\/]/.test(renameName)}
                            />
                          </form>
                        ) : <span className="file-name">{entry.name}</span>}
                        {props.fileNotes?.[entry.path] ? <small className="file-note" title={props.fileNotes[entry.path]}>{props.fileNotes[entry.path]}</small> : null}
                        {props.rootDocument === entry.path ? <Star className="root-star" aria-label="Root document" /> : null}
                      </div>
                      {isTargetDir ? renderCreateForm() : null}
                    </Fragment>
                  );
                })}
              </>
            );
          })()}
        </nav>
      </section>

      <FileOutline
        filePath={props.outlineFilePath}
        items={props.outlineItems}
        activeLine={props.outlineActiveLine}
        height={outlineHeight}
        onHeightChange={(height) => {
          const maximum = Math.max(120, (explorerRef.current?.clientHeight ?? 640) - 150);
          setOutlineHeight(Math.max(120, Math.min(maximum, height)));
        }}
        onSelect={props.onSelectOutline}
      />

      {contextMenu ? (
        <div ref={contextMenuRef} className="explorer-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {permissions.move ? <button type="button" role="menuitem" onClick={() => {
            setRenamePath(contextMenu.entry.path);
            setRenameName(contextMenu.entry.name);
            setContextMenu(null);
          }}><Pencil aria-hidden="true" />Rename</button> : null}
          {permissions.remove ? <button className="context-danger" type="button" role="menuitem" onClick={() => void deleteEntry(contextMenu.entry)}><Trash2 aria-hidden="true" />Delete</button> : null}
        </div>
      ) : null}
    </aside>
  );
}
