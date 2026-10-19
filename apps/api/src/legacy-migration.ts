import type { Account } from '@easy-latex/shared-types';
interface LegacyAuth {auth:{signInWithOtp(input:{email:string;options:{shouldCreateUser:boolean}}):Promise<{error:unknown}>;verifyOtp(input:{email:string;token:string;type:'email'}):Promise<{error:unknown;data:{user:{id:string}|null}}>;}}
import type { ProjectFileInput, SharedProject } from '@easy-latex/shared-types';
import { createHash } from 'node:crypto';
import type { GitHubStore } from './github-store';
import type { AssetStore } from './assets';
import { ApiError } from './store';
const blob=(bytes:Buffer)=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
/** Explicit legacy proof. This optional bridge is not used by normal GitHub authentication. */
export class LegacyMigration {
  constructor(private readonly store:GitHubStore,private readonly legacyAuth:LegacyAuth,private readonly assets:AssetStore){}
  async sendCode(email:string):Promise<void>{const {error}=await this.legacyAuth.auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error)throw new ApiError(400,'Legacy account confirmation could not be sent');}
  async link(account:Account,email:string,code:string):Promise<void>{
    const {data,error}=await this.legacyAuth.auth.verifyOtp({email,token:code,type:'email'});
    if(error||!data.user?.id)throw new ApiError(401,'Legacy account confirmation failed');
    const profile=(await this.store.pool.query('select 1 from collaboration.profiles where id=$1 and github_id is null',[data.user.id])).rowCount;
    if(!profile)throw new ApiError(404,'No legacy account was found');
    await this.store.pool.query('insert into collaboration.github_legacy_links(github_user_id,legacy_user_id) values($1,$2) on conflict do nothing',[account.id,data.user.id]);
  }
  async projects(account:Account):Promise<SharedProject[]>{return (await this.store.pool.query<SharedProject>(`select p.id,p.name,m.role from collaboration.projects p join collaboration.members m on m.project_id=p.id join collaboration.github_legacy_links l on l.legacy_user_id=m.user_id where l.github_user_id=$1 and m.role='owner' order by p.name`,[account.id])).rows;}
  async export(account:Account,id:string,requestId:string):Promise<{project:SharedProject;files:ProjectFileInput[];directories:string[];limitations:string}>{
    const legacy=(await this.projects(account)).find(p=>p.id===id);if(!legacy)throw new ApiError(403,'Confirm ownership of the legacy account first');
    const active=(await this.store.pool.query('select 1 from collaboration.leases l join collaboration.files f on f.id=l.file_id where f.project_id=$1 and l.expires_at>now()',[id])).rowCount;
    if(active)throw new ApiError(409,'Wait for active legacy edits to finish before exporting');
    const project=await this.store.create(account,{name:legacy.name,requestId,legacyProjectId:id});
    const files=(await this.store.pool.query<ProjectFileInput>('select path,content,encoding from collaboration.files where project_id=$1 order by path',[id])).rows;
    for(const f of files)if(f.encoding==='base64')f.content=(await this.assets.read(f.content)).toString('base64');
    const history=(await this.store.pool.query<{id:string;path:string;version:number;content:string;encoding:string;author:string;createdAt:string}>(`select r.id,f.path,r.version,r.content,r.encoding,p.display_name as author,r.created_at::text as "createdAt" from collaboration.revisions r join collaboration.files f on f.id=r.file_id join collaboration.profiles p on p.id=r.author_id where f.project_id=$1 order by f.path,r.version`,[id])).rows;
    for(const r of history)if(r.encoding==='base64')r.content=(await this.assets.read(r.content)).toString('base64');
    // Preserve all retrievable versions in GitHub, with authors/time, without inventing project-wide commits.
    for(const r of history)files.push({path:`legacy-history-${id}/${r.id}.txt`,content:JSON.stringify(r,null,2),encoding:'utf8'});
    const directories=(await this.store.pool.query<{path:string}>('select path from collaboration.directories where project_id=$1',[id])).rows.map(d=>d.path);
    const manifest=files.map(f=>({path:f.path,blobSha:blob(Buffer.from(f.content,f.encoding==='base64'?'base64':'utf8')),encoding:f.encoding??'utf8'}));
    for(const d of directories)if(!files.some(f=>f.path.startsWith(`${d}/`))&&!directories.some(other=>other!==d&&other.startsWith(`${d}/`)))manifest.push({path:`${d}/.gitkeep`,blobSha:blob(Buffer.alloc(0)),encoding:'utf8'});
    const limitations='Per-file revisions are preserved as legacy-history text archives with original authors and dates. Original server Git commit SHAs and project-wide chronology are retained in the old system, not rewritten. Existing member permissions must be re-invited through GitHub. No old data is removed.';
    const inserted=await this.store.pool.query(`insert into collaboration.github_migrations(legacy_project_id,project_id,manifest,limitations) values($1,$2,$3,$4) on conflict(legacy_project_id) do nothing`,[id,project.id,JSON.stringify(manifest),limitations]);
    if(!inserted.rowCount){const prior=(await this.store.pool.query<{project_id:string;manifest:unknown}>('select project_id,manifest from collaboration.github_migrations where legacy_project_id=$1',[id])).rows[0]!;if(prior.project_id!==project.id||JSON.stringify(prior.manifest)!==JSON.stringify(manifest))throw new ApiError(409,'Legacy data changed after the migration was reserved. Restore the saved export before retrying.');}
    return {project,files,directories,limitations};
  }
}
