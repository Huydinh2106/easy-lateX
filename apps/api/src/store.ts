import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AssetStore } from './assets';
import type { Pool, PoolClient } from 'pg';
import type { Account, ProjectFileInput, DoneInput, EditLease, FileRevision, ProjectInvitation, SharedFile, SharedProject, SharedProjectInput } from '@easy-latex/shared-types';

export class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export function validateDirectoryPath(value: string): string {
  if (!value || value.length > 512 || value.includes('\\') || [...value].some(c => c.charCodeAt(0) < 32) || path.posix.isAbsolute(value)) throw new ApiError(400, 'Invalid file path');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p === '.git' || p === '.easy-latex' || p === 'node_modules' || /[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new ApiError(400, 'Invalid file path');
  return value;
}
export function validateFilePath(value: string): string {
  validateDirectoryPath(value);
  if (!/\.(tex|bib|sty|cls|bst|ltx|md|txt|png|jpg|jpeg|svg|pdf|eps|otf|ttf|woff|woff2)$/i.test(value)) throw new ApiError(400, 'Unsupported project file type');
  return value;
}

function validateTree(filePaths: string[], directories: string[]): void {
  const files = new Set(filePaths);
  if (files.size !== filePaths.length) throw new ApiError(409, 'This file already exists');
  for (const entry of [...filePaths, ...directories]) {
    const parts = entry.split('/');
    if (directories.includes(entry) && files.has(entry)) throw new ApiError(409, 'A file path cannot also be a folder');
    for (let n = 1; n < parts.length; n++) {
      if (files.has(parts.slice(0, n).join('/'))) throw new ApiError(409, 'A file path cannot also be a folder');
    }
  }
}
const FILE_SELECT = `select f.encoding, f.id, f.project_id as "projectId", f.path, f.content, f.version,
  f.updated_at::text as "updatedAt", case when l.expires_at > clock_timestamp() then
  json_build_object('id',p.id,'displayName',p.display_name,'expiresAt',l.expires_at::text) else null end as editor
  from collaboration.files f left join collaboration.leases l on l.file_id=f.id
  left join collaboration.profiles p on p.id=l.user_id`;

export class CollaborationStore {
  constructor(public readonly pool: Pool, private readonly leaseSeconds = 90, private readonly assets?: AssetStore, private readonly historyQueue = "default") {}
  private async materialize(file:SharedFile):Promise<SharedFile> {
    if(file.encoding!=="base64")return file;
    if(!this.assets)throw new ApiError(503,"Attachment storage is unavailable");
    return {...file,content:(await this.assets.read(file.content)).toString("base64")};
  }
  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try { await db.query('begin'); const value = await fn(db); await db.query('commit'); return value; }
    catch (e) { await db.query('rollback'); throw e; } finally { db.release(); }
  }
  private async notify(db: PoolClient, projectId: string): Promise<void> {
    // PostgreSQL delivers this only after commit, including to other API instances.
    await db.query("select pg_notify('easy_latex_project_changed',$1)", [projectId]);
  }
  async profile(account: Account): Promise<void> {
    await this.pool.query(`insert into collaboration.profiles(id,email,display_name) values($1,$2,$3)
      on conflict(id) do update set email=excluded.email,display_name=excluded.display_name`, [account.id, account.email.toLowerCase(), account.displayName]);
  }
  async member(db: Pool | PoolClient, projectId: string, userId: string, edit = false, owner = false): Promise<SharedProject['role']> {
    const row = (await db.query<{ role: SharedProject['role'] }>('select role from collaboration.members where project_id=$1 and user_id=$2', [projectId, userId])).rows[0];
    if (!row || (edit && row.role === 'viewer') || (owner && row.role !== 'owner')) throw new ApiError(403, 'You do not have permission for this project');
    return row.role;
  }
  async file(db: Pool | PoolClient, id: string, userId: string, edit = false, lock = false): Promise<SharedFile> {
    if (lock) await db.query('select id from collaboration.files where id=$1 for update', [id]);
    const f = (await db.query<SharedFile>(`${FILE_SELECT} where f.id=$1`, [id])).rows[0];
    if (!f) throw new ApiError(404, 'File not found');
    await this.member(db, f.projectId, userId, edit);
    return f;
  }
  async projects(userId: string): Promise<SharedProject[]> {
    return (await this.pool.query<SharedProject>(`select p.id,p.name,m.role from collaboration.projects p
      join collaboration.members m on m.project_id=p.id where m.user_id=$1 order by p.created_at desc`, [userId])).rows;
  }
  private async enqueue(db: PoolClient, projectId: string, author: Account): Promise<void> {
    await db.query(`insert into collaboration.git_jobs(project_id,snapshot,author_name,author_email,queue)
      select $1,coalesce(jsonb_agg(jsonb_build_object('path',path,'content',content,'encoding',encoding) order by path),'[]'::jsonb),$2,$3,$4
      from collaboration.files where project_id=$1`, [projectId, author.displayName, author.email, this.historyQueue]);
  }
  async create(account: Account, input: SharedProjectInput): Promise<SharedProject> {
    const previous = async (db:Pool|PoolClient) => input.requestId ? (await db.query<SharedProject>(`select id,name,'owner' as role from collaboration.projects where owner_id=$1 and creation_request_id=$2`, [account.id,input.requestId])).rows[0] : undefined;
    const existing=await previous(this.pool);
    if(existing)return existing;
    const entries:ProjectFileInput[] = input.files ?? [{ path: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\nStart writing here.\n\\end{document}\n' }];
    if (!entries.length || entries.length > 1000) throw new ApiError(400, 'Project is empty or too large');
    const seen = new Set<string>();
    for (const f of entries) { validateFilePath(f.path); if (seen.has(f.path)) throw new ApiError(400, 'Duplicate file path'); seen.add(f.path); }
    for(const filePath of seen){const parts=filePath.split('/');for(let i=1;i<parts.length;i++)if(seen.has(parts.slice(0,i).join('/')))throw new ApiError(400,'A file path cannot also be a folder');}
    const directories = input.directories ?? [];
    if (directories.length > 1000) throw new ApiError(400, 'Project contains too many folders');
    directories.forEach(validateDirectoryPath);
    validateTree([...seen], directories);
    const prepared: {path:string;content:string;encoding:'utf8'|'base64';size:number}[]=[];
    const uploaded:string[]=[];
    let reused=false;
    try {
      for(const f of entries) {
        const encoding=f.encoding??'utf8';
        const source=/\.(tex|bib|sty|cls|bst|ltx|md|txt)$/i.test(f.path);
        if(source!== (encoding==='utf8'))throw new ApiError(400,'File encoding does not match its type');
        const bytes=encoding==='base64'?Buffer.from(f.content,'base64'):Buffer.from(f.content,'utf8');
        if((encoding==='utf8' && (bytes.length>5*1024*1024 || f.content.includes('\0'))) || bytes.length>10*1024*1024 || (encoding==='base64' && bytes.toString('base64')!==f.content))throw new ApiError(400,'Attachment is invalid or too large');
        let value=f.content;
        if(encoding==='base64') {if(!this.assets)throw new ApiError(503,'Attachment storage is unavailable');value=randomUUID();await this.assets.upload(value,bytes);uploaded.push(value);}
        prepared.push({path:f.path,content:value,encoding,size:bytes.length});
      }
      if(prepared.reduce((sum,f)=>sum+f.size,0)>20*1024*1024)throw new ApiError(400,'Project is too large');
      const project=await this.transaction(async db => {
      if(input.requestId){
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`create:${account.id}:${input.requestId}`]);
        const found=await previous(db);if(found){reused=true;return found;}
      }
      const p = (await db.query<SharedProject>(`insert into collaboration.projects(name,owner_id,creation_request_id) values($1,$2,$3) returning id,name,'owner' as role`, [input.name, account.id,input.requestId??null])).rows[0]!;
      await db.query(`insert into collaboration.members values($1,$2,'owner')`, [p.id, account.id]);
      for (const directory of new Set(directories)) await db.query('insert into collaboration.directories(project_id,path) values($1,$2)', [p.id,directory]);
      for (const f of prepared) {
        const inserted = (await db.query<{ id: string }>('insert into collaboration.files(project_id,path,content,encoding,size_bytes) values($1,$2,$3,$4,$5) returning id', [p.id, f.path, f.content,f.encoding,f.size])).rows[0]!;
        await db.query('insert into collaboration.revisions(file_id,version,content,author_id,request_id,encoding) values($1,1,$2,$3,gen_random_uuid(),$4)', [inserted.id, f.content, account.id,f.encoding]);
      }
      await this.enqueue(db, p.id, account);
      return p;
      });
      if(reused&&uploaded.length)await this.assets?.remove(uploaded).catch(()=>undefined);
      return project;
    } catch(error) { if(uploaded.length)await this.assets?.remove(uploaded).catch(()=>undefined);throw error; }
  }
  async files(projectId: string, userId: string): Promise<SharedFile[]> {
    await this.member(this.pool, projectId, userId);
    return Promise.all((await this.pool.query<SharedFile>(`${FILE_SELECT} where f.project_id=$1 order by f.path`, [projectId])).rows.map(f=>this.materialize(f)));
  }
  async createFile(projectId: string, account: Account, filePath: string): Promise<SharedFile> {
    validateFilePath(filePath);
    if(!/\.(tex|bib|sty|cls|bst|ltx|md|txt)$/i.test(filePath))throw new ApiError(400,'Create a source text file, or import attachments with a project folder');
    return this.transaction(async db => {
      await this.member(db, projectId, account.id, true);
      await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [projectId]);
      if ((await db.query('select path from collaboration.directories where project_id=$1 and (path=$2 or left(path,char_length($2)+1)=$2||\'/\')',[projectId,filePath])).rowCount) throw new ApiError(409,'A file path cannot also be a folder');
      const collision=(await db.query(`select id from collaboration.files where project_id=$1 and (left(path,char_length($2)+1)=$2||'/' or left($2,char_length(path)+1)=path||'/')`,[projectId,filePath])).rowCount;
      if(collision)throw new ApiError(409,'A file path cannot also be a folder');
      const count = (await db.query<{ count: number }>('select count(*)::int as count from collaboration.files where project_id=$1', [projectId])).rows[0]!.count;
      if (count >= 1000) throw new ApiError(400, 'Project contains too many files');
      const inserted = (await db.query<{ id: string }>('insert into collaboration.files(project_id,path) values($1,$2) returning id', [projectId, filePath])).rows[0]!;
      await db.query(`insert into collaboration.revisions(file_id,version,content,author_id,request_id) values($1,1,'',$2,gen_random_uuid())`, [inserted.id, account.id]);
      await this.enqueue(db, projectId, account);
      await this.notify(db, projectId);
      return this.file(db, inserted.id, account.id);
    });
  }
  async directories(projectId: string, userId: string): Promise<string[]> {
    await this.member(this.pool, projectId, userId);
    return (await this.pool.query<{path:string}>('select path from collaboration.directories where project_id=$1 order by path',[projectId])).rows.map(row=>row.path);
  }
  async createDirectory(projectId: string, account: Account, directory: string): Promise<string> {
    validateDirectoryPath(directory);
    await this.importEntries(projectId, account, [], [directory]);
    return directory;
  }
  async importEntries(projectId: string, account: Account, entries: ProjectFileInput[], directories: string[] = []): Promise<string[]> {
    await this.member(this.pool, projectId, account.id, true);
    if ((!entries.length && !directories.length) || entries.length > 1000 || directories.length > 1000) throw new ApiError(400,'Import is empty or too large');
    entries.forEach(f=>validateFilePath(f.path));
    directories.forEach(validateDirectoryPath);
    validateTree(entries.map(f=>f.path), directories);
    const prepared = entries.map(f=>{
      const encoding = f.encoding ?? 'utf8';
      const source = /\.(tex|bib|sty|cls|bst|ltx|md|txt)$/i.test(f.path);
      if (source !== (encoding === 'utf8')) throw new ApiError(400,'File encoding does not match its type');
      const bytes = Buffer.from(f.content, encoding === 'base64' ? 'base64' : 'utf8');
      if (bytes.length > (source ? 5 : 10)*1024*1024 || (source && f.content.includes('\0')) || (!source && bytes.toString('base64') !== f.content)) throw new ApiError(400,'File is invalid or too large');
      return {...f,encoding,bytes};
    });
    const size = prepared.reduce((sum,f)=>sum+f.bytes.length,0);
    if (size > 20*1024*1024) throw new ApiError(400,'Project is too large');
    const uploaded: string[] = [];
    try {
      const stored: {path:string;content:string;encoding:'utf8'|'base64';size:number}[] = [];
      // Upload immutable bytes before taking the project lock; a slow Storage
      // request must not block Done or hold a database transaction open.
      for (const f of prepared) {
        let content = f.content;
        if (f.encoding === 'base64') {
          if (!this.assets) throw new ApiError(503,'Attachment storage is unavailable');
          content = randomUUID();await this.assets.upload(content,f.bytes);uploaded.push(content);
        }
        stored.push({path:f.path,content,encoding:f.encoding,size:f.bytes.length});
      }
      // Serialize additions and Done on the project, so limits and collisions cannot race.
      return await this.transaction(async db=>{
        await this.member(db, projectId, account.id, true);
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[projectId]);
        const existing = (await db.query<{path:string;size_bytes:number}>('select path,size_bytes from collaboration.files where project_id=$1',[projectId])).rows;
        const existingDirectories = (await db.query<{path:string}>('select path from collaboration.directories where project_id=$1',[projectId])).rows.map(f=>f.path);
        const allDirectories = [...new Set([...existingDirectories,...directories])];
        validateTree([...existing.map(f=>f.path),...entries.map(f=>f.path)],allDirectories);
        if (existing.length+entries.length > 1000 || allDirectories.length > 1000) throw new ApiError(400,'Project contains too many files or folders');
        if (existing.reduce((sum,f)=>sum+Number(f.size_bytes),0)+size > 20*1024*1024) throw new ApiError(400,'Project is too large');
        for (const f of stored) {
          const inserted = (await db.query<{id:string}>('insert into collaboration.files(project_id,path,content,encoding,size_bytes) values($1,$2,$3,$4,$5) returning id',[projectId,f.path,f.content,f.encoding,f.size])).rows[0]!;
          await db.query('insert into collaboration.revisions(file_id,version,content,author_id,request_id,encoding) values($1,1,$2,$3,gen_random_uuid(),$4)',[inserted.id,f.content,account.id,f.encoding]);
        }
        for (const directory of new Set(directories)) await db.query('insert into collaboration.directories(project_id,path) values($1,$2) on conflict do nothing',[projectId,directory]);
        if (entries.length) await this.enqueue(db,projectId,account);
        await this.notify(db, projectId);
        return [...entries.map(f=>f.path),...directories];
      });
    } catch (error) {
      if (uploaded.length) await this.assets?.remove(uploaded).catch(()=>undefined);
      throw error;
    }
  }
  async acquire(fileId: string, userId: string): Promise<EditLease> {
    return this.transaction(async db => {
      const f = await this.file(db, fileId, userId, true, true);
      if(f.encoding!=="utf8")throw new ApiError(400,"Attachments are view-only; edit their source files instead");
      // Every acquire creates a distinct token, even for the same user's second device.
      const lease = (await db.query<{ token: string; expiresAt: string }>(`insert into collaboration.leases(file_id,user_id,token,expires_at)
        values($1,$2,gen_random_uuid(),clock_timestamp()+make_interval(secs=>$3))
        on conflict(file_id) do update set user_id=excluded.user_id,token=excluded.token,expires_at=excluded.expires_at
        where collaboration.leases.expires_at<=clock_timestamp()
        returning token,expires_at::text as "expiresAt"`, [fileId, userId, this.leaseSeconds])).rows[0];
      if (!lease) throw new ApiError(409, `${f.editor?.displayName ?? 'Another person'} is editing this file`);
      await this.notify(db, f.projectId);
      return { ...lease, file: await this.file(db, fileId, userId) };
    });
  }
  async renew(fileId: string, userId: string, token: string): Promise<{ expiresAt: string }> {
    return this.transaction(async db => {
      const file = await this.file(db, fileId, userId, true, true);
      const row = (await db.query<{ expiresAt: string }>(`update collaboration.leases set expires_at=clock_timestamp()+make_interval(secs=>$4)
        where file_id=$1 and user_id=$2 and token=$3 and expires_at>clock_timestamp() returning expires_at::text as "expiresAt"`, [fileId, userId, token, this.leaseSeconds])).rows[0];
      if (!row) throw new ApiError(409, 'Edit access has expired. Your draft is preserved; request Edit again.');
      await this.notify(db, file.projectId);
      return row;
    });
  }
  async release(fileId: string, userId: string, token: string): Promise<void> {
    await this.transaction(async db => {
      const file = await this.file(db, fileId, userId, false, true);
      const released = await db.query('delete from collaboration.leases where file_id=$1 and user_id=$2 and token=$3', [fileId, userId, token]);
      if (released.rowCount) await this.notify(db, file.projectId);
    });
  }
  async done(account: Account, input: DoneInput): Promise<SharedFile> {
    return this.transaction(async db => {
      const f = await this.file(db, input.fileId, account.id, true, true);
      if(f.encoding!=="utf8")throw new ApiError(400,"Attachments are view-only");
      await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [f.projectId]);
      const receipt = (await db.query<{ file_id: string; version: number; content: string }>('select file_id,version,content from collaboration.revisions where author_id=$1 and request_id=$2', [account.id, input.requestId])).rows[0];
      if (receipt) {
        if (receipt.file_id !== input.fileId || receipt.content !== input.content || receipt.version !== input.baseVersion + 1) throw new ApiError(409, 'This request ID was already used for another update');
        // Return the acknowledged revision, not a later editor's content.
        return { ...f, content: receipt.content, version: receipt.version };
      }
      const active = (await db.query<{ token: string }>('select token from collaboration.leases where file_id=$1 and user_id=$2 and token=$3 and expires_at>clock_timestamp()', [f.id, account.id, input.token])).rows[0];
      if (!active) throw new ApiError(409, 'Edit access has expired. Your draft is preserved; request Edit again.');
      if (f.version !== input.baseVersion) throw new ApiError(409, 'The file has a newer version. Review your draft before publishing.');
      const total = (await db.query<{ bytes: number }>('select coalesce(sum(size_bytes),0)::int as bytes from collaboration.files where project_id=$1 and id<>$2', [f.projectId, f.id])).rows[0]!.bytes;
      if (total + Buffer.byteLength(input.content) > 20 * 1024 * 1024) throw new ApiError(400, 'Project is too large');
      await db.query('update collaboration.files set content=$2,size_bytes=octet_length($2),version=version+1,updated_at=clock_timestamp() where id=$1', [f.id, input.content]);
      await db.query('insert into collaboration.revisions(file_id,version,content,author_id,request_id) values($1,$2,$3,$4,$5)', [f.id, f.version + 1, input.content, account.id, input.requestId]);
      await this.enqueue(db, f.projectId, account);
      await db.query('delete from collaboration.leases where file_id=$1', [f.id]);
      await this.notify(db, f.projectId);
      return this.file(db, f.id, account.id);
    });
  }
  async history(fileId: string, userId: string): Promise<FileRevision[]> {
    await this.file(this.pool, fileId, userId);
    return (await this.pool.query<FileRevision>(`select r.id,r.version,r.content,p.display_name as author,r.created_at::text as "createdAt"
      from collaboration.revisions r join collaboration.profiles p on p.id=r.author_id where file_id=$1 order by version desc limit 100`, [fileId])).rows;
  }
  async invite(projectId: string, userId: string, email: string, role: 'editor' | 'viewer'): Promise<void> {
    await this.member(this.pool, projectId, userId, false, true);
    await this.pool.query('insert into collaboration.invitations(project_id,email,role) values($1,$2,$3) on conflict(project_id,email) do update set role=excluded.role', [projectId, email.toLowerCase(), role]);
  }
  async invitations(email: string): Promise<ProjectInvitation[]> {
    return (await this.pool.query<ProjectInvitation>(`select i.id,i.project_id as "projectId",p.name as "projectName",i.role
      from collaboration.invitations i join collaboration.projects p on p.id=i.project_id where i.email=$1`, [email.toLowerCase()])).rows;
  }
  async accept(id: string, account: Account): Promise<void> {
    await this.transaction(async db => {
      const row = (await db.query<{ project_id: string; role: string }>('select project_id,role from collaboration.invitations where id=$1 and email=$2 for update', [id, account.email.toLowerCase()])).rows[0];
      if (!row) throw new ApiError(404, 'Invitation not found');
      await db.query(`insert into collaboration.members values($1,$2,$3) on conflict(project_id,user_id) do nothing`, [row.project_id, account.id, row.role]);
      await db.query('delete from collaboration.invitations where id=$1', [id]);
    });
  }
}
