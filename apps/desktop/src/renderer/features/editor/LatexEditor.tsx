import { Annotation, EditorState } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic as CodeMirrorDiagnostic } from "@codemirror/lint";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Diagnostic } from "@easy-latex/shared-types";
import { completeLatex } from "./autocomplete/latexCompletions";
import { latexLanguage } from "./language/latexLanguage";
import { easyLatexEditorTheme } from "./theme/editorTheme";

const externalUpdate = Annotation.define<boolean>();

export interface LatexEditorHandle {
  jumpTo(line: number, column?: number): void;
  focus(): void;
}

interface LatexEditorProps {
  value: string;
  path: string;
  diagnostics: Diagnostic[];
  onChange(value: string): void;
  onSave(): void;
}

export const LatexEditor = forwardRef<LatexEditorHandle, LatexEditorProps>(function LatexEditor(
  { value, path, diagnostics, onChange, onSave },
  forwardedRef
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useImperativeHandle(forwardedRef, () => ({
    jumpTo(line, column = 1) {
      const view = viewRef.current;
      if (!view) return;
      const safeLine = Math.max(1, Math.min(line, view.state.doc.lines));
      const lineInfo = view.state.doc.line(safeLine);
      const position = Math.min(lineInfo.to, lineInfo.from + Math.max(0, column - 1));
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
      view.focus();
    },
    focus() { viewRef.current?.focus(); }
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        latexLanguage,
        autocompletion({ override: [completeLatex] }),
        easyLatexEditorTheme,
        keymap.of([{
          key: "Mod-s",
          preventDefault: true,
          run: () => { onSaveRef.current(); return true; }
        }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalUpdate))) {
            onChangeRef.current(update.state.doc.toString());
          }
        })
      ]
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalUpdate.of(true)
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const editorDiagnostics: CodeMirrorDiagnostic[] = diagnostics
      .filter((diagnostic) => !diagnostic.file || diagnostic.file === path || diagnostic.file.endsWith(`/${path}`))
      .map((diagnostic) => {
        const lineNumber = Math.max(1, Math.min(diagnostic.line ?? 1, view.state.doc.lines));
        const line = view.state.doc.line(lineNumber);
        const from = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1));
        return {
          from,
          to: Math.min(line.to, Math.max(from + 1, line.to)),
          severity: diagnostic.severity,
          message: diagnostic.message,
          source: "LaTeX"
        };
      });
    view.dispatch(setDiagnostics(view.state, editorDiagnostics));
  }, [diagnostics, path, value]);

  return <div ref={hostRef} className="latex-editor" aria-label={`Editing ${path}`} />;
});
