import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import type { AssetStore } from './assets';
import { validateFilePath } from './store';

const exec = promisify(execFile);
interface GitJob { id: string; project_id: string; snapshot: { path: string; content: string; encoding?:'utf8'|'base64' }[]; author_name: string; author_email: string; }
export class GitWorker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  constructor(private readonly pool: Pool, private readonly directory: string, private readonly assets?: AssetStore, private readonly queue = "default") {}
  start(): void {
    this.timer = setInterval(() => { void this.tick().catch(() => console.error('History worker could not reach the database; it will retry.')); }, 5000);
    this.timer.unref();
    void this.tick().catch(() => console.error('History worker will retry.'));
  }
  async stop(): Promise<void> { clearInterval(this.timer); await this.running; }
  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.process().finally(() => { this.running = null; });
    return this.running;
  }
  private async process(): Promise<void> {
    const db = await this.pool.connect();
    let locked = false;
    try {
      locked = (await db.query<{ locked: boolean }>('select pg_try_advisory_lock(hashtextextended($1,0)) as locked', [`easy-latex-history:${this.queue}`])).rows[0]!.locked;
      if (!locked) return;
      const jobs = (await db.query<GitJob>('select id::text,project_id,snapshot,author_name,author_email from collaboration.git_jobs where completed_at is null and queue=$1 order by id limit 20',[this.queue])).rows;
      for (const job of jobs) {
        try {
          const sha = await this.commit(job);
          await db.query('update collaboration.git_jobs set completed_at=clock_timestamp(),commit_sha=$2,last_error=null where id=$1', [job.id, sha]);
        } catch (error) {
          console.error("History update failed:", error instanceof Error ? error.message : "Unknown failure");
          await db.query(`update collaboration.git_jobs set attempts=attempts+1,last_error='History commit failed; awaiting retry' where id=$1`, [job.id]);
          // Never process a later snapshot ahead of an earlier failed one.
          break;
        }
      }
    } finally {
      if (locked) await db.query('select pg_advisory_unlock(hashtextextended($1,0))', [`easy-latex-history:${this.queue}`]);
      db.release();
    }
  }
  private async commit(job: GitJob): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(job.project_id)) throw new Error('Invalid project ID');
    const root = path.join(path.resolve(this.directory), job.project_id);
    const hooks = path.join(path.resolve(this.directory), '.empty-hooks');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(hooks, { recursive: true, mode: 0o700 });
    const git = async (args: string[]): Promise<string> => (await exec('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', ...args], { cwd: root, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } })).stdout.trim();
    await git(['init', '--quiet']);
    const marker = `Easy-LaTeX-Job: ${job.id}`;
    const lastMessage = await git(['log','-1','--format=%B']).catch(() => '');
    if (lastMessage.split('\n').includes(marker)) return git(['rev-parse','HEAD']);
    // This directory is exclusively worker-owned; reconstruct a full accepted snapshot.
    for (const entry of await readdir(root)) if (entry !== '.git') await rm(path.join(root, entry), { recursive: true, force: true });
    for (const file of job.snapshot) {
      validateFilePath(file.path);
      const target = path.join(root, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      if(file.encoding==='base64'){if(!this.assets)throw new Error('Attachment storage unavailable');await writeFile(target,await this.assets.read(file.content));}
      else await writeFile(target, file.content, 'utf8');
    }
    await git(['add','--all','--','.']);
    const name = job.author_name.replace(/[\r\n<>]/g,'').slice(0,100) || 'Easy LaTeX member';
    const email = job.author_email.replace(/[\r\n<>]/g,'').slice(0,254);
    await git(['-c',`user.name=${name}`,'-c',`user.email=${email}`,'commit','--quiet','--allow-empty','-m',`Saved project version\n\n${marker}`]);
    return git(['rev-parse','HEAD']);
  }
}
