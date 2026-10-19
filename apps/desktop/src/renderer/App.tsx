import { SharedWorkspace } from "./features/collaboration/SharedWorkspace";
import { AccountDialog } from "./features/account/AccountDialog";
import { useCollaborationController } from "./hooks/useCollaborationController";
import { WorkspaceFrame } from "./components/WorkspaceFrame";
import type { SharedProject } from "@easy-latex/shared-types";
import { CircleAlert, FileText, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseOutline } from "@easy-latex/latex";
import { StatusBar } from "./components/StatusBar";
import { CompileToolbar } from "./features/compile/CompileToolbar";
import { ProjectDashboard } from "./features/dashboard/ProjectDashboard";
import { LatexEditor, type LatexEditorHandle } from "./features/editor/LatexEditor";
import { ProjectExplorer } from "./features/project/ProjectExplorer";
import { useWorkspaceController } from "./hooks/useWorkspaceController";

export function App() {
  const workspace = useWorkspaceController();
  const collaboration = useCollaborationController();
  const [sharedProject, setSharedProject] = useState<SharedProject | null>(null);
  const [inviteOnOpen, setInviteOnOpen] = useState(false);
  const editorRef = useRef<LatexEditorHandle>(null);
  const [cursorLine, setCursorLine] = useState(1);
  useEffect(() => {
    const target = workspace.jumpTarget;
    if (target && target.path === workspace.activeFile?.path) editorRef.current?.jumpTo(target.line, target.column);
  }, [workspace.activeFile?.path, workspace.jumpTarget]);

  useEffect(() => setCursorLine(1), [workspace.activeFile?.path]);

  const outlineItems = useMemo(() => {
    const activePath = workspace.activeFile?.path;
    return activePath?.toLowerCase().endsWith(".tex") ? parseOutline(workspace.content, activePath) : [];
  }, [workspace.activeFile?.path, workspace.content]);

  const activeLink = collaboration.links.find(link => link.workspacePath === workspace.projectResult?.project.workspacePath);
  const openShared = (projectId: string, invite = false) => collaboration.requireAccount(async () => {
    const project = (await window.desktop.collaboration.projects()).find(project => project.id === projectId);
    if (!project) throw new Error("Sign in with an account that has access to this project.");
    if (!await workspace.save()) throw new Error("Save your draft before opening another project");
    setInviteOnOpen(invite);
    setSharedProject(project);
    await workspace.showProjects();
  });
  const shareLocal = (workspacePath?: string) => {
    const existing = collaboration.links.find(link => link.workspacePath === (workspacePath ?? workspace.projectResult?.project.workspacePath));
    if (existing) {openShared(existing.projectId, true); return;}
    collaboration.requireAccount(async () => {
      if (workspacePath && !await workspace.openRecentProject(workspacePath)) throw new Error("Could not open this project for collaboration");
      if (!await workspace.save()) throw new Error("Save the file before enabling collaboration");
      const project = await window.desktop.collaboration.shareCurrentProject();
      setInviteOnOpen(true);
      setSharedProject(project);
      await workspace.showProjects();
      await collaboration.refreshLinks();
      await collaboration.refresh();
    });
  };
  const openRecent = async (workspacePath: string): Promise<boolean> => {
    const existing = collaboration.links.find(link => link.workspacePath === workspacePath);
    if (existing) {openShared(existing.projectId); return false;}
    return workspace.openRecentProject(workspacePath);
  };
  // Native folder opening must also respect a project's saved collaboration identity.
  const routedProject = useRef<string | null>(null);
  useEffect(() => {
    if (!workspace.projectResult) {routedProject.current = null; return;}
    if (!collaboration.linksReady || !collaboration.accountReady || !activeLink || sharedProject) return;
    if (routedProject.current === activeLink.projectId) return;
    routedProject.current = activeLink.projectId;
    openShared(activeLink.projectId);
  });
  const dismissError = () => {workspace.clearError(); collaboration.clearError();};
  const closeAuth = () => {collaboration.closeAuth(); if (activeLink) void workspace.showProjects();};
  const authDialog = collaboration.authOpen ? <AccountDialog state={collaboration.account} onChanged={collaboration.changed} onClose={closeAuth}/> : null;

  if (sharedProject && collaboration.account.account) return <SharedWorkspace project={sharedProject} account={collaboration.account.account}
    initialInvitationsOpen={inviteOnOpen} settings={workspace.settings} onResize={workspace.resizePanel} onClose={() => {setSharedProject(null); void collaboration.run(collaboration.refresh);}}/>;

  if (workspace.projectResult && (!collaboration.linksReady || activeLink)) return <div className="editor-empty">
    <Users /><strong>{collaboration.error ?? (activeLink ? "Sign in to open this project" : "Loading projects…")}</strong>
    {activeLink ? <button className="button button-primary" type="button" disabled={collaboration.busy} onClick={() => openShared(activeLink.projectId)}>Open project</button> : null}
    <button className="button button-secondary" type="button" onClick={() => void workspace.showProjects()}>Back to projects</button>
    {authDialog}
  </div>;

  if (!workspace.projectResult) {
    return (
      <>
      <ProjectDashboard
        account={collaboration.account.account}
        sessionPersistence={collaboration.account.sessionPersistence}
        sharedProjects={collaboration.projects}
        projectLinks={collaboration.links}
        invitations={collaboration.invitations}
        busy={collaboration.busy || !collaboration.linksReady || collaboration.authOpen}
        onSignIn={() => collaboration.requireAccount()}
        onSignOut={() => void collaboration.signOut()}
        onCollaborate={path => shareLocal(path)}
        onOpenShared={openShared}
        onAcceptInvitation={collaboration.accept}
        recentProjects={workspace.recentProjects}
        projectsDirectory={workspace.settings.projectsDirectory}
        error={workspace.error ?? collaboration.error}
        onCreateProject={workspace.createProject}
        onChooseProjectsDirectory={workspace.chooseProjectsDirectory}
        onOpenProject={workspace.openProject}
        onOpenRecent={openRecent}
        onForgetRecent={workspace.forgetRecentProject}
        onDismissError={dismissError}
      />
      {authDialog}
      </>
    );
  }

  const project = workspace.projectResult.project;
  return <WorkspaceFrame settings={workspace.settings} onResize={workspace.resizePanel} pdfOpen={workspace.pdfOpen}
    pdfUrl={workspace.compileResult?.pdfUrl} pdfStale={workspace.pdfStale} onClosePdf={() => workspace.setPdfOpen(false)}
    problemsOpen={workspace.problemsOpen} diagnostics={workspace.diagnostics} log={workspace.compileResult?.log ?? ""}
    onToggleProblems={() => workspace.setProblemsOpen(!workspace.problemsOpen)} onSelectDiagnostic={diagnostic => void workspace.selectDiagnostic(diagnostic)}
    status={<StatusBar file={workspace.activeFile?.path} engine={workspace.settings.compilerEngine} git={workspace.git}/>}
    overlay={<>{authDialog}{workspace.error || collaboration.error ? <div className="toast toast-error" role="alert"><CircleAlert /><span>{workspace.error ?? collaboration.error}</span><button type="button" onClick={dismissError} aria-label="Dismiss"><X /></button></div> : null}</>}
    toolbar={
      <CompileToolbar
        project={project}
        texFiles={workspace.texFiles}
        engine={workspace.settings.compilerEngine}
        saveState={workspace.saveState}
        compileEvent={workspace.compileEvent}
        pdfOpen={workspace.pdfOpen}
        disabled={collaboration.busy}
        actions={<button className="button button-secondary" type="button" disabled={collaboration.busy || ["starting", "running", "cancelling"].includes(workspace.compileEvent.phase)} onClick={() => shareLocal()}><Users /> Collaborate</button>}
        onShowProjects={() => void workspace.showProjects()}
        onSave={() => void workspace.save()}
        onSetRoot={(path) => void workspace.setRoot(path)}
        onSetEngine={(engine) => void workspace.setEngine(engine)}
        onCompile={() => void workspace.compile()}
        onCancel={() => void workspace.cancelCompile()}
        onTogglePdf={() => workspace.setPdfOpen(!workspace.pdfOpen)}
      />}
    explorer={<ProjectExplorer
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
        />}
    >
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
    </WorkspaceFrame>;
}
