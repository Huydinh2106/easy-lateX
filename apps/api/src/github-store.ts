import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Account, GitFileMetadata, SharedProject, PublishChange, PublishTicket, ProjectInvitation } from '@easy-latex/shared-types';
import { ApiError, validateFilePath, validateDirectoryPath } from './store';
import { hash, type Repository, type TreeEntry } from './github';
import type { GitHubAuth } from './github-auth';
interface ProjectRow {id:string;name:string;owner_id:string;repo_id:string|null;repo_owner:string;repo_name:string;branch:string;head_sha:string|null;status:string;legacy_project_id:string|null;}
interface Publication extends PublishTicket {userId:string;fingerprint:string;leaseTokens:Record<string,string>;}
const publicationSelect=`select project_id as "projectId", request_id as "requestId",user_id as "userId",fingerprint,base_sha as "baseSha",commit_sha as "commitSha",changes,lease_tokens as "leaseTokens",status,expires_at::text as "expiresAt" from collaboration.github_publications`;
export function validateGitPath(p:string):void {
  if(p.endsWith('/.gitkeep'))validateDirectoryPath(p.slice(0,-9));else validateFilePath(p);
  if(p.split('/').some(v=>/^(build|dist|out|cache|\.env.*)$/i.test(v))||/^(credentials|secrets)\./i.test(p.split('/').at(-1)!))throw new ApiError(400,'Build and secret files cannot be shared');
}
export function verifyPublication(ticket:PublishTicket,before:TreeEntry[],after:TreeEntry[],commit:{sha:string;parents:{sha:string}[];message:string},head:string|null):void {
  if(ticket.commitSha!==head||commit.sha!==head||commit.parents.length!==(ticket.baseSha?1:0)||ticket.baseSha&&commit.parents[0]?.sha!==ticket.baseSha||!commit.message.split('\n').includes(`Easy-LaTeX-Request: ${ticket.requestId}`))throw new ApiError(409,'Remote changed or publication commit could not be verified. Your draft is preserved.');
  const old=new Map(before.map(e=>[e.path,`${e.sha}:${e.mode}`]));const next=new Map(after.map(e=>[e.path,`${e.sha}:${e.mode}`]));
  const changed=[...new Set([...old.keys(),...next.keys()])].filter(p=>old.get(p)!==next.get(p));
  if(changed.length!==ticket.changes.length||ticket.changes.some(c=>next.get(c.path)!==`${c.blobSha}:100644`||!changed.includes(c.path)))throw new ApiError(409,'Commit contains changes outside the authorized publication');
}
export class GitHubStore {
  readonly pool:Pool;
  constructor(private readonly auth:GitHubAuth,private readonly leaseSeconds=90){this.pool=auth.pool;}
  private async tx<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>{const db=await this.pool.connect();try{await db.query('begin');const r=await fn(db);await db.query('commit');return r;}catch(e){await db.query('rollback');throw e;}finally{db.release();}}
  private async notify(db:Pool|PoolClient,id:string):Promise<void>{await db.query("select pg_notify('easy_latex_project_changed',$1)",[id]);}
  async row(id:string):Promise<ProjectRow>{const p=(await this.pool.query<ProjectRow>('select * from collaboration.github_projects where id=$1',[id])).rows[0];if(!p)throw new ApiError(404,'Project not found');return p;}
  async access(projectId:string,userId:string,write=false,owner=false):Promise<{p:ProjectRow;repo:Repository;token:string;role:SharedProject['role']}>{
    const p=await this.row(projectId);
    const role=(await this.pool.query<{role:SharedProject['role']}>('select role from collaboration.github_members where project_id=$1 and user_id=$2',[projectId,userId])).rows[0]?.role;
    if(!role||write&&role==='viewer'||owner&&role!=='owner')throw new ApiError(403,'You do not have permission for this project');
    if(!p.repo_id)throw new ApiError(409,'Repository activation needs to be retried');
    const token=await this.auth.credentials(userId);const repo=await this.auth.github.repo(token,Number(p.repo_id));
    if(!repo.private||!repo.permissions?.pull||write&&!repo.permissions.push||owner&&(repo.owner.id!==Number((await this.pool.query<{github_id:string}>('select github_id from collaboration.profiles where id=$1',[userId])).rows[0]?.github_id)||!repo.permissions.admin))throw new ApiError(403,'GitHub repository access changed. Restore access before continuing.');
    await this.pool.query('update collaboration.github_projects set repo_owner=$2,repo_name=$3 where id=$1',[projectId,repo.owner.login,repo.name]);
    return {p,repo,token,role};
  }
  async projects(userId:string):Promise<SharedProject[]>{
    const rows=(await this.pool.query<ProjectRow&{role:SharedProject['role']}>(`select p.*,m.role from collaboration.github_projects p join collaboration.github_members m on m.project_id=p.id where m.user_id=$1 order by p.name`,[userId])).rows;
    return rows.map(p=>({id:p.id,name:p.name,role:p.role,...(p.repo_id?{repository:{id:Number(p.repo_id),owner:p.repo_owner,name:p.repo_name,branch:p.branch,head:p.head_sha}}:{})}));
  }
  async create(account:Account,input:{name:string;requestId:string;legacyProjectId?:string|undefined}):Promise<SharedProject>{
    await this.auth.github.installations(await this.auth.credentials(account.id));
    // Reserve the stable activation before any network operation. Distinct UUID suffixes avoid name collisions.
    const p=await this.tx(async db=>{
      if(input.legacyProjectId){const member=(await db.query(`select 1 from collaboration.members m join collaboration.github_legacy_links l on l.legacy_user_id=m.user_id where m.project_id=$1 and l.github_user_id=$2 and m.role='owner'`,[input.legacyProjectId,account.id])).rowCount;if(!member)throw new ApiError(403,'Link your legacy account explicitly before migrating this project');}
      const p=(await db.query<ProjectRow>(`insert into collaboration.github_projects(owner_id,request_id,name,legacy_project_id) values($1,$2,$3,$4) on conflict(owner_id,request_id) do update set request_id=excluded.request_id returning *`,[account.id,input.requestId,input.name,input.legacyProjectId??null])).rows[0]!;
      await db.query(`insert into collaboration.github_members values($1,$2,'owner') on conflict do nothing`,[p.id,account.id]);return p;
    });
    if(p.name!==input.name||p.legacy_project_id!==(input.legacyProjectId??null))throw new ApiError(409,'Activation request ID was already used');
    if(!p.repo_id){
      const token=await this.auth.credentials(account.id);const user=await this.auth.github.user(token);
      const name=`${input.name.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,40)||'latex'}-${p.id}`;
      const marker=`Easy LaTeX project ${p.id}`;
      let repo:Repository;
      try{repo=await this.auth.github.api<Repository>(token,`/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(name)}`);}
      catch(e){if(!(e instanceof ApiError)||e.statusCode!==404)throw e;try{repo=await this.auth.github.api<Repository>(token,'/user/repos','POST',{name,private:true,auto_init:false,description:marker});}catch(e){if(!(e instanceof ApiError)||e.statusCode!==409)throw e;repo=await this.auth.github.api<Repository>(token,`/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(name)}`);}}
      if(!repo.private||repo.owner.id!==user.id||repo.description!==marker)throw new ApiError(409,'Repository collision. No existing repository was overwritten.');
      // Adopt only our empty creation after an uncertain response; never overwrite unrelated content.
      const current=await this.auth.github.head(token,repo,p.branch);
      if(current)throw new ApiError(409,'Unlinked repository already contains commits. Manual recovery is required; nothing was overwritten.');
      await this.pool.query(`update collaboration.github_projects set repo_id=$2,repo_owner=$3,repo_name=$4 where id=$1 and repo_id is null`,[p.id,repo.id,repo.owner.login,repo.name]);
    }
    const updated=await this.row(p.id);return {id:p.id,name:p.name,role:'owner',repository:{id:Number(updated.repo_id),owner:updated.repo_owner,name:updated.repo_name,branch:updated.branch,head:updated.head_sha}};
  }
  private async syncMetadata(db:PoolClient,p:ProjectRow,tree:TreeEntry[],head:string|null):Promise<void>{
    for(const entry of tree){
      try{validateGitPath(entry.path);}catch{continue;}
      if(entry.mode!=='100644')continue;
      await db.query(`insert into collaboration.github_files(project_id,path,blob_sha,encoding) values($1,$2,$3,$4) on conflict(project_id,path) do update set deleted=false,version=collaboration.github_files.version+case when collaboration.github_files.blob_sha<>excluded.blob_sha then 1 else 0 end,blob_sha=excluded.blob_sha,updated_at=case when collaboration.github_files.blob_sha<>excluded.blob_sha then now() else collaboration.github_files.updated_at end`,[p.id,entry.path,entry.sha,/\.(tex|bib|sty|cls|bst|ltx|md|txt|gitkeep)$/i.test(entry.path)?'utf8':'base64']);
    }
    // Tombstones invalidate old leases while preserving receipt/lease references for recovery.
    await db.query(`update collaboration.github_files set deleted=true,version=version+1,updated_at=now() where project_id=$1 and not(path=any($2::text[])) and not deleted`,[p.id,tree.map(e=>e.path)]);
    await db.query('update collaboration.github_projects set head_sha=$2,status=case when $2::text is null then status else \'ready\' end where id=$1',[p.id,head]);
  }
  async reconcile(projectId:string,userId:string):Promise<void>{
    const {p,repo,token}=await this.access(projectId,userId);
    await this.reconcileTree(p,repo,token);
  }
  /** Signed GitHub webhooks use installation credentials, independent of desktop login sessions. */
  async reconcileWebhook(repository:{id:number;name?:string;owner?:{login?:string}}):Promise<void>{
    const projects=(await this.pool.query<ProjectRow>('select * from collaboration.github_projects where repo_id=$1',[repository.id])).rows;
    for(const p of projects){
      const name=repository.name??p.repo_name,login=repository.owner?.login??p.repo_owner;
      if(!/^[a-zA-Z0-9_.-]+$/.test(name)||!/^[a-zA-Z0-9-]+$/.test(login))throw new ApiError(400,'Invalid webhook repository');
      const candidate={id:repository.id,name,owner:{login}} as Repository;
      const {token}=await this.auth.github.gitToken(candidate,false);
      const repo=await this.auth.github.repo(token,repository.id);
      if(repo.id!==repository.id||!repo.private)throw new ApiError(403,'Webhook repository is unavailable');
      await this.reconcileTree(p,repo,token);
    }
  }
  private async reconcileTree(p:ProjectRow,repo:Repository,token:string):Promise<void>{
    const head=await this.auth.github.head(token,repo,p.branch);const tree=await this.auth.github.tree(token,repo,head);
    await this.tx(async db=>{await db.query('select id from collaboration.github_projects where id=$1 for update',[p.id]);
      const current=(await db.query<ProjectRow>('select * from collaboration.github_projects where id=$1',[p.id])).rows[0]!;
      await db.query('update collaboration.github_projects set repo_owner=$2,repo_name=$3 where id=$1',[p.id,repo.owner.login,repo.name]);
      if(current.head_sha===head||current.head_sha!==p.head_sha)return;
      if((await db.query("select 1 from collaboration.github_publications where project_id=$1 and status in ('prepared','pushing')",[p.id])).rowCount)return;
      await this.syncMetadata(db,p,tree,head);await this.notify(db,p.id);
    });
  }
  async files(projectId:string,userId:string):Promise<GitFileMetadata[]>{
    await this.recoverExpired(projectId,userId);await this.reconcile(projectId,userId);
    return (await this.pool.query<GitFileMetadata>(`select f.id,f.project_id as "projectId",f.path,f.blob_sha as "blobSha",f.encoding,f.version,f.updated_at::text as "updatedAt",case when l.expires_at>now() then json_build_object('id',u.id,'displayName',u.display_name,'expiresAt',l.expires_at::text) else null end as editor from collaboration.github_files f left join collaboration.github_leases l on l.file_id=f.id left join collaboration.profiles u on u.id=l.user_id where f.project_id=$1 and not f.deleted order by f.path`,[projectId])).rows;
  }
  async file(id:string):Promise<GitFileMetadata>{const f=(await this.pool.query<GitFileMetadata>(`select id,project_id as "projectId",path,blob_sha as "blobSha",encoding,version,updated_at::text as "updatedAt",null as editor from collaboration.github_files where id=$1`,[id])).rows[0];if(!f)throw new ApiError(404,'File not found');return f;}
  async acquire(id:string,userId:string,blobSha:string,version:number){
    const f=await this.file(id);await this.reconcile(f.projectId,userId);const {p,repo,token:githubToken}=await this.access(f.projectId,userId,true);
    const head=await this.auth.github.head(githubToken,repo,p.branch);const tree=await this.auth.github.tree(githubToken,repo,head);
    if(tree.find(e=>e.path===f.path)?.sha!==blobSha)throw new ApiError(409,'Synchronize the newer version before requesting Edit');
    return this.tx(async db=>{
      await db.query('select id from collaboration.github_projects where id=$1 for update',[f.projectId]);
      if((await db.query("select 1 from collaboration.github_publications where project_id=$1 and status in ('prepared','pushing') and changes @> $2::jsonb",[f.projectId,JSON.stringify([{path:f.path}])])).rowCount)throw new ApiError(409,'This file has an unfinished publication. Retry after it is confirmed.');
      const latest=(await db.query<{blob_sha:string;version:number}>('select blob_sha,version from collaboration.github_files where id=$1 for update',[id])).rows[0];
      if(!latest||latest.blob_sha!==blobSha||latest.version!==version)throw new ApiError(409,'Synchronize the newer version before requesting Edit');
      if(f.encoding==='base64'||f.path.endsWith('/.gitkeep'))throw new ApiError(400,'This resource cannot be edited as text');
      const token=randomUUID();
      const row=(await db.query<{expiresAt:string}>(`insert into collaboration.github_leases values($1,$2,$3,$4,$5,now()+make_interval(secs=>$6)) on conflict(file_id) do update set user_id=excluded.user_id,token=excluded.token,blob_sha=excluded.blob_sha,version=excluded.version,expires_at=excluded.expires_at where github_leases.expires_at<=now() returning expires_at::text as "expiresAt"`,[id,userId,token,blobSha,version,this.leaseSeconds])).rows[0];
      if(!row)throw new ApiError(409,'Someone else is editing this file');await this.notify(db,f.projectId);return {token,...row,file:{...f,editor:{id:userId,displayName:'You',expiresAt:row.expiresAt}}};
    });
  }
  async renew(id:string,userId:string,token:string){const f=await this.file(id);await this.access(f.projectId,userId,true);const r=(await this.pool.query<{expiresAt:string}>(`update collaboration.github_leases l set expires_at=now()+make_interval(secs=>$4) from collaboration.github_files f where l.file_id=$1 and f.id=l.file_id and l.user_id=$2 and l.token=$3 and l.expires_at>now() and l.blob_sha=f.blob_sha and l.version=f.version and not f.deleted returning l.expires_at::text as "expiresAt"`,[id,userId,token,this.leaseSeconds])).rows[0];if(!r)throw new ApiError(409,'Edit access has expired or a newer version exists');return r;}
  async release(id:string,userId:string,token:string):Promise<void>{const f=await this.file(id);await this.access(f.projectId,userId);await this.tx(async db=>{await db.query('delete from collaboration.github_leases where file_id=$1 and user_id=$2 and token=$3',[id,userId,token]);await this.notify(db,f.projectId);});}
  async ticket(projectId:string,requestId:string,userId:string):Promise<Publication|null>{await this.access(projectId,userId);return (await this.pool.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2 and user_id=$3`,[projectId,requestId,userId])).rows[0]??null;}
  async prepare(projectId:string,userId:string,input:{requestId:string;changes:PublishChange[];leases:Record<string,string>;baseSha:string|null}):Promise<PublishTicket>{
    const {p}=await this.access(projectId,userId,true);
    input.changes.forEach(c=>{validateGitPath(c.path);if((/\.(tex|bib|sty|cls|bst|ltx|md|txt|gitkeep)$/i.test(c.path))!==(c.encoding==='utf8'))throw new ApiError(400,'File encoding does not match its type');});
    if(!input.changes.length||new Set(input.changes.map(c=>c.path)).size!==input.changes.length)throw new ApiError(400,'Publication paths must be unique');
    const fingerprint=hash(JSON.stringify({changes:input.changes,leases:input.leases}));
    const previous=await this.ticket(projectId,input.requestId,userId);
    if(previous){if(previous.fingerprint!==fingerprint)throw new ApiError(409,'Publication request ID was already used');return previous;}
    await this.recoverExpired(projectId,userId);await this.reconcile(projectId,userId);
    const {repo,token}=await this.access(projectId,userId,true);
    const actualHead=await this.auth.github.head(token,repo,p.branch);
    const actualTree=await this.auth.github.tree(token,repo,actualHead);
    return this.tx(async db=>{
      const row=(await db.query<ProjectRow>('select * from collaboration.github_projects where id=$1 for update',[projectId])).rows[0]!;
      if(row.head_sha!==input.baseSha||actualHead!==input.baseSha)throw new ApiError(409,'Remote has a newer version. Synchronize and retry.');
      const existing=(await db.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2`,[projectId,input.requestId])).rows[0];
      if(existing){if(existing.userId!==userId||existing.fingerprint!==fingerprint)throw new ApiError(409,'Publication request ID was already used');return existing;}
      if((await db.query("select 1 from collaboration.github_publications where project_id=$1 and status in ('prepared','pushing')",[projectId])).rowCount)throw new ApiError(409,'Another publication is in progress. Keep your draft and retry Done.');
      if(!row.head_sha&&row.owner_id!==userId)throw new ApiError(403,'The project owner must publish the initial import');
      const authorizedLeases=new Set<string>();
      for(const c of input.changes){
        if((await db.query(`select 1 from collaboration.github_files where project_id=$1 and (left(path,char_length($2)+1)=$2||'/' or left($2,char_length(path)+1)=path||'/')`,[projectId,c.path])).rowCount||input.changes.some(other=>other.path!==c.path&&(other.path.startsWith(`${c.path}/`)||c.path.startsWith(`${other.path}/`))))throw new ApiError(409,'A file path cannot also be a folder');
        const file=(await db.query<{id:string;blob_sha:string;version:number}>('select * from collaboration.github_files where project_id=$1 and path=$2 and not deleted for update',[projectId,c.path])).rows[0];
        if(file&&actualTree.find(e=>e.path===c.path)?.sha!==file.blob_sha)throw new ApiError(409,'Remote has a newer version of this file. Request Edit again after synchronization.');
        if(file){authorizedLeases.add(file.id);const lease=(await db.query('select 1 from collaboration.github_leases where file_id=$1 and user_id=$2 and token=$3 and expires_at>now() and blob_sha=$4 and version=$5',[file.id,userId,input.leases[file.id]??null,file.blob_sha,file.version])).rowCount;if(!lease)throw new ApiError(409,'Edit access has expired or the file has a newer version');if(file.blob_sha===c.blobSha)throw new ApiError(400,'No changes to publish');}
        else if(input.leases[c.path])throw new ApiError(409,'Invalid edit lease');
      }
      if(Object.keys(input.leases).some(id=>!authorizedLeases.has(id)))throw new ApiError(409,'Edit access has expired or the file has a newer version');
      await db.query(`insert into collaboration.github_publications(project_id,request_id,user_id,fingerprint,base_sha,changes,lease_tokens,status,expires_at) values($1,$2,$3,$4,$5,$6,$7,'prepared',now()+interval '2 minutes')`,[projectId,input.requestId,userId,fingerprint,row.head_sha,JSON.stringify(input.changes),JSON.stringify(input.leases)]);
      return (await db.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2`,[p.id,input.requestId])).rows[0]!;
    });
  }
  async attach(projectId:string,userId:string,requestId:string,sha:string):Promise<PublishTicket>{
    const ticket=await this.ticket(projectId,requestId,userId);if(!ticket)throw new ApiError(404,'Publication not found');
    if(ticket.commitSha&&ticket.commitSha!==sha)throw new ApiError(409,'Publication commit is already fixed');
    if(ticket.status==='confirmed')return ticket;
    await this.tx(async db=>{
      await db.query('select id from collaboration.github_projects where id=$1 for update',[projectId]);
      const current=(await db.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2 for update`,[projectId,requestId])).rows[0]!;
      if(!['prepared','pushing'].includes(current.status)||Date.parse(current.expiresAt)<=Date.now())throw new ApiError(409,'Publication turn expired. Synchronize and obtain Edit again.');
      for(const [fileId,leaseToken] of Object.entries(current.leaseTokens)){
        if(!(await db.query(`select 1 from collaboration.github_leases l join collaboration.github_files f on f.id=l.file_id where l.file_id=$1 and l.user_id=$2 and l.token=$3 and l.expires_at>now() and l.blob_sha=f.blob_sha and l.version=f.version`,[fileId,userId,leaseToken])).rowCount)throw new ApiError(409,'Edit access has expired or a newer version exists');
      }
      const r=await db.query(`update collaboration.github_publications set commit_sha=$4,status='pushing' where project_id=$1 and request_id=$2 and user_id=$3 and (commit_sha is null or commit_sha=$4)`,[projectId,requestId,userId,sha]);
      if(!r.rowCount)throw new ApiError(409,'Publication commit is already fixed');
    });return (await this.ticket(projectId,requestId,userId))!;
  }

  async confirm(projectId:string,userId:string,requestId:string,recoveryUserId?:string):Promise<PublishTicket>{
    const {p,repo,token}=await this.access(projectId,recoveryUserId??userId,!recoveryUserId);const ticket=recoveryUserId?(await this.pool.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2 and user_id=$3`,[projectId,requestId,userId])).rows[0]??null:await this.ticket(projectId,requestId,userId);
    if(!ticket)throw new ApiError(404,'Publication not found');if(ticket.status==='confirmed')return ticket;
    if(!ticket.commitSha||ticket.status!=='pushing')throw new ApiError(409,'Publication is not ready for verification');
    const head=await this.auth.github.head(token,repo,p.branch);
    if(head!==ticket.commitSha&&(!head||!await this.auth.github.isAncestor(token,repo,ticket.commitSha,head)))throw new ApiError(409,'Remote changed or the publication was not pushed. Your draft is preserved.');
    const commit=await this.auth.github.api<{sha:string;parents:{sha:string}[];message:string}>(token,`${this.auth.github.route(repo)}/git/commits/${ticket.commitSha}`);
    const [before,after]=await Promise.all([this.auth.github.tree(token,repo,ticket.baseSha),this.auth.github.tree(token,repo,ticket.commitSha)]);
    verifyPublication(ticket,before,after,commit,ticket.commitSha);
    const latest=head===ticket.commitSha?after:await this.auth.github.tree(token,repo,head);
    if(p.legacy_project_id&&!p.head_sha){const manifest=(await this.pool.query<{manifest:PublishChange[]}>('select manifest from collaboration.github_migrations where project_id=$1',[p.id])).rows[0]?.manifest;
      if(!manifest||manifest.length!==after.length||manifest.some(m=>!after.some(a=>a.path===m.path&&a.sha===m.blobSha&&a.mode==='100644')))throw new ApiError(409,'Migration GitHub tree does not match the preserved export');
    }
    await this.tx(async db=>{
      await db.query('select id from collaboration.github_projects where id=$1 for update',[projectId]);
      const current=(await db.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2 for update`,[projectId,requestId])).rows[0]!;
      if(current.status==='confirmed')return;
      if(current.status!=='pushing'||current.commitSha!==ticket.commitSha)throw new ApiError(409,'Publication was superseded');
      await this.syncMetadata(db,p,latest,head);
      await db.query(`update collaboration.github_publications set status='confirmed' where project_id=$1 and request_id=$2`,[projectId,requestId]);
      for(const [fileId,leaseToken] of Object.entries(current.leaseTokens))await db.query('delete from collaboration.github_leases where file_id=$1 and user_id=$2 and token=$3',[fileId,userId,leaseToken]);
      if(p.legacy_project_id)await db.query('update collaboration.github_migrations set verified_sha=$2,updated_at=now() where project_id=$1 and verified_sha is null',[p.id,ticket.commitSha]);
      await this.notify(db,projectId);
    });return (await this.pool.query<Publication>(`${publicationSelect} where project_id=$1 and request_id=$2 and user_id=$3`,[projectId,requestId,userId])).rows[0]!;
  }
  async recoverExpired(projectId:string,userId:string):Promise<void>{
    const {p,repo,token}=await this.access(projectId,userId);
    const ticket=(await this.pool.query<Publication>(`${publicationSelect} where project_id=$1 and status in ('prepared','pushing') and expires_at<=now()`,[projectId])).rows[0];if(!ticket)return;
    const head=await this.auth.github.head(token,repo,p.branch);
    if(ticket.commitSha&&head&&(head===ticket.commitSha||await this.auth.github.isAncestor(token,repo,ticket.commitSha,head))){await this.confirm(projectId,ticket.userId,ticket.requestId,userId);return;}
    // An unpublished old commit can be abandoned only after any issued credential is fenced out.
    if((await this.pool.query('select 1 from collaboration.github_publications where project_id=$1 and request_id=$2 and fence_until>now()',[projectId,ticket.requestId])).rowCount)throw new ApiError(409,'Waiting for the expired publication Git credential to expire. Your draft is preserved.');
    await this.tx(async db=>{await db.query('select id from collaboration.github_projects where id=$1 for update',[projectId]);await db.query(`update collaboration.github_publications set status='aborted' where project_id=$1 and request_id=$2 and status in ('prepared','pushing') and expires_at<=now()`,[projectId,ticket.requestId]);await this.notify(db,projectId);});
  }
  async credentials(projectId:string,userId:string,write:boolean,requestId?:string){
    const {repo}=await this.access(projectId,userId,write);
    if(write){if(!requestId)throw new ApiError(400,'A publication request is required');const t=await this.ticket(projectId,requestId,userId);if(!t||t.status!=='pushing'||Date.parse(t.expiresAt)<=Date.now())throw new ApiError(409,'Publication turn expired');}
    const c=await this.auth.github.gitToken(repo,write);
    if(write){const updated=await this.pool.query(`update collaboration.github_publications set fence_until=greatest(fence_until,$4::timestamptz+interval '1 minute') where project_id=$1 and request_id=$2 and user_id=$3 and status='pushing' and expires_at>now()`,[projectId,requestId,userId,c.expires_at]);if(!updated.rowCount)throw new ApiError(409,'Publication turn expired');}
    return {...c,url:`https://github.com/${repo.owner.login}/${repo.name}.git`};
  }
  async invite(projectId:string,userId:string,login:string,role:'editor'|'viewer'):Promise<void>{
    const {repo,token}=await this.access(projectId,userId,true,true);
    if(role==='viewer')throw new ApiError(400,'Private repositories owned by a personal account grant collaborators write access. View only invitations are unavailable.');
    const user=await this.auth.github.api<{id:number;login:string}>(token,`/users/${encodeURIComponent(login)}`);
    const invitation=await this.auth.github.api<{id:number}|undefined>(token,`${this.auth.github.route(repo)}/collaborators/${encodeURIComponent(user.login)}`,'PUT',{permission:'push'});
    await this.pool.query(`insert into collaboration.github_invitations(project_id,github_id,github_login,github_invitation_id,role) values($1,$2,$3,$4,$5) on conflict(project_id,github_id) do update set github_invitation_id=excluded.github_invitation_id,role=excluded.role`,[projectId,user.id,user.login,invitation?.id??null,role]);
  }
  async invitations(account:Account):Promise<ProjectInvitation[]>{return (await this.pool.query<ProjectInvitation>(`select i.id,i.project_id as "projectId",p.name as "projectName",i.role from collaboration.github_invitations i join collaboration.github_projects p on p.id=i.project_id where i.github_id=$1`,[account.githubId])).rows;}
  async accept(id:string,account:Account):Promise<void>{
    const i=(await this.pool.query<{project_id:string;github_invitation_id:string|null;role:string}>('select * from collaboration.github_invitations where id=$1 and github_id=$2',[id,account.githubId])).rows[0];if(!i)throw new ApiError(404,'Invitation not found');
    const token=await this.auth.credentials(account.id);
    if(i.github_invitation_id){try{await this.auth.github.api(token,`/user/repository_invitations/${i.github_invitation_id}`,'PATCH');}catch(e){if(!(e instanceof ApiError)||e.statusCode!==404)throw e;}}
    const p=await this.row(i.project_id);const repo=await this.auth.github.repo(token,Number(p.repo_id));if(!repo.permissions?.pull||i.role==='editor'&&!repo.permissions.push)throw new ApiError(403,'Accept the GitHub invitation and install the App for this repository before opening it');
    await this.tx(async db=>{await db.query('insert into collaboration.github_members values($1,$2,$3) on conflict(project_id,user_id) do update set role=excluded.role',[i.project_id,account.id,i.role]);await db.query('delete from collaboration.github_invitations where id=$1',[id]);});
  }
}
