import { CircleAlert, FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { StatusBar } from "./components/StatusBar";
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

  useEffect(() => {
    const target = workspace.jumpTarget;
    if (target && target.path === workspace.activeFile?.path) editorRef.current?.jumpTo(target.line, target.column);
  }, [workspace.activeFile?.path, workspace.jumpTarget]);

  if (!workspace.projectResult) {
    return (
      <ProjectDashboard
        recentProjects={workspace.recentProjects}
        error={workspace.error}
        onNewProject={workspace.openProject}
        onOpenRecent={workspace.openRecentProject}
        onForgetRecent={workspace.forgetRecentProject}
        onDismissError={workspace.clearError}
      />
    );
  }

  const project = workspace.projectResult.project;
  return (
    <div
      className={`app-shell${workspace.pdfOpen ? " pdf-visible" : ""}${workspace.problemsOpen ? " problems-visible" : ""}`}
      style={{
        "--explorer-width": `${workspace.settings.explorerWidth}px`,
        "--pdf-width": `${workspace.settings.pdfWidth}px`,
        "--problems-height": `${workspace.settings.problemsHeight}px`
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

      <div className="workspace-layout">
        <ProjectExplorer
          files={workspace.files}
          selectedPath={workspace.activeFile?.path}
          rootDocument={project.rootDocument}
          onOpen={(path) => void workspace.openFile(path)}
        />

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
                />
              ) : (
                <div className="editor-empty"><FileText /><strong>Select a text file</strong><span>Choose a LaTeX source from the project explorer.</span></div>
              )}
            </div>
          </section>
          <ProblemsPanel
            diagnostics={workspace.diagnostics}
            log={workspace.compileResult?.log ?? ""}
            open={workspace.problemsOpen}
            onToggle={() => workspace.setProblemsOpen(!workspace.problemsOpen)}
            onSelect={(diagnostic) => void workspace.selectDiagnostic(diagnostic)}
          />
        </main>

        {workspace.pdfOpen ? (
          <PdfViewer
            url={workspace.compileResult?.pdfUrl}
            stale={workspace.pdfStale}
            onClose={() => workspace.setPdfOpen(false)}
          />
        ) : null}
      </div>

      <StatusBar file={workspace.activeFile?.path} engine={workspace.settings.compilerEngine} git={workspace.git} />
      {workspace.error ? <div className="toast toast-error" role="alert"><CircleAlert /> <span>{workspace.error}</span><button type="button" onClick={workspace.clearError} aria-label="Dismiss"><X /></button></div> : null}
    </div>
  );
}
