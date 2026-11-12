// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef, useState } from 'react';
import { VisualEditor } from '../src/renderer/features/editor/visual/VisualEditor';
import { DocumentEditor } from '../src/renderer/features/editor/DocumentEditor';
import type { LatexEditorHandle } from '../src/renderer/features/editor/LatexEditor';
import { renderInline, serializeInline } from '../src/renderer/features/editor/visual/inlineDom';

const source = String.raw`\documentclass{article}
\newcommand{\myMacro}{Leave me alone}
\begin{document}
\section{Introduction}
An editable \textbf{paragraph} with $x^2$ and \cite{key}.

Second paragraph.
\end{document}
% Tail preserved`;
const save = vi.fn(), code = vi.fn();
function Harness({initial = source, readOnly = false}: {initial?: string; readOnly?: boolean}) {
  const [value, setValue] = useState(initial);
  return <><VisualEditor path="main.tex" value={value} onChange={setValue} onSave={save} onOpenCode={code} readOnly={readOnly}/><textarea aria-label="Buffer" value={value} readOnly/></>;
}
afterEach(() => {cleanup(); vi.clearAllMocks();});
function typeText(host: HTMLElement, text: string) {fireEvent.focus(host); host.textContent = text; fireEvent.input(host);}
function selectText(host: HTMLElement) {const range = document.createRange(); range.selectNodeContents(host); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); void act(() => document.dispatchEvent(new Event('selectionchange')));}

