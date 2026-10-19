import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { config } from 'dotenv';
import { AccountManager } from '../apps/desktop/src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../apps/desktop/src/main/services/account/SecureSessionStorage';
import { CollaborationManager } from '../apps/desktop/src/main/services/collaboration/CollaborationManager';
import { ArtifactRegistry } from '../apps/desktop/src/main/services/compiler/ArtifactRegistry';
import type { SharedProject } from '@easy-latex/shared-types';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
config({path:[path.join(root,'.env.local'),path.join(root,'.env')],quiet:true});
if(!process.argv.includes('--live'))throw new Error('This creates a real private test repository. Obtain permission, then pass --live.');
const directory=path.join(root,'.local','github-smoke');await mkdir(directory,{recursive:true,mode:0o700});
const lock=path.join(directory,'running.lock');
try {await mkdir(lock);} catch {throw new Error('A smoke run is already active. Finish or stop it before starting another.');}
const reportPath=path.join(directory,`report-${randomUUID()}.json`);
const report:Record<string,unknown>={startedAt:new Date().toISOString(),checks:[]};
const save=()=>writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});
const check=async(name:string)=>{(report.checks as string[]).push(name);await save();console.log(`Passed: ${name}`);};
const storage=new SecureSessionStorage(path.join(directory,'unused-session'),{available:()=>false,encrypt:()=>{throw new Error('Memory-only smoke session');},decrypt:()=>{throw new Error('Memory-only smoke session');}});
const accounts=new AccountManager({url:process.env.EASY_LATEX_API_URL},storage,async url=>{await writeFile(path.join(directory,'open-url.txt'),url,{mode:0o600});console.log('Open the address in .local/github-smoke/open-url.txt in the signed-in browser.');});
const shared=new CollaborationManager(accounts,process.env.EASY_LATEX_API_URL,directory,new ArtifactRegistry());
const input=createInterface({input:process.stdin,output:process.stdout});
const cancel=()=>{void accounts.cancel();};process.once('SIGINT',cancel);
try {
  const state=await accounts.github();report.account=state.account?.githubLogin;await check('live OAuth with state and desktop PKCE proof');
  let project:SharedProject|undefined;
  const requestId=randomUUID();
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=';
  const source='\\documentclass{article}\n\\begin{document}\nEasy LaTeX synthetic GitHub smoke test.\n\\end{document}\n';
  const name='easy-latex-smoke-test';
  for(let attempt=0;attempt<5&&!project;attempt++){
    try {project=await shared.create({name,requestId,directories:['empty'],files:[{path:'main.tex',content:source,encoding:'utf8'},{path:'figures/sample.png',content:png,encoding:'base64'}]});}
    catch(error){report.status='repository-selection-needed';report.projects=await shared.projects();await save();console.log(error instanceof Error?error.message:'Activation incomplete');console.log(`Review ${reportPath}, select the new test repository for the App, then retry.`);await input.question('Press Enter when repository selection is saved: ');}
  }
  if(!project)throw new Error('Activation did not finish');
  report.project=project;await check('private repository activation and initial Git push');
  const files=await shared.files(project.id);
  const main=files.find(file=>file.path==='main.tex');if(!main)throw new Error('Source missing');
  const lease=await shared.acquire(main.id);
  const edited=source.replace('synthetic GitHub smoke test.','synthetic GitHub smoke test: Done confirmed.');
  await shared.done({fileId:main.id,token:lease.token,baseVersion:main.version,content:edited,requestId:randomUUID()});
  const after=await shared.files(project.id);
  if(after.find(file=>file.id===main.id)?.content!==edited||after.find(file=>file.path==='figures/sample.png')?.content!==png)throw new Error('Published bytes differ');
  await check('Edit lease, Done push, backend confirmation and unchanged resource bytes');
  if((await shared.history(main.id)).length<2)throw new Error('Git history missing');
  if(!(await shared.directories(project.id)).includes('empty'))throw new Error('Empty directory missing');
  await check('Git history and empty directory marker');
  const compiled=await shared.compile(project.id,after.map(file=>({path:file.path,content:file.content,encoding:file.encoding})),'main.tex','pdflatex');
  report.compileSuccess=compiled.success;
  if(!compiled.success)throw new Error('Docker compilation failed');
  await check('local Docker compilation of the GitHub project');
  report.status='passed';report.completedAt=new Date().toISOString();await save();
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(`Live smoke test finished. Report: ${reportPath}`);
} catch(error) {
  report.status='failed';report.error=error instanceof Error?error.message:'Live smoke test failed';await save();console.error(report.error);process.exitCode=1;
} finally {process.removeListener('SIGINT',cancel);input.close();shared.stopUpdates();await shared.cancel();await accounts.signOut();await rm(lock,{recursive:true,force:true});}
