import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectCollaborationLink } from '@easy-latex/shared-types';

interface StoredLink extends ProjectCollaborationLink { backend: string; }
export class ProjectLinks {
  private loaded: Promise<void> | null = null;
  private entries: StoredLink[] = [];
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly filename: string) {}
  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        const value: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
        if (!Array.isArray(value)) throw new Error('Invalid project collaboration links');
        const entries = value.filter((entry: unknown): entry is StoredLink => Boolean(entry && typeof entry === 'object' && 'workspacePath' in entry && typeof entry.workspacePath === 'string' && path.isAbsolute(entry.workspacePath) && 'backend' in entry && typeof entry.backend === 'string' && 'projectId' in entry && typeof entry.projectId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.projectId)));
        if (entries.length !== value.length) throw new Error('Invalid project collaboration links');
        this.entries = entries;
      } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    })();
  }
  async list(backend: string): Promise<ProjectCollaborationLink[]> {
    await this.load();
    return this.entries.filter(entry => entry.backend === backend).map(({workspacePath, projectId}) => ({workspacePath, projectId}));
  }
  async bind(backend: string, workspacePath: string, projectId: string): Promise<void> {
    await this.load();
    const write = this.pending.catch(() => undefined).then(async () => {
      const entries = [...this.entries.filter(entry => entry.backend !== backend || entry.workspacePath !== workspacePath), {backend, workspacePath, projectId}];
      await mkdir(path.dirname(this.filename), {recursive: true, mode: 0o700});
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(entries), {mode: 0o600});
      await rename(temporary, this.filename);
      this.entries = entries;
    });
    this.pending = write;
    await write;
  }
}
