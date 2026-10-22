import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectLinks } from '../src/main/services/collaboration/ProjectLinks';
import { projectList } from '../src/renderer/features/dashboard/projectList';
const first='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
describe('Project identity',()=>{
  it('persists concurrent bindings, scopes them to the backend and replaces a binding atomically',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'easy-latex-links-'));
    try{
      const filename=path.join(root,'state','links.json');const links=new ProjectLinks(filename);
      await Promise.all([links.bind('api','/one',first),links.bind('api','/two',second),links.bind('other','/one',second)]);
      const reopened=new ProjectLinks(filename);
      expect(await reopened.list('api')).toEqual([{workspacePath:'/one',projectId:first},{workspacePath:'/two',projectId:second}]);
      expect(await reopened.list('other')).toEqual([{workspacePath:'/one',projectId:second}]);
      await reopened.bind('api','/one',second);
      expect((await new ProjectLinks(filename).list('api')).filter(p=>p.workspacePath==='/one')).toEqual([{workspacePath:'/one',projectId:second}]);
      expect(await readFile(filename,'utf8')).not.toContain('token');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('rejects damaged metadata rather than exposing converted projects as independent folders',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'easy-latex-links-'));
    try{const filename=path.join(root,'links.json');await writeFile(filename,JSON.stringify([{backend:'api',workspacePath:'/one',projectId:'invalid'}]));await expect(new ProjectLinks(filename).list('api')).rejects.toThrow('Invalid project collaboration links');}
    finally{await rm(root,{recursive:true,force:true});}
  });
  it('deduplicates by identity, retains a bound card without a session or folder, and preserves unrelated same-name projects',()=>{
    const recent=[{name:'Paper',workspacePath:'/one',available:false},{name:'Paper',workspacePath:'/two',available:true}];
    const links=[{workspacePath:'/one',projectId:first}];
    const remote=[{name:'Paper',id:first,role:'owner' as const},{name:'Paper',id:second,role:'editor' as const}];
    expect(projectList(recent,remote,links).map(p=>p.key)).toEqual([first,'/two',second]);
    expect(projectList(recent,[],links)[0]).toMatchObject({collaborationId:first,available:true});
  });
});
