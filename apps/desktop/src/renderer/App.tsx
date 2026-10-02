import { CircleAlert, FileText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseOutline } from "@easy-latex/latex";
import { StatusBar } from "./components/StatusBar";
import { PanelResizer } from "./components/PanelResizer";
import { getPanelLayout } from "./components/panelLayout";
import { CompileToolbar } from "./features/compile/CompileToolbar";
import { ProjectDashboard } from "./features/dashboard/ProjectDashboard";
import { LatexEditor, type LatexEditorHandle } from "./features/editor/LatexEditor";
import { PdfViewer } from "./features/pdf/PdfViewer";
import { ProblemsPanel } from "./features/problems/ProblemsPanel";
import { ProjectExplorer } from "./features/project/ProjectExplorer";
import { useWorkspaceController } from "./hooks/useWorkspaceController";

export function App() {
  const workspace = useWorkspaceController();
  const editorRef = useRef<LatexEditorHandle>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutSize, setLayoutSize] = useState({ width: window.innerWidth, height: window.innerHeight - 74 });
  const hasProject = Boolean(workspace.projectResult);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setLayoutSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, [hasProject]);

  useEffect(() => {
    const target = workspace.jumpTarget;
    if (target && target.path === workspace.activeFile?.path) editorRef.current?.jumpTo(target.line, target.column);
  }, [workspace.activeFile?.path, workspace.jumpTarget]);

  useEffect(() => setCursorLine(1), [workspace.activeFile?.path]);

  const outlineItems = useMemo(() => {
    const activePath = workspace.activeFile?.path;
    return activePath?.toLowerCase().endsWith(".tex") ? parseOutline(workspace.content, activePath) : [];
  }, [workspace.activeFile?.path, workspace.content]);

  if (!workspace.projectResult) {
    return (
      <ProjectDashboard
        recentProjects={workspace.recentProjects}
        projectsDirectory={workspace.settings.projectsDirectory}
        error={workspace.error}
        onCreateProject={workspace.createProject}
        onChooseProjectsDirectory={workspace.chooseProjectsDirectory}
        onOpenProject={workspace.openProject}
        onOpenRecent={workspace.openRecentProject}
        onForgetRecent={workspace.forgetRecentProject}
        onDismissError={workspace.clearError}
      />
    );
  }

  const project = workspace.projectResult.project;
  const { explorerWidth, explorerMaximum, pdfWidth, pdfMaximum, pdfOverlay, problemsHeight, problemsMaximum } = getPanelLayout(workspace.settings, layoutSize, workspace.pdfOpen);
  return (
    <div
      className={`app-shell${workspace.pdfOpen ? " pdf-visible" : ""}${pdfOverlay ? " pdf-overlay" : ""}${workspace.problemsOpen ? " problems-visible" : ""}`}
      style={{
        "--explorer-width": `${explorerWidth}px`,
        "--pdf-width": `${pdfWidth}px`,
        "--problems-height": `${problemsHeight}px`
      } as React.CSSProperties}
    >
      <CompileToolbar
        project={project}
        texFiles={workspace.texFiles}
        engine={workspace.settings.compilerEngine}
        saveState={workspace.saveState}
        compileEvent={workspace.compileEvent}
        pdfOpen={workspace.pdfOpen}
        onShowProjects={() => void workspace.showProjects()}
        onSave={() => void workspace.save()}
        onSetRoot={(path) => void workspace.setRoot(path)}
        onSetEngine={(engine) => void workspace.setEngine(engine)}
        onCompile={() => void workspace.compile()}
        onCancel={() => void workspace.cancelCompile()}
        onTogglePdf={() => workspace.setPdfOpen(!workspace.pdfOpen)}
      />

      <div className="workspace-layout" ref={layoutRef}>
        <ProjectExplorer
          files={workspace.files}
          selectedPath={workspace.activeFile?.path}
          rootDocument={project.rootDocument}
          outlineFilePath={workspace.activeFile?.path}
          outlineItems={outlineItems}
          outlineActiveLine={cursorLine}
          onOpen={(path) => void workspace.openFile(path)}
          onCreateFile={workspace.createFile}
          onCreateDirectory={workspace.createDirectory}
          onMove={workspace.movePath}
          onRemove={workspace.removePath}
          onImportFiles={workspace.importFiles}
          onImportFolder={workspace.importFolder}
          onImportDropped={workspace.importDropped}
          onSelectOutline={(item) => editorRef.current?.jumpTo(item.line, item.column)}
        />

        <PanelResizer label="Resize project explorer" orientation="vertical" value={explorerWidth} minimum={180} maximum={explorerMaximum} defaultValue={232}
          onChange={(value, persist) => workspace.resizePanel("explorerWidth", value, persist)} />

        <main className="editor-workspace">
          <section className="editor-panel" aria-label="LaTeX source editor">
            <header className="editor-header">
              <span>{workspace.activeFile?.path ?? "No file selected"}</span>
              {workspace.activeFile ? <small>{workspace.activeFile.size.toLocaleString()} bytes</small> : null}
            </header>
            <div className="editor-surface">
              {workspace.activeFile ? (
                <LatexEditor
                  ref={editorRef}
                  path={workspace.activeFile.path}
                  value={workspace.content}
                  diagnostics={workspace.diagnostics}
                  onChange={workspace.changeContent}
                  onSave={() => void workspace.save()}
                  onCursorLineChange={setCursorLine}
                />
              ) : (
                <div className="editor-empty"><FileText /><strong>Select a text file</strong><span>Choose a LaTeX source from the project explorer.</span></div>
              )}
            </div>
          </section>
          {workspace.problemsOpen ? (
            <PanelResizer label="Resize Problems panel" orientation="horizontal" direction={-1} value={problemsHeight} minimum={120} maximum={problemsMaximum} defaultValue={220}
              onChange={(value, persist) => workspace.resizePanel("problemsHeight", value, persist)} />
          ) : null}
          <ProblemsPanel
            diagnostics={workspace.diagnostics}
            log={workspace.compileResult?.log ?? ""}
            open={workspace.problemsOpen}
            onToggle={() => workspace.setProblemsOpen(!workspace.problemsOpen)}
            onSelect={(diagnostic) => void workspace.selectDiagnostic(diagnostic)}
          />
        </main>

        {workspace.pdfOpen ? (
          <>
            <PanelResizer label="Resize PDF preview" className="pdf-resizer" orientation="vertical" direction={-1} value={pdfWidth} minimum={360} maximum={pdfMaximum} defaultValue={520}
              onChange={(value, persist) => workspace.resizePanel("pdfWidth", value, persist)} />
            <PdfViewer
              url={workspace.compileResult?.pdfUrl}
              stale={workspace.pdfStale}
              onClose={() => workspace.setPdfOpen(false)}
            />
          </>
        ) : null}
      </div>

      <StatusBar file={workspace.activeFile?.path} engine={workspace.settings.compilerEngine} git={workspace.git} />
      {workspace.error ? <div className="toast toast-error" role="alert"><CircleAlert /> <span>{workspace.error}</span><button type="button" onClick={workspace.clearError} aria-label="Dismiss"><X /></button></div> : null}
    </div>
  );
}
