// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatexEditor } from '../src/renderer/features/editor/LatexEditor';

const source = '\\section{First}\nFirst paragraph.\n\\section{Second}\nTarget paragraph.';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function editor(readOnly = false) {
  const sync = vi.fn(), change = vi.fn();
  render(<LatexEditor path="main.tex" value={source} diagnostics={[]} onChange={change} onSave={() => {}} onSyncToPdf={sync} readOnly={readOnly}/>);
  const host = screen.getByLabelText('Editing main.tex');
  const content = host.querySelector<HTMLElement>('.cm-content')!;
  const view = EditorView.findFromDOM(content)!;
  // Geometry is supplied below; let the real CodeMirror event pipeline select text.
  vi.spyOn(view, 'posAndSideAtCoords').mockImplementation(() => ({pos: 0, assoc: 1}));
  return {content, view, sync, change};
}

describe('Code to PDF navigation gestures', () => {
  it('double-clicks the pointed line rather than the previous cursor line without changing source', () => {
    const {content, view, sync, change} = editor();
    act(() => view.dispatch({selection: {anchor: 0}}));
    const position = view.state.doc.line(4).from + 3;
    const coordinates = vi.spyOn(view, 'posAtCoords').mockReturnValue(position);
    fireEvent.mouseDown(content, {button: 0, detail: 2, clientX: 120, clientY: 180});
    fireEvent.doubleClick(content, {button: 0, clientX: 120, clientY: 180});
    expect(coordinates).toHaveBeenCalledWith({x: 120, y: 180});
    expect(sync).toHaveBeenCalledExactlyOnceWith(4);
    expect(view.state.doc.toString()).toBe(source);
    expect(change).not.toHaveBeenCalled();
  });

  it('also navigates from read-only code while normal clicks keep editing quiet', () => {
    const {content, view, sync} = editor(true);
    vi.spyOn(view, 'posAtCoords').mockReturnValue(view.state.doc.line(2).from);
    fireEvent.click(content, {button: 0});
    expect(sync).not.toHaveBeenCalled();
    fireEvent.mouseDown(content, {button: 0, detail: 2});
    expect(sync).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('does not jump when a double-click has no source position', () => {
    const {content, view, sync} = editor();
    vi.spyOn(view, 'posAtCoords').mockReturnValue(null);
    fireEvent.mouseDown(content, {button: 0, detail: 2});
    expect(sync).not.toHaveBeenCalled();
  });
});
