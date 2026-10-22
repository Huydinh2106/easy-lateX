// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState, SharedProject, OpenProjectResult } from '@easy-latex/shared-types';

const workspace=vi.hoisted(()=>({projectResult:null as OpenProjectResult|null,recentProjects:[{name:'Local paper',workspacePath:'/local/paper',available:true}],settings:{projectsDirectory:'/local',compilerEngine:'pdflatex',explorerWidth:232,pdfWidth:520,problemsHeight:220},error:null,activeFile:null,content:'',clearError:vi.fn(),createProject:vi.fn(),chooseProjectsDirectory:vi.fn(),openProject:vi.fn(),openRecentProject:vi.fn(),forgetRecentProject:vi.fn(),save:vi.fn(),showProjects:vi.fn()}));
vi.mock('../src/renderer/hooks/useWorkspaceController',()=>({useWorkspaceController:()=>workspace}));
vi.mock('../src/renderer/features/collaboration/SharedWorkspace',()=>({SharedWorkspace:({project,onClose}:{project:SharedProject;onClose():void})=><div><h1>Editing {project.name}</h1><button type="button" onClick={onClose}>Back to projects</button></div>}));
import { App } from '../src/renderer/App';
const anonymous:AccountState={configured:true,googleEnabled:false,account:null,recovery:false};
const signedIn:AccountState={...anonymous,account:{id:'alice',displayName:'Alice',email:'alice@example.test'}};
const shared:SharedProject={id:'shared',name:'Team paper',role:'owner'};
const auth={state:vi.fn(),github:vi.fn(),cancel:vi.fn(),signOut:vi.fn()};
const api={links:vi.fn(),projects:vi.fn(),invitations:vi.fn(),shareCurrentProject:vi.fn(),create:vi.fn(),accept:vi.fn()};
beforeEach(()=>{
  workspace.projectResult=null;vi.resetAllMocks();auth.state.mockResolvedValue(anonymous);auth.github.mockResolvedValue(signedIn);auth.cancel.mockResolvedValue(undefined);
  api.links.mockResolvedValue([]);api.projects.mockResolvedValue([]);api.invitations.mockResolvedValue([]);api.shareCurrentProject.mockResolvedValue(shared);api.create.mockResolvedValue(shared);
  workspace.openRecentProject.mockResolvedValue(true);workspace.save.mockResolvedValue(true);workspace.createProject.mockResolvedValue(true);workspace.showProjects.mockResolvedValue(undefined);
  Object.defineProperty(window,'desktop',{value:{auth,collaboration:api},configurable:true});
});
afterEach(cleanup);
const start=async()=>{render(<App/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Collaborate on Local paper'})).toBeEnabled());};
const signIn=async()=>{
  const dialog=within(screen.getByRole('dialog',{name:'Sign in to collaborate'}));
  fireEvent.click(dialog.getByRole('button',{name:'Continue with GitHub'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
};
describe('Unified projects and optional sign-in',()=>{
  it('keeps local opening and creation available without authentication',async()=>{
    await start();fireEvent.click(screen.getByRole('button',{name:/Local paper.*On this device$/}));
    expect(workspace.openRecentProject).toHaveBeenCalledWith('/local/paper');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'New project'}));fireEvent.change(screen.getByPlaceholderText('My research paper'),{target:{value:'Another local paper'}});
    fireEvent.click(screen.getByRole('button',{name:'Create project'}));await waitFor(()=>expect(workspace.createProject).toHaveBeenCalledWith('Another local paper'));
    expect(api.create).not.toHaveBeenCalled();expect(api.shareCurrentProject).not.toHaveBeenCalled();
  });
  it('requests sign-in before sharing a local project and resumes the requested action afterward',async()=>{
    await start();await waitFor(()=>expect(auth.state).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button',{name:'Collaborate on Local paper'}));
    expect(screen.getByRole('dialog',{name:'Sign in to collaborate'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Projects'})).toBeInTheDocument();expect(api.shareCurrentProject).not.toHaveBeenCalled();
    await signIn();await screen.findByRole('heading',{name:'Editing Team paper'});
    expect(workspace.openRecentProject).toHaveBeenCalledWith('/local/paper');expect(workspace.save).toHaveBeenCalled();expect(api.shareCurrentProject).toHaveBeenCalledTimes(1);
  });
  it('cancelling authentication drops the pending share action',async()=>{
    await start();fireEvent.click(screen.getByRole('button',{name:'Collaborate on Local paper'}));fireEvent.click(screen.getByRole('button',{name:'Close sign-in'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(api.shareCurrentProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Sign in to collaborate'}));await signIn();
    expect(api.shareCurrentProject).not.toHaveBeenCalled();expect(screen.getByRole('heading',{name:'Projects'})).toBeInTheDocument();
  });
  it('shows local and shared projects in the same searchable list',async()=>{
    auth.state.mockResolvedValue(signedIn);api.projects.mockResolvedValue([shared]);await start();
    await screen.findByRole('button',{name:/Team paper.*Collaboration enabled$/});expect(screen.getByRole('button',{name:/Local paper.*On this device$/})).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox',{name:'Search projects'}),{target:{value:'Team'}});
    expect(screen.queryByRole('button',{name:/Local paper.*On this device$/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Team paper.*Collaboration enabled$/}));await screen.findByRole('heading',{name:'Editing Team paper'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps one project after enabling collaboration and reopening it',async()=>{
    auth.state.mockResolvedValue(signedIn);await start();
    api.links.mockResolvedValue([{workspacePath:'/local/paper',projectId:shared.id}]);api.projects.mockResolvedValue([shared]);
    fireEvent.click(screen.getByRole('button',{name:'Collaborate on Local paper'}));await screen.findByRole('heading',{name:'Editing Team paper'});
    fireEvent.click(screen.getByRole('button',{name:'Back to projects'}));
    await screen.findByRole('button',{name:/Team paper.*Collaboration enabled$/});
    expect(document.querySelectorAll('.dashboard-project-card')).toHaveLength(1);
    expect(screen.queryByRole('button',{name:/Local paper.*On this device$/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Collaborate on Team paper'}));await screen.findByRole('heading',{name:'Editing Team paper'});
    expect(api.shareCurrentProject).toHaveBeenCalledTimes(1);expect(workspace.openRecentProject).toHaveBeenCalledTimes(1);
  });
  it('preserves the project identity after restart while signed out and requires sign-in to open it',async()=>{
    api.links.mockResolvedValue([{workspacePath:'/local/paper',projectId:shared.id}]);
    await startLinked();
    expect(document.querySelectorAll('.dashboard-project-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:/Local paper.*Collaboration enabled$/}));
    expect(screen.getByRole('dialog',{name:'Sign in to collaborate'})).toBeInTheDocument();
    expect(workspace.openRecentProject).not.toHaveBeenCalled();
    api.projects.mockResolvedValue([shared]);await signIn();await screen.findByRole('heading',{name:'Editing Team paper'});
    expect(api.shareCurrentProject).not.toHaveBeenCalled();
  });
  it('routes a bound folder opened through the native picker to sign-in without exposing the local editor',async()=>{
    workspace.projectResult={project:{name:'Local paper',workspacePath:'/local/paper'},rootCandidates:['main.tex']};
    api.links.mockResolvedValue([{workspacePath:'/local/paper',projectId:shared.id}]);render(<App/>);
    await screen.findByRole('dialog',{name:'Sign in to collaborate'});
    expect(screen.queryByRole('button',{name:'Compile'})).not.toBeInTheDocument();
    expect(workspace.openRecentProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Close sign-in'}));expect(workspace.showProjects).toHaveBeenCalled();
  });
  it('does not fall back to editing the original folder with an account that lacks access',async()=>{
    auth.state.mockResolvedValue(signedIn);api.links.mockResolvedValue([{workspacePath:'/local/paper',projectId:shared.id}]);await startLinked();
    fireEvent.click(screen.getByRole('button',{name:/Local paper.*Collaboration enabled$/}));
    await screen.findByText('Sign in with an account that has access to this project.');
    expect(workspace.openRecentProject).not.toHaveBeenCalled();expect(api.shareCurrentProject).not.toHaveBeenCalled();
  });
});
const startLinked=async()=>{render(<App/>);await waitFor(()=>expect(screen.getByRole('button',{name:/Local paper.*Collaboration enabled$/})).toBeEnabled());};
