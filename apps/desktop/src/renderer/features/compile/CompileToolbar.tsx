import { Check, CircleAlert, FileText, FolderOpen, LoaderCircle, PanelRight, Play, Save, Square } from "lucide-react";
import type { CompileEvent, FileEntry, LatexEngine, Project } from "@easy-latex/shared-types";

export type SaveState = "saved" | "modified" | "saving" | "conflict" | "failed";

interface CompileToolbarProps {
  project: Project;
  texFiles: FileEntry[];
  engine: LatexEngine;
  saveState: SaveState;
  compileEvent: CompileEvent;
  pdfOpen: boolean;
  onOpenProject(): void;
  onSave(): void;
  onSetRoot(path: string): void;
  onSetEngine(engine: LatexEngine): void;
  onCompile(): void;
  onCancel(): void;
  onTogglePdf(): void;
}

export function CompileToolbar(props: CompileToolbarProps) {
  const compiling = props.compileEvent.phase === "starting" || props.compileEvent.phase === "running" || props.compileEvent.phase === "cancelling";
  const saveLabel = {
    saved: "Saved",
    modified: "Modified",
    saving: "Saving…",
    conflict: "Changed on disk",
    failed: "Save failed"
  }[props.saveState];
  return (
    <header className="app-topbar">
      <div className="project-identity">
        <span className="product-mark" aria-hidden="true">TeX</span>
        <button className="project-name-button" type="button" onClick={props.onOpenProject} title={props.project.workspacePath}>
          <span>{props.project.name}</span><FolderOpen aria-hidden="true" />
        </button>
      </div>
      <div className="document-controls">
        <label className="select-control">
          <span>Root</span>
          <select value={props.project.rootDocument ?? ""} onChange={(event) => props.onSetRoot(event.target.value)}>
            <option value="" disabled>Choose document</option>
            {props.texFiles.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
          </select>
        </label>
        <label className="select-control">
          <span>Engine</span>
          <select value={props.engine} onChange={(event) => props.onSetEngine(event.target.value as LatexEngine)}>
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
            <option value="lualatex">LuaLaTeX</option>
          </select>
        </label>
      </div>
      <div className="topbar-actions">
        <span className={`quiet-status save-${props.saveState}`}>
          {props.saveState === "saving" ? <LoaderCircle className="spin" /> : props.saveState === "saved" ? <Check /> : props.saveState === "modified" ? <Save /> : <CircleAlert />}
          {saveLabel}
        </span>
        <button className={`button button-secondary${props.pdfOpen ? " button-selected" : ""}`} type="button" onClick={props.onTogglePdf}>
          <PanelRight aria-hidden="true" /> PDF
        </button>
        {compiling ? (
          <button className="button button-secondary" type="button" onClick={props.onCancel} disabled={props.compileEvent.phase === "cancelling"}>
            <Square aria-hidden="true" /> {props.compileEvent.phase === "cancelling" ? "Cancelling…" : "Cancel"}
          </button>
        ) : (
          <button className="button button-primary" type="button" onClick={props.onCompile} disabled={!props.project.rootDocument}>
            <Play aria-hidden="true" /> Compile
          </button>
        )}
      </div>
      <div className={`compile-strip compile-${props.compileEvent.phase}`} role="status" aria-live="polite">
        {compiling ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
        <span>{props.compileEvent.message}</span>
      </div>
    </header>
  );
}