describe('Visual mode source safety and editing', () => {
  it('does not modify source by opening, switching modes or focusing text', () => {
    const change = vi.fn();
    render(<DocumentEditor value={source} path="main.tex" diagnostics={[]} onChange={change} onSave={save}/>);
    const toggle = screen.getByRole('switch', {name: 'Visual mode'});
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.focus(screen.getByRole('textbox', {name: 'Paragraph 2'}));
    fireEvent.click(toggle); fireEvent.click(toggle);
    expect(change).not.toHaveBeenCalled();
  });
  it('edits only the selected paragraph and escapes typed LaTeX characters', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    typeText(host, 'Tiếng Việt: 100% & $5.');
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', 'Tiếng Việt: 100\\% \\& \\$5.'));
  });
  it('retains opaque inline math, citations and original formatting after adjacent text changes', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 2'});
    fireEvent.focus(host);
    host.append(document.createTextNode(' New & safe.')); fireEvent.input(host);
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('\\cite{key}.', '\\cite{key}. New \\& safe.'));
  });
  it('deduplicates synchronous browser input notifications for the same change', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    void act(() => {
      host.textContent = 'A much longer paragraph.';
      host.dispatchEvent(new Event('input', {bubbles: true}));
      host.dispatchEvent(new Event('input', {bubbles: true}));
    });
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', 'A much longer paragraph.'));
  });
  it('waits for Vietnamese IME composition to finish before updating the buffer', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    fireEvent.compositionStart(host); host.textContent = 'Tiếng Việt'; fireEvent.input(host);
    expect(screen.getByLabelText('Buffer')).toHaveValue(source);
    fireEvent.compositionEnd(host);
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', 'Tiếng Việt'));
  });
  it('supports undo/redo and save shortcuts from the visual editor', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    typeText(host, 'Changed');
    fireEvent.keyDown(host, {key: 'z', ctrlKey: true}); expect(screen.getByLabelText('Buffer')).toHaveValue(source);
    fireEvent.click(screen.getByRole('button', {name: 'Redo'})); expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', 'Changed'));
    fireEvent.keyDown(host, {key: 's', metaKey: true}); expect(save).toHaveBeenCalledOnce();
  });
  it('formats selected text and converts a paragraph to a heading and a list', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'}); fireEvent.focus(host); selectText(host);
    fireEvent.click(screen.getByRole('button', {name: 'Bold'}));
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', '\\textbf{Second paragraph.}'));
    fireEvent.change(screen.getByLabelText('Text style'), {target: {value: 'subsection'}});
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', '\\subsection{\\textbf{Second paragraph.}}'));
    fireEvent.click(screen.getByRole('button', {name: 'Bulleted list'}));
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', '\\begin{itemize}\n\\item \\textbf{Second paragraph.}\n\\end{itemize}'));
  });
  it('commits native browser formatting only once when execCommand emits an input event', () => {
    render(<Harness/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'}); fireEvent.focus(host); selectText(host);
    Object.defineProperty(document, 'execCommand', {configurable: true, value: () => {
      const mark = document.createElement('b'); mark.textContent = host.textContent;
      host.replaceChildren(mark); host.dispatchEvent(new Event('input', {bubbles: true})); return true;
    }});
    try {fireEvent.click(screen.getByRole('button', {name: 'Bold'}));
      expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', '\\textbf{Second paragraph.}'));
    } finally {Reflect.deleteProperty(document, 'execCommand');}
  });
  it('keeps a cleared paragraph ready for new text', () => {
    render(<Harness/>);
    typeText(screen.getByRole('textbox', {name: 'Paragraph 3'}), '');
    const empty = screen.getByRole('textbox', {name: 'Paragraph 3'});
    expect(empty).toBeEmptyDOMElement(); typeText(empty, 'Replacement');
    expect(screen.getByLabelText('Buffer')).toHaveValue(source.replace('Second paragraph.', 'Replacement'));
  });
  it('edits title metadata without rewriting document setup or escaping unchanged formatting', () => {
    const text = '\\documentclass{article}\n\\title{Old \\textbf{title}}\n\\author{A Name}\n\\begin{document}\n\\maketitle\nBody.\n\\end{document}';
    render(<Harness initial={text}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Document details'}));
    fireEvent.change(screen.getByLabelText('Author'), {target: {value: 'Huy & team'}});
    fireEvent.click(screen.getByRole('button', {name: 'Apply changes'}));
    expect(screen.getByLabelText('Buffer')).toHaveValue(text.replace('A Name', 'Huy \\& team'));
  });
  it('preserves visual undo when switching to Code and back', () => {
    function Editor() {const [value, setValue] = useState(source); return <DocumentEditor value={value} path="main.tex" diagnostics={[]} onChange={setValue} onSave={save}/>;}
    render(<Editor/>);
    const toggle = screen.getByRole('switch', {name: 'Visual mode'}); fireEvent.click(toggle);
    typeText(screen.getByRole('textbox', {name: 'Paragraph 3'}), 'Changed');
    fireEvent.click(toggle); fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
    expect(screen.getByRole('textbox', {name: 'Paragraph 3'})).toHaveTextContent('Second paragraph.');
  });
  it('starts writing in an empty body without inserting placeholder text into source', () => {
    render(<Harness initial={'\\begin{document}\n\\end{document}'}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Start writing'}));
    const host = screen.getByRole('textbox', {name: 'Paragraph 1'});
    expect(host).toBeEmptyDOMElement();
    expect((screen.getByLabelText<HTMLTextAreaElement>('Buffer')).value).not.toContain('New paragraph');
    typeText(host, 'First words');
    expect((screen.getByLabelText<HTMLTextAreaElement>('Buffer')).value).toContain('First words');
  });
  it('splits a paragraph with Enter and keeps the new paragraph editable', () => {
    render(<Harness initial={'Hello world.'}/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 1'}); fireEvent.focus(host);
    const range = document.createRange(); range.selectNodeContents(host); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.keyDown(host, {key: 'Enter'});
    const next = screen.getByRole('textbox', {name: 'Paragraph 2'});
    typeText(next, 'Next line.');
    expect(screen.getByLabelText('Buffer')).toHaveValue('Hello world.\n\nNext line.');
  });
  it('uses a real LaTeX line break for Shift+Enter', () => {
    render(<Harness initial="First"/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 1'}); fireEvent.focus(host);
    const range = document.createRange(); range.selectNodeContents(host); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.keyDown(host, {key: 'Enter', shiftKey: true});
    expect(screen.getByLabelText('Buffer')).toHaveValue('First' + '\\\\' + '\n');
  });
  it('joins paragraphs with Backspace without removing neighboring content', () => {
    render(<Harness initial={'First.\n\nSecond.'}/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 2'}); fireEvent.focus(host);
    const range = document.createRange(); range.selectNodeContents(host); range.collapse(true);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.keyDown(host, {key: 'Backspace'});
    expect(screen.getByLabelText('Buffer')).toHaveValue('First.Second.');
  });
  it('pastes HTML-looking content as plain text', () => {
    render(<Harness initial={'Text'}/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 1'}); fireEvent.focus(host); selectText(host);
    fireEvent.paste(host, {clipboardData: {getData: () => '<img src=x onerror=alert(1)> & 100%'}});
    expect(host.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Buffer')).toHaveValue('<img src=x onerror=alert(1)> \\& 100\\%');
  });
  it('protects shared View access and reloads external/AI edits', () => {
    const change = vi.fn();
    const {rerender} = render(<VisualEditor path="main.tex" value={source} onChange={change} onSave={save} onOpenCode={code} readOnly/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    expect(host).toHaveAttribute('contenteditable', 'false');
    typeText(host, 'Not allowed'); expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Text'})).toBeDisabled();
    rerender(<VisualEditor path="main.tex" value={source.replace('Second paragraph.', 'Updated by agent')} onChange={change} onSave={save} onOpenCode={code} readOnly/>);
    expect(screen.getByRole('textbox', {name: 'Paragraph 3'})).toHaveTextContent('Updated by agent');
  });
  it('navigates advanced blocks to their actual source line', () => {
    const text = '\\begin{document}\n\\begin{figure}\n\\includegraphics{plot}\n\\end{figure}\n\\end{document}';
    render(<Harness initial={text}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Code'})); expect(code).toHaveBeenCalledWith(2);
  });
  it('highlights the targeted visual block with visual-synctex-highlight and stays in Visual mode on jumpTo', () => {
    const editorRef = createRef<LatexEditorHandle>();
    render(<DocumentEditor ref={editorRef} value={source} path="main.tex" diagnostics={[]} onChange={vi.fn()} onSave={save}/>);
    const toggle = screen.getByRole('switch', {name: 'Visual mode'});
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    act(() => {
      editorRef.current?.jumpTo(7); // "Second paragraph." is at line 7
    });

    // Stays in visual mode
    expect(toggle).toBeChecked();
    const paragraph = screen.getByRole('textbox', {name: 'Paragraph 3'});
    const blockRow = paragraph.closest('.visual-block');
    expect(blockRow).toHaveClass('visual-synctex-highlight');
  });
  it('switches to Code mode on jumpTo when target line is in preamble', () => {
    const editorRef = createRef<LatexEditorHandle>();
    render(<DocumentEditor ref={editorRef} value={source} path="main.tex" diagnostics={[]} onChange={vi.fn()} onSave={save}/>);
    const toggle = screen.getByRole('switch', {name: 'Visual mode'});
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    act(() => {
      editorRef.current?.jumpTo(2); // preamble: \newcommand
    });

    // Switched to code mode
    expect(toggle).not.toBeChecked();
  });
  it('triggers forward sync to PDF when Alt-clicking a visual block', () => {
    const syncToPdf = vi.fn();
    render(<VisualEditor path="main.tex" value={source} onChange={vi.fn()} onSave={save} onOpenCode={code} onSyncToPdf={syncToPdf}/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    fireEvent.click(host, { altKey: true });
    expect(syncToPdf).toHaveBeenCalledWith(7);
  });
  it('triggers forward sync to PDF with Mod-Alt-J shortcut in Visual editor', () => {
    const syncToPdf = vi.fn();
    render(<VisualEditor path="main.tex" value={source} onChange={vi.fn()} onSave={save} onOpenCode={code} onSyncToPdf={syncToPdf}/>);
    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    fireEvent.focus(host);
    fireEvent.keyDown(host, { key: 'j', altKey: true, metaKey: true });
    expect(syncToPdf).toHaveBeenCalledWith(7);
  });
  it('passes active visual line when clicking Jump to PDF button in Visual mode', () => {
    const syncToPdf = vi.fn();
    render(<DocumentEditor value={source} path="main.tex" diagnostics={[]} onChange={vi.fn()} onSave={save} onSyncToPdf={syncToPdf}/>);
    const toggle = screen.getByRole('switch', {name: 'Visual mode'});
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    const host = screen.getByRole('textbox', {name: 'Paragraph 3'});
    fireEvent.focus(host);

    const jumpButton = screen.getByRole('button', {name: 'Jump to PDF'});
    fireEvent.click(jumpButton);
    expect(syncToPdf).toHaveBeenCalledWith(7);
  });
});

describe('safe inline DOM conversion', () => {
  it('round trips text, marks, comments, escaped symbols and macros exactly', () => {
    for (const text of [String.raw`Text \textbf{bold \emph{italic}}.`, String.raw`100\% \& \$5 \_ \{x\} \textbackslash{} ~end.`, 'A % keep comment\n B', String.raw`Math $x^2$ \cite[2]{key} \custom{<img src=x>}`, 'Text \\custom{one\n\n\ntwo}']) {
      const host = document.createElement('div'); renderInline(host, text); expect(serializeInline(host)).toBe(text); expect(host.querySelector('img')).toBeNull();
    }
  });
});
