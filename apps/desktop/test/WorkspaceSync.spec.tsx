// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompileResult, DesktopApi, OpenProjectResult, SyncTeXResult } from '@easy-latex/shared-types';
import { useWorkspaceController } from '../src/renderer/hooks/useWorkspaceController';

const firstUrl = 'easy-latex://pdf/11111111-1111-4111-8111-111111111111';
const secondUrl = 'easy-latex://pdf/22222222-2222-4222-8222-222222222222';
const project = (name: string): OpenProjectResult => ({project: {name, workspacePath: `/${name}`, rootDocument: 'main.tex'}, rootCandidates: ['main.tex']});
const compiled = (pdfUrl = firstUrl): CompileResult => ({success: true, cancelled: false, pdfUrl, errors: [], warnings: [], duration: 1, engine: 'pdflatex', rootDocument: 'main.tex', log: ''});
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(finish => { resolve = finish; });
  return {promise, resolve};
};
const settings = {compilerEngine: 'pdflatex', projectsDirectory: '/', explorerWidth: 232, pdfWidth: 520, problemsHeight: 220, recentProjects: [], collaborationApiUrl: ''};
const api = {
  project: {current: vi.fn(), recent: vi.fn(), openRecent: vi.fn()},
  file: {list: vi.fn(), read: vi.fn(), onChanged: vi.fn()},
  settings: {all: vi.fn()}, git: {status: vi.fn()},
  compiler: {build: vi.fn<DesktopApi['compiler']['build']>(), cancel: vi.fn(), onEvent: vi.fn()},
  synctex: {forward: vi.fn<DesktopApi['synctex']['forward']>(), inverse: vi.fn<DesktopApi['synctex']['inverse']>()},
};

beforeEach(() => {
  vi.resetAllMocks();
  api.project.current.mockResolvedValue(project('a')); api.project.recent.mockResolvedValue([]);
  api.project.openRecent.mockResolvedValue(project('b'));
  api.file.list.mockResolvedValue([{path: 'main.tex', name: 'main.tex', parentPath: '', kind: 'file'}]);
  api.file.read.mockResolvedValue({path: 'main.tex', content: 'source', modifiedAt: 1, size: 6});
  api.file.onChanged.mockReturnValue(() => {}); api.compiler.onEvent.mockReturnValue(() => {});
  api.settings.all.mockResolvedValue(settings); api.git.status.mockResolvedValue({available: true, isRepository: false});
  api.compiler.cancel.mockResolvedValue(true); api.compiler.build.mockResolvedValue(compiled());
  api.synctex.forward.mockResolvedValue({available: true, page: 2, x: 100, y: 190});
  window.desktop = api as unknown as DesktopApi;
});
afterEach(cleanup);
const start = async () => {
  const view = renderHook(() => useWorkspaceController());
  await waitFor(() => expect(view.result.current.activeFile?.path).toBe('main.tex'));
  return view;
};

describe('Local PDF navigation identity', () => {
  it('does not use a previous project mapping before the current project has a PDF', async () => {
    const view = await start();
    await act(() => view.result.current.syncToPdf(5));
    expect(api.synctex.forward).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain('Compile the document');
  });

  it('ignores a compilation that completes after switching between projects with main.tex', async () => {
    const view = await start(), pending = deferred<CompileResult>();
    api.compiler.build.mockReturnValueOnce(pending.promise);
    let building: Promise<void> = Promise.resolve();
    act(() => { building = view.result.current.compile(); });
    await waitFor(() => expect(api.compiler.build).toHaveBeenCalledOnce());
    await act(() => view.result.current.openRecentProject('/b'));
    await act(async () => { pending.resolve(compiled()); await building; });
    expect(view.result.current.projectResult?.project.workspacePath).toBe('/b');
    expect(view.result.current.compileResult).toBeNull(); expect(view.result.current.pdfJumpTarget).toBeNull();
  });

  it('ignores a late navigation reply after a new PDF replaces the displayed artifact', async () => {
    const view = await start(); await act(() => view.result.current.compile());
    const pending = deferred<SyncTeXResult>(); api.synctex.forward.mockReturnValueOnce(pending.promise);
    let navigation: Promise<void> = Promise.resolve();
    act(() => { navigation = view.result.current.syncToPdf(5); });
    await waitFor(() => expect(api.synctex.forward).toHaveBeenCalledWith({file: 'main.tex', line: 5, pdfUrl: firstUrl}));
    api.compiler.build.mockResolvedValueOnce(compiled(secondUrl));
    await act(() => view.result.current.compile());
    await act(async () => { pending.resolve({available: true, page: 9, x: 10, y: 20}); await navigation; });
    expect(view.result.current.compileResult?.pdfUrl).toBe(secondUrl); expect(view.result.current.pdfJumpTarget).toBeNull();
  });

  it('ignores a late navigation reply after switching projects', async () => {
    const view = await start(); await act(() => view.result.current.compile());
    const pending = deferred<SyncTeXResult>(); api.synctex.forward.mockReturnValueOnce(pending.promise);
    let navigation: Promise<void> = Promise.resolve();
    act(() => { navigation = view.result.current.syncToPdf(5); });
    await act(() => view.result.current.openRecentProject('/b'));
    await act(async () => { pending.resolve({available: true, page: 9, x: 10, y: 20}); await navigation; });
    expect(view.result.current.pdfJumpTarget).toBeNull(); expect(view.result.current.compileResult).toBeNull();
  });

  it('uses the preserved PDF identity after a failed recompile', async () => {
    const view = await start(); await act(() => view.result.current.compile());
    const failed = {...compiled(), success: false}; delete failed.pdfUrl;
    api.compiler.build.mockResolvedValueOnce(failed);
    await act(() => view.result.current.compile());
    await act(() => view.result.current.syncToPdf(5));
    expect(view.result.current.pdfStale).toBe(true);
    expect(api.synctex.forward).toHaveBeenCalledWith({file: 'main.tex', line: 5, pdfUrl: firstUrl});
    expect(view.result.current.pdfJumpTarget).toMatchObject({page: 2, x: 100, y: 190});
  });

  it('includes the displayed PDF identity in inverse navigation too', async () => {
    const view = await start(); await act(() => view.result.current.compile());
    api.synctex.inverse.mockResolvedValueOnce({available: true, file: 'main.tex', line: 7});
    await act(() => view.result.current.syncFromPdf({page: 2, x: 100, y: 190}));
    expect(api.synctex.inverse).toHaveBeenCalledWith({page: 2, x: 100, y: 190, pdfUrl: firstUrl});
    expect(view.result.current.jumpTarget).toMatchObject({path: 'main.tex', line: 7});
  });
});
