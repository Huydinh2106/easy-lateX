import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';
import { CompileManager } from '../src/main/services/compiler/CompileManager';
import type { CompilerBackend, CompilerRequest } from '../src/main/services/compiler/CompilerBackend';
import { FileManager } from '../src/main/services/filesystem/FileManager';
import type { SettingsManager } from '../src/main/services/settings/SettingsManager';
import { SyncTeXManager } from '../src/main/services/synctex/SyncTeXManager';
import type { WorkspaceManager } from '../src/main/services/workspace/WorkspaceManager';

const mapping = (page: number) => `SyncTeX Version:1\nInput:1:/workspace/main.tex\nOutput:pdf\nMagnification:1000\nUnit:1\nX Offset:0\nY Offset:0\nContent:\n{${page}\nh1,5:6578176,13156352:6578176,657817,131563\n}\nPostamble:\n`;

describe('Successful PDF and SyncTeX identity', () => {
  let directory: string, compiler: CompileManager, synctex: SyncTeXManager, artifacts: ArtifactRegistry;
  const build = vi.fn<CompilerBackend['compile']>();
  let result = {success: true, cancelled: false, page: 1, withMapping: true};

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'easy-latex-compile-mapping-'));
    await writeFile(path.join(directory, 'main.tex'), 'source');
    const files = new FileManager(); await files.setWorkspace(directory);
    const workspace = {current: () => ({project: {workspacePath: directory, rootDocument: 'main.tex'}}), requireRootDocument: () => 'main.tex'} as unknown as WorkspaceManager;
    synctex = new SyncTeXManager(workspace, files); artifacts = new ArtifactRegistry();
    result = {success: true, cancelled: false, page: 1, withMapping: true};
    build.mockReset();
    build.mockImplementation(async (request: CompilerRequest) => {
      await mkdir(request.outputDirectory, {recursive: true});
      const pdfPath = path.join(request.outputDirectory, 'main.pdf'), synctexPath = path.join(request.outputDirectory, 'main.synctex.gz');
      await writeFile(pdfPath, `PDF build ${result.page}`);
      await writeFile(synctexPath, gzipSync(mapping(result.page)));
      return {...result, exitCode: result.success ? 0 : 1, duration: 1, log: '', errors: [], warnings: [], pdfPath, ...(result.withMapping ? {synctexPath} : {})};
    });
    compiler = new CompileManager({compile: build, cancel: vi.fn().mockResolvedValue(true)}, workspace, files, {get: () => Promise.resolve('pdflatex')} as unknown as SettingsManager, artifacts, synctex);
  });
  afterEach(async () => { await rm(directory, {recursive: true, force: true}); });

  it.each([false, true])('preserves the successful PDF mapping when a later build fails or is cancelled (%s)', async cancelled => {
    const first = await compiler.build(); expect(first.pdfUrl).toBeDefined();
    result = {success: false, cancelled, page: 8, withMapping: true};
    const failed = await compiler.build(); expect(failed.pdfUrl).toBeUndefined();
    expect(await readFile(artifacts.resolve(first.pdfUrl!)!, 'utf8')).toBe('PDF build 1');
    expect((await synctex.forward({pdfUrl: first.pdfUrl!, file: 'main.tex', line: 5})).page).toBe(1);
  });

  it('does not reuse an older mapping when a successful PDF has no SyncTeX output', async () => {
    const first = await compiler.build();
    result = {success: true, cancelled: false, page: 2, withMapping: false};
    const next = await compiler.build(); expect(next.pdfUrl).toBeDefined();
    expect((await synctex.forward({pdfUrl: next.pdfUrl!, file: 'main.tex', line: 5})).available).toBe(false);
    expect((await synctex.forward({pdfUrl: first.pdfUrl!, file: 'main.tex', line: 5})).page).toBe(1);
  });
});
