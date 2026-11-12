import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AppSettings, Diagnostic } from "@easy-latex/shared-types";
import { PanelResizer } from "./PanelResizer";
import { getPanelLayout } from "./panelLayout";
import { PdfViewer, type PdfViewerJumpTarget } from "../features/pdf/PdfViewer";
import { ProblemsPanel } from "../features/problems/ProblemsPanel";

export type PanelSettings = Pick<AppSettings, "explorerWidth" | "pdfWidth" | "problemsHeight">;
interface Props {
  toolbar: ReactNode;
  explorer: ReactNode;
  children: ReactNode;
  status: ReactNode;
  overlay?: ReactNode;
  settings: PanelSettings;
  onResize(key: keyof PanelSettings, value: number, persist: boolean): void;
  pdfOpen: boolean;
  pdfUrl?: string | undefined;
  pdfStale: boolean;
  onClosePdf(): void;
  onInverseSync?(input: { page: number; x: number; y: number }): void;
  pdfJumpTarget?: PdfViewerJumpTarget | null;
  problemsOpen: boolean;
  diagnostics: Diagnostic[];
  log: string;
  onToggleProblems(): void;
  onSelectDiagnostic(diagnostic: Diagnostic): void;
}

export function WorkspaceFrame(props: Props) {
  const layout = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({width: window.innerWidth, height: window.innerHeight - 74});
  useEffect(() => {
    if (!layout.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({width: entry.contentRect.width, height: entry.contentRect.height});
    });
    observer.observe(layout.current);
    return () => observer.disconnect();
  }, []);
  const panels = getPanelLayout(props.settings, size, props.pdfOpen);
  return <div className={`app-shell${props.pdfOpen ? " pdf-visible" : ""}${panels.pdfOverlay ? " pdf-overlay" : ""}${props.problemsOpen ? " problems-visible" : ""}`}
    style={{"--explorer-width": `${panels.explorerWidth}px`, "--pdf-width": `${panels.pdfWidth}px`, "--problems-height": `${panels.problemsHeight}px`} as CSSProperties}>
    {props.toolbar}
    <div className="workspace-layout" ref={layout}>
      {props.explorer}
      <PanelResizer label="Resize project explorer" orientation="vertical" value={panels.explorerWidth} minimum={180} maximum={panels.explorerMaximum} defaultValue={232}
        onChange={(value, persist) => props.onResize("explorerWidth", value, persist)} />
      <main className="editor-workspace">
        <section className="editor-panel" aria-label="Document editor">{props.children}</section>
        {props.problemsOpen ? <PanelResizer label="Resize Problems panel" orientation="horizontal" direction={-1} value={panels.problemsHeight} minimum={120} maximum={panels.problemsMaximum} defaultValue={220}
          onChange={(value, persist) => props.onResize("problemsHeight", value, persist)} /> : null}
        <ProblemsPanel diagnostics={props.diagnostics} log={props.log} open={props.problemsOpen} onToggle={props.onToggleProblems} onSelect={props.onSelectDiagnostic}/>
      </main>
      {props.pdfOpen ? <>
        <PanelResizer label="Resize PDF preview" className="pdf-resizer" orientation="vertical" direction={-1} value={panels.pdfWidth} minimum={360} maximum={panels.pdfMaximum} defaultValue={520}
          onChange={(value, persist) => props.onResize("pdfWidth", value, persist)} />
        <PdfViewer
          url={props.pdfUrl}
          stale={props.pdfStale}
          onClose={props.onClosePdf}
          onInverseSync={props.onInverseSync}
          jumpTarget={props.pdfJumpTarget}
        />
      </> : null}
    </div>
    {props.status}
    {props.overlay}
  </div>;
}
