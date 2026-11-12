import { Code2, FilePenLine, LocateFixed } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { parseVisualDocument } from '@easy-latex/latex';
import type { Diagnostic } from '@easy-latex/shared-types';
import { LatexEditor, type LatexEditorHandle } from './LatexEditor';
import { VisualEditor } from './visual/VisualEditor';
import './visual/visual.css';

interface Props {
  value: string;
  path: string;
  diagnostics: Diagnostic[];
  readOnly?: boolean;
  onChange(value: string): void;
  onSave(): void;
  onCursorLineChange?(line: number): void;
  onSyncToPdf?(line?: number): void;
}

/** Both presentations share the workspace buffer and all save/conflict/access rules. */
export const DocumentEditor = forwardRef<LatexEditorHandle, Props>(function DocumentEditor(props, forwardedRef) {
  const [mode, setMode] = useState<'code' | 'visual'>('code');
  const [currentLine, setCurrentLine] = useState(1);
  const code = useRef<LatexEditorHandle>(null);
  const visual = useRef<LatexEditorHandle>(null);
  const isTex = props.path.toLowerCase().endsWith('.tex');
  const visualActive = isTex && mode === 'visual';

  const handleCursorLineChange = (line: number) => {
    setCurrentLine(line);
    props.onCursorLineChange?.(line);
  };

  useImperativeHandle(forwardedRef, () => ({
    jumpTo(line, column) {
      setCurrentLine(line);
      if (visualActive) {
        const offset = props.value.split('\n').slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0);
        const projection = parseVisualDocument(props.value);
        if (!projection.complete || offset < projection.bodyFrom || offset > projection.bodyTo) {
          openCode(line);
          return;
        }
      }
      (visualActive ? visual.current : code.current)?.jumpTo(line, column);
    },
    focus() { (visualActive ? visual.current : code.current)?.focus(); }
  }), [visualActive, props.value]);

  const openCode = (line: number) => {
    setMode('code');
    requestAnimationFrame(() => code.current?.jumpTo(line));
  };

  const toggleMode = () => {
    const nextMode = visualActive ? 'code' : 'visual';
    setMode(nextMode);
    requestAnimationFrame(() => {
      (nextMode === 'visual' ? visual.current : code.current)?.jumpTo(currentLine);
    });
  };

  return <div className="document-editor">
    <div className="document-mode-bar">
      <span className="document-file-name" title={props.path}>{props.path.split('/').at(-1)}</span>
      <div className="document-bar-actions">
        {isTex && props.onSyncToPdf ? (
          <button
            className="document-synctex-button"
            type="button"
            title="Jump to position in PDF (double-click code, ⌥-click or ⌘⌥J)"
            aria-label="Jump to PDF"
            onClick={() => props.onSyncToPdf?.(currentLine)}
          >
            <LocateFixed size={14} aria-hidden="true" />
            <span>Jump to PDF</span>
          </button>
        ) : null}
        {isTex ? <button className="document-mode-switch" type="button" role="switch" aria-label="Visual mode" aria-checked={visualActive}
          title={visualActive ? 'Switch to Code mode' : 'Switch to Visual mode'} onClick={toggleMode}>
          <span className="document-mode-thumb" aria-hidden="true"/>
          <span className="document-mode-label" aria-hidden="true"><Code2/>Code</span>
          <span className="document-mode-label" aria-hidden="true"><FilePenLine/>Visual</span>
        </button> : <span className="document-mode-caption">Plain text</span>}
      </div>
    </div>
    <div className="document-code" hidden={visualActive}><LatexEditor {...props} ref={code} onCursorLineChange={line => {if (!visualActive) handleCursorLineChange(line);}}/></div>
    {isTex ? <div className="document-visual" hidden={!visualActive}><VisualEditor key={props.path} {...props} ref={visual} onOpenCode={openCode} onCursorLineChange={line => {if (visualActive) handleCursorLineChange(line);}} onSyncToPdf={props.onSyncToPdf}/></div> : null}
  </div>;
});
