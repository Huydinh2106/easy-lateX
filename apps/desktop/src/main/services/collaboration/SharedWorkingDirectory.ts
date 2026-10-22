import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SharedFile } from '@easy-latex/shared-types';
import { validateSharedDirectory, validateSourcePath } from './paths';

/** The visible project folder. Git transport and recovery records stay outside it. */
export class SharedWorkingDirectory {
  constructor(readonly root: string, private readonly manifest: string) {}

  private async entry(relative: string, directory = false): Promise<string> {
    if (directory) validateSharedDirectory(relative); else validateSourcePath(relative, true);
    const root = await realpath(this.root);
    if (root !== this.root) throw new Error('The shared project folder moved. Reopen the project.');
    let current = root;
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]!);
      const folder = directory || i < parts.length - 1;
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (folder ? !info.isDirectory() : !info.isFile())) {
          throw new Error(`Cannot synchronize ${relative}: remove the symbolic link or conflicting folder first.`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (folder) await mkdir(current);
      }
    }
    return current;
  }

  async write(relative: string, bytes: Buffer, check: () => void): Promise<void> {
    const target = await this.entry(relative);
    check();
    try { if ((await readFile(target)).equals(bytes)) return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = path.join(path.dirname(target), `.easy-latex-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 });
      // Recheck the path after I/O; never follow a user-created symlink.
      await this.entry(relative);
      check();
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async synchronize(files: SharedFile[], directories: string[], protectedPaths: Set<string>, check: () => void): Promise<void> {
    // Validate the complete plan before changing any source file.
    for (const file of files) validateSourcePath(file.path, true);
    for (const directory of directories) validateSharedDirectory(directory);
    let previous: string[] = [];
    try {
      const value: unknown = JSON.parse(await readFile(this.manifest, 'utf8'));
      if (!Array.isArray(value) || !value.every((entry: unknown) => typeof entry === 'string')) throw new Error('Invalid shared folder manifest');
      previous = value;
      for (const relative of previous) validateSourcePath(relative, true);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const current = new Set(files.map(file => file.path));
    // Persist intent first so an interrupted update can finish on the next open.
    check();
    await mkdir(path.dirname(this.manifest), { recursive: true, mode: 0o700 });
    const temporary = `${this.manifest}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify([...new Set([...previous, ...current])]), { mode: 0o600 });
    check();
    await rename(temporary, this.manifest);
    for (const relative of previous) {
      if (current.has(relative) || protectedPaths.has(relative)) continue;
      const target = await this.entry(relative);
      check();
      await unlink(target).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
    for (const directory of directories) { check(); await this.entry(directory, true); }
    for (const file of files) {
      if (protectedPaths.has(file.path)) continue;
      await this.write(file.path, Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'), check);
    }
    check();
    await writeFile(temporary, JSON.stringify([...new Set([...current, ...previous.filter(p=>protectedPaths.has(p))])]), { mode: 0o600 });
    check();
    await rename(temporary, this.manifest);
  }
}
