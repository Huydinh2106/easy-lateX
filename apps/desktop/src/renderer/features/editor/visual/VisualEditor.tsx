import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AlignLeft, ArrowUpRight, Bold, Braces, ChevronDown, CircleHelp, Code2, FileText, Italic, List, ListOrdered, LockKeyhole, Plus, Redo2, Undo2, Underline, Settings2 } from 'lucide-react';
import { parseVisualDocument, parseDocumentDetails, replaceVisualRange, setVisualStyle, setVisualList, insertVisualParagraph, splitVisualBlock, mergeVisualBlocks, type VisualBlock } from '@easy-latex/latex';
import type { LatexEditorHandle } from '../LatexEditor';
import { DocumentDetails, documentTitle } from './DocumentDetails';
import { renderMath } from './mathPreview';
import { insertPlainText, insertLineBreak, renderInline, serializeInline } from './inlineDom';

interface Props {
  value: string;
  path: string;
  readOnly?: boolean | undefined;
  onChange(value: string): void;
  onSave(): void;
  onOpenCode(line: number): void;
  onCursorLineChange?: ((line: number) => void) | undefined;
  onSyncToPdf?: ((line?: number) => void) | undefined;
}
interface EditableProps {
  source: string;
  index: number;
  block: VisualBlock;
  readOnly: boolean;
  register(index: number, host: HTMLDivElement | null): void;
  onEdit(index: number, content: string): void;
  onFocus(index: number): void;
  onEnter(index: number, before: string, after: string): void;
  onBoundary(index: number, backward: boolean): void;
  onAltClick?: ((index: number, event: React.MouseEvent) => void) | undefined;
}

function setCaretAtOffset(host: HTMLElement, targetOffset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let currentOffset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (currentOffset + length >= targetOffset) {
        const offsetInNode = Math.max(0, Math.min(length, targetOffset - currentOffset));
        range.setStart(node, offsetInNode);
        range.collapse(true);
        found = true;
        return true;
      }
      currentOffset += length;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child && walk(child)) return true;
      }
    }
    return false;
  }

  walk(host);
  if (!found) {
    range.selectNodeContents(host);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function EditableBlock({source, index, block, readOnly, register, onEdit, onFocus, onEnter, onBoundary, onAltClick}: EditableProps) {
  const host = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    if (host.current && !composing.current && serializeInline(host.current) !== source) renderInline(host.current, source);
  }, [source]);
  const commit = () => {if (host.current && !composing.current && !readOnly) onEdit(index, serializeInline(host.current));};
  const headingLevel = block.command?.replace(/\*$/, '');
  return <div ref={element => {host.current = element; register(index, element);}}
    className={`visual-editable${block.kind === 'heading' ? ` visual-heading visual-${headingLevel}` : ''}`}
    contentEditable={!readOnly} suppressContentEditableWarning role="textbox" aria-multiline="true"
    aria-label={block.kind === 'heading' ? `Heading ${index + 1}` : block.kind === 'item' ? `List item ${index + 1}` : `Paragraph ${index + 1}`}
    aria-readonly={readOnly} data-placeholder={block.kind === 'heading' ? 'Heading' : 'Write something…'}
    onFocus={() => onFocus(index)} onInput={commit}
    onClick={event => {
      if (event.altKey && onAltClick) {
        event.preventDefault();
        event.stopPropagation();
        onAltClick(index, event);
      }
    }}
    onCompositionStart={() => {composing.current = true;}}
    onCompositionEnd={() => {composing.current = false; commit();}}
    onPaste={event => {event.preventDefault(); if (readOnly) return; insertPlainText(event.clipboardData.getData('text/plain')); commit();}}
    onDrop={event => event.preventDefault()}
    onKeyDown={event => {
      if (readOnly || event.nativeEvent.isComposing) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (host.current && range?.collapsed && host.current.contains(range.commonAncestorContainer)) {
          const boundary = document.createRange(); boundary.selectNodeContents(host.current);
          if (event.key === 'Backspace') boundary.setEnd(range.startContainer, range.startOffset);
          else boundary.setStart(range.endContainer, range.endOffset);
          if (!boundary.toString()) {event.preventDefault(); onBoundary(index, event.key === 'Backspace');}
        }
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (event.shiftKey) {insertLineBreak(); commit(); return;}
      const selection = window.getSelection();
      if (!host.current || !selection?.rangeCount) return;
      const caret = selection.getRangeAt(0);
      if (!host.current.contains(caret.commonAncestorContainer)) return;
      caret.deleteContents();
      const before = document.createRange(); before.selectNodeContents(host.current); before.setEnd(caret.startContainer, caret.startOffset);
      const after = document.createRange(); after.selectNodeContents(host.current); after.setStart(caret.startContainer, caret.startOffset);
      const left = document.createElement('div'); left.append(before.cloneContents());
      const right = document.createElement('div'); right.append(after.cloneContents());
      onEnter(index, serializeInline(left), serializeInline(right));
    }}/>;
}

const styles = [
  ['paragraph', 'Text'], ['section', 'Heading 1'], ['subsection', 'Heading 2'], ['subsubsection', 'Heading 3']
] as const;

export const VisualEditor = forwardRef<LatexEditorHandle, Props>(function VisualEditor({value, path, readOnly = false, onChange, onSave, onOpenCode, onCursorLineChange, onSyncToPdf}, forwardedRef) {
  const [pendingParagraph, setPendingParagraph] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const documentModel = useMemo(() => {
    const parsed = parseVisualDocument(value);
    if (pendingParagraph !== null && pendingParagraph <= parsed.bodyTo) {
      const empty: VisualBlock = {kind: 'paragraph', from: pendingParagraph, to: pendingParagraph, contentFrom: pendingParagraph, contentTo: pendingParagraph};
      const index = parsed.blocks.findIndex(block => block.from >= pendingParagraph);
      parsed.blocks.splice(index < 0 ? parsed.blocks.length : index, 0, empty);
    }
    return parsed;
  }, [value, pendingParagraph]);
  const [active, setActive] = useState<number | null>(null);
  const [selectionExists, setSelectionExists] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const details = useMemo(() => parseDocumentDetails(value), [value]);
  const title = useMemo(() => documentTitle(value), [value]);
  const [, setHistoryVersion] = useState(0);
  const hosts = useRef(new Map<number, HTMLDivElement>());
  const rows = useRef(new Map<number, HTMLDivElement>());
  const savedSelection = useRef<Range | null>(null);
  const formatting = useRef(false);
  const lastInlineEdit = useRef<{source: string; from: number; content: string} | null>(null);
  const history = useRef({past: [] as string[], future: [] as string[], expected: value, lastEdit: 0, lastBlock: -1});
  const latest = useRef(value); latest.current = value;
  const model = useRef(documentModel); model.current = documentModel;
  const activeBlock = active === null ? undefined : documentModel.blocks[active];
  const editable = Boolean(activeBlock && activeBlock.kind !== 'protected' && !readOnly);
  const lineAt = (offset: number) => value.slice(0, offset).split('\n').length;
  const getLineFromOffset = (block: VisualBlock, charOffset: number) => {
    const blockText = value.slice(block.contentFrom, block.contentTo);
    const clamped = Math.max(0, Math.min(charOffset, blockText.length));
    const extraLines = blockText.slice(0, clamped).split('\n').length - 1;
    return lineAt(block.contentFrom) + extraLines;
  };
  const update = (next: string, blockIndex = -1) => {
    if (readOnly || next === latest.current) return;
    const state = history.current;
    if (blockIndex < 0 || state.lastBlock !== blockIndex || Date.now() - state.lastEdit > 700) state.past.push(latest.current);
    state.past = state.past.slice(-100);
    state.future = []; state.expected = next; state.lastEdit = Date.now(); state.lastBlock = blockIndex;
    latest.current = next;
    setHistoryVersion(version => version + 1);
    onChange(next);
  };
  useEffect(() => {
    // Disk reloads, AI updates and conflict resolutions invalidate old source ranges/history.
    if (history.current.expected !== value) {
      history.current = {past: [], future: [], expected: value, lastEdit: 0, lastBlock: -1};
      savedSelection.current = null; setPendingParagraph(null); setActive(null); setSelectionExists(false); setHistoryVersion(version => version + 1);
    }
  }, [value]);
  useEffect(() => {
    return () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    };
  }, []);
  useEffect(() => {
    const remember = () => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const host = active === null ? null : hosts.current.get(active);
      const inside = Boolean(range && host?.contains(range.commonAncestorContainer));
      if (inside && range) {
        savedSelection.current = range.cloneRange();
        const block = active !== null ? documentModel.blocks[active] : undefined;
        if (host && block && block.kind !== 'protected') {
          try {
            const preRange = document.createRange();
            preRange.selectNodeContents(host);
            preRange.setEnd(range.startContainer, range.startOffset);
            const currentLine = getLineFromOffset(block, preRange.toString().length);
            onCursorLineChange?.(currentLine);
          } catch {
            onCursorLineChange?.(lineAt(block.contentFrom));
          }
        }
      }
      setSelectionExists(Boolean(inside && !range?.collapsed));
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, [active, documentModel, value, onCursorLineChange]);
  const focusBlock = (index: number, end = false) => {
    setActive(index);
    requestAnimationFrame(() => {
      const host = hosts.current.get(index);
      host?.focus();
      if (host) {const range = document.createRange(); range.selectNodeContents(host); range.collapse(!end); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);}
    });
  };
  useImperativeHandle(forwardedRef, () => ({
    jumpTo(line) {
      const offset = value.split('\n').slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0);
      const index = documentModel.blocks.findIndex(block => block.to >= offset);
      const target = index < 0 ? documentModel.blocks.length - 1 : index;
      if (target < 0 || !documentModel.blocks[target]) return;

      const scrollIntoTarget = () => {
        const row = rows.current.get(target);
        if (typeof row?.scrollIntoView === 'function') {
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      };
      if (rows.current.has(target)) {
        scrollIntoTarget();
      } else {
        requestAnimationFrame(scrollIntoTarget);
      }

      setHighlightedIndex(target);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlightedIndex(null), 2200);

      const block = documentModel.blocks[target];
      if (block.kind !== 'protected') {
        focusBlock(target);
        const targetCharOffset = Math.max(0, offset - block.contentFrom);
        requestAnimationFrame(() => {
          const host = hosts.current.get(target);
          if (host) setCaretAtOffset(host, targetCharOffset);
        });
      } else {
        requestAnimationFrame(() => {
          const row = rows.current.get(target);
          row?.querySelector<HTMLElement>('button')?.focus();
        });
      }
      onCursorLineChange?.(line);
    },
    focus() {focusBlock(active ?? documentModel.blocks.findIndex(block => block.kind !== 'protected'));}
  }));
  const edit = (index: number, content: string) => {
    if (formatting.current) return;
    const block = model.current.blocks[index];
    if (!block || block.kind === 'protected') return;
    const last = lastInlineEdit.current;
    if (last?.source === latest.current && last.from === block.contentFrom && last.content === content) return;
    if (block.kind === 'paragraph' && !content.trim()) setPendingParagraph(block.from);
    else if (block.from === pendingParagraph) setPendingParagraph(null);
    const next = replaceVisualRange(latest.current, block.contentFrom, block.contentTo, content);
    lastInlineEdit.current = {source: next, from: block.contentFrom, content};
    update(next, index);
  };
  const travel = (direction: 'past' | 'future') => {
    if (readOnly) return;
    const state = history.current;
    const next = state[direction].pop();
    if (next === undefined) return;
    state[direction === 'past' ? 'future' : 'past'].push(latest.current);
    state.expected = next; state.lastBlock = -1;
    latest.current = next; savedSelection.current = null; setPendingParagraph(null);
    setSelectionExists(false); setHistoryVersion(version => version + 1); onChange(next);
  };
  const format = (command: 'bold' | 'italic' | 'underline') => {
    if (!editable || active === null) return;
    const host = hosts.current.get(active), range = savedSelection.current;
    if (!host || !range || range.collapsed || !host.contains(range.commonAncestorContainer)) return;
    host.focus();
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    formatting.current = true;
    try {
      if (typeof document.execCommand === 'function') document.execCommand(command);
      else {const mark = document.createElement(command === 'bold' ? 'strong' : command === 'italic' ? 'em' : 'u'); mark.append(range.extractContents()); range.insertNode(mark);}
    } finally {formatting.current = false;}
    edit(active, serializeInline(host));
    savedSelection.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  };
  const changeStyle = (style: string) => {
    if (!activeBlock || active === null || !editable) return;
    update(setVisualStyle(value, activeBlock, style)); focusBlock(active, true);
  };
  const makeList = (type: 'itemize' | 'enumerate') => {
    if (!activeBlock || active === null || !editable) return;
    update(setVisualList(value, activeBlock, type)); focusBlock(active, true);
  };
  const addParagraph = (atEnd = false) => {
    if (pendingParagraph !== null) {focusBlock(documentModel.blocks.findIndex(block => block.from === pendingParagraph)); return;}
    const at = !atEnd && activeBlock ? activeBlock.listTo ?? activeBlock.to : documentModel.bodyTo;
    const result = insertVisualParagraph(value, at, documentModel.blocks);
    update(result.source); setPendingParagraph(result.emptyAt ?? null); focusBlock(result.focusIndex);
  };
  const splitBlock = (index: number, before: string, after: string) => {
    const result = splitVisualBlock(value, documentModel.blocks, index, before, after);
    if (!result) return;
    update(result.source); setPendingParagraph(result.emptyAt ?? null); focusBlock(result.focusIndex);
  };
  const joinBlocks = (index: number, backward: boolean) => {
    const previousIndex = backward ? index - 1 : index;
    const previous = documentModel.blocks[previousIndex], current = documentModel.blocks[previousIndex + 1];
    if (!previous || !current) return;
    if (current.from === pendingParagraph) {setPendingParagraph(null); focusBlock(previousIndex, true); return;}
    const result = mergeVisualBlocks(value, previous, current);
    if (result !== null) {update(result); setPendingParagraph(null); focusBlock(previousIndex, true);}
  };
  const protectedCount = documentModel.blocks.filter(block => block.kind === 'protected').length;
  const wordCount = useMemo(() => documentModel.blocks.filter(block => block.kind !== 'protected').map(block => value.slice(block.contentFrom, block.contentTo)).join(' ').trim().split(/\s+/).filter(Boolean).length, [documentModel, value]);

  const handleAltClick = (index: number, event: React.MouseEvent) => {
    if (!event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    const block = documentModel.blocks[index];
    if (!block) return;
    let line = lineAt(block.contentFrom ?? block.from);
    const host = hosts.current.get(index);
    if (host && block.kind !== 'protected') {
      let charOffset = 0;
      if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(event.clientX, event.clientY);
        if (range && host.contains(range.startContainer)) {
          try {
            const preRange = document.createRange();
            preRange.selectNodeContents(host);
            preRange.setEnd(range.startContainer, range.startOffset);
            charOffset = preRange.toString().length;
          } catch {
            // ignore
          }
        }
      }
      line = getLineFromOffset(block, charOffset);
    }
    onSyncToPdf?.(line);
  };

  return <div className="visual-editor" onKeyDown={event => {
    if (event.nativeEvent.isComposing || detailsOpen) return;
    if (event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      event.stopPropagation();
      let targetLine: number | undefined;
      if (active !== null && documentModel.blocks[active]) {
        const block = documentModel.blocks[active];
        targetLine = lineAt(block.contentFrom ?? block.from);
        const host = hosts.current.get(active);
        const selection = window.getSelection();
        if (selection?.rangeCount && host && host.contains(selection.getRangeAt(0).commonAncestorContainer)) {
          try {
            const range = selection.getRangeAt(0);
            const preRange = document.createRange();
            preRange.selectNodeContents(host);
            preRange.setEnd(range.startContainer, range.startOffset);
            targetLine = getLineFromOffset(block, preRange.toString().length);
          } catch {
            // fallback
          }
        }
      }
      onSyncToPdf?.(targetLine);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === 's') {event.preventDefault(); onSave();}
    if (event.key.toLowerCase() === 'z') {event.preventDefault(); travel(event.shiftKey ? 'future' : 'past');}
    if (event.key.toLowerCase() === 'y') {event.preventDefault(); travel('future');}
    if (['b', 'i', 'u'].includes(event.key.toLowerCase())) {event.preventDefault(); format(event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : 'underline');}
  }}>
    <div className="visual-toolbar" role="toolbar" aria-label="Document formatting">
      <div className="visual-tool-group">
        <button className="visual-tool" aria-label="Undo" title="Undo (⌘/Ctrl Z)" disabled={readOnly || !history.current.past.length} onClick={() => travel('past')}><Undo2/></button>
        <button className="visual-tool" aria-label="Redo" title="Redo (⌘/Ctrl Shift Z)" disabled={readOnly || !history.current.future.length} onClick={() => travel('future')}><Redo2/></button>
      </div>
      <div className="visual-tool-group">
        <label className="visual-style-select"><span className="visually-hidden">Text style</span><select value={activeBlock?.kind === 'heading' ? activeBlock.command?.replace(/\*$/, '') : 'paragraph'} disabled={!editable || activeBlock?.kind === 'item'} onChange={event => changeStyle(event.target.value)}>
          {styles.map(([command, label]) => <option key={command} value={command}>{label}</option>)}
          {activeBlock?.command && !styles.some(([command]) => command === activeBlock.command?.replace(/\*$/, '')) ? <option value={activeBlock.command.replace(/\*$/, '')}>Heading</option> : null}
        </select><ChevronDown aria-hidden="true"/></label>
      </div>
      <div className="visual-tool-group">
        {([{name: 'bold', label: 'Bold', Icon: Bold}, {name: 'italic', label: 'Italic', Icon: Italic}, {name: 'underline', label: 'Underline', Icon: Underline}] as const).map(({name, label, Icon}) => <button key={name} className="visual-tool" aria-label={label} title={selectionExists ? label : `Select text to apply ${label.toLowerCase()}`} disabled={!editable || !selectionExists} onMouseDown={event => event.preventDefault()} onClick={() => format(name)}><Icon/></button>)}
      </div>
      <div className="visual-tool-group">
        <button className="visual-tool" aria-label="Bulleted list" title="Bulleted list" aria-pressed={activeBlock?.list === 'itemize'} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => makeList('itemize')}><List/></button>
        <button className="visual-tool" aria-label="Numbered list" title="Numbered list" aria-pressed={activeBlock?.list === 'enumerate'} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => makeList('enumerate')}><ListOrdered/></button>
      </div>
      <button className="visual-insert" type="button" disabled={readOnly || !documentModel.complete} onClick={() => addParagraph()}><Plus/>Text</button>
      {details.length ? <button className="visual-tool" type="button" aria-label="Document details" title="Document title and author" disabled={readOnly} onClick={() => setDetailsOpen(true)}><Settings2/></button> : null}
      <button className="visual-tool visual-help-button" aria-label="About Visual mode" title="About Visual mode" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}><CircleHelp/></button>
    </div>
    {helpOpen ? <div className="visual-guide"><FileText/><div><strong>Your document, without the syntax</strong><p>Click text to edit. Select words to format them. Enter starts a new paragraph or list item. Changes save and compile just like Code mode.</p><p>Equations, citations and custom LaTeX stay preserved. Use their Code action for advanced edits. Open PDF to check the final layout.</p></div></div> : null}
    {readOnly ? <div className="visual-access-note"><LockKeyhole/><span>Reading only. Request Edit to make changes.</span></div> : null}
    {!documentModel.complete ? <div className="visual-access-note"><Braces/><span>Document setup is incomplete. Finish it in Code mode to add content.</span><button type="button" onClick={() => onOpenCode(1)}>Open Code<ArrowUpRight/></button></div> : null}
    <div className="visual-scroll">
      <article className="visual-paper" aria-label={`Visual editor for ${path}`}>
        <div className="visual-paper-eyebrow"><AlignLeft aria-hidden="true"/><span>DOCUMENT</span><span className="visual-paper-hint">Click text to start writing</span></div>
        {documentModel.blocks.length ? documentModel.blocks.map((block, index) => {
          const listNumber = block.kind === 'item' ? documentModel.blocks.slice(0, index + 1).filter(item => item.listFrom === block.listFrom && item.kind === 'item').length : 0;
          return <div key={index} ref={element => {if (element) rows.current.set(index, element); else rows.current.delete(index);}}
            className={`visual-block visual-block-${block.kind}${active === index ? ' is-active' : ''}${highlightedIndex === index ? ' visual-synctex-highlight' : ''}${block.container ? ` visual-container-${block.container}` : ''}`}
            onClick={event => {
              if (event.altKey) handleAltClick(index, event);
            }}>
            {block.container === 'abstract' && documentModel.blocks[index - 1]?.container !== 'abstract' ? <div className="visual-container-label">Abstract</div> : null}
            {block.kind === 'protected' ? <div className="visual-protected-wrap">{block.label === 'Document title' && title ? <div className="visual-document-title">{title}{!readOnly ? <button className="visual-code-action" type="button" onClick={() => setDetailsOpen(true)}>Edit details</button> : null}</div> : null}<MathPreview source={value.slice(block.from, block.to)}/><div className="visual-protected-block"><div className="visual-protected-icon"><Braces/></div><div className="visual-protected-copy"><strong>{block.label}</strong><span>Preserved in your document · visible in PDF</span></div><button type="button" className="visual-code-action" onClick={() => onOpenCode(lineAt(block.from))}><Code2/>Code<ArrowUpRight/></button></div></div> : <>
              {block.kind === 'item' ? <span className="visual-list-marker" aria-hidden="true">{block.list === 'enumerate' ? `${listNumber}.` : '•'}</span> : null}
              <EditableBlock source={value.slice(block.contentFrom, block.contentTo)} index={index} block={block} readOnly={readOnly}
                register={(key, host) => {if (host) hosts.current.set(key, host); else hosts.current.delete(key);}}
                onEdit={edit} onFocus={key => {setActive(key); savedSelection.current = null; onCursorLineChange?.(lineAt(block.contentFrom));}} onEnter={splitBlock} onBoundary={joinBlocks}
                onAltClick={handleAltClick}/>
              {value.slice(block.contentFrom, block.contentTo).includes('\\') || value.slice(block.contentFrom, block.contentTo).includes('$') ? <button className="visual-block-code" type="button" aria-label={`Edit block ${index + 1} in Code mode`} title="Edit this block in Code mode" onClick={() => onOpenCode(lineAt(block.from))}><Code2/></button> : null}
            </>}
          </div>;
        }) : <div className="visual-empty"><FilePenIllustration/><h2>A blank page, ready for your ideas</h2><p>Write naturally. Visual mode takes care of the LaTeX.</p><button className="button button-primary" type="button" disabled={readOnly || !documentModel.complete} onClick={() => addParagraph()}><Plus/>Start writing</button></div>}
        {documentModel.blocks.length && !readOnly && documentModel.complete ? <button className="visual-add-block" type="button" onClick={() => addParagraph(true)}><Plus/>Add a paragraph</button> : null}
      </article>
    </div>
    {detailsOpen ? <DocumentDetails source={value} onChange={update} onClose={() => setDetailsOpen(false)} onOpenCode={onOpenCode}/> : null}
    <div className="visual-footer"><span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span><span>{protectedCount ? `${protectedCount} ${protectedCount === 1 ? 'block' : 'blocks'} preserved · ` : ''}Final layout in PDF</span></div>
  </div>;
});

function MathPreview({source}: {source: string}) {
  const host = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  useEffect(() => {if (host.current) setRendered(renderMath(host.current, source, true));}, [source]);
  return <div ref={host} className="visual-display-math" hidden={!rendered}/>;
}

function FilePenIllustration() {return <div className="visual-empty-icon"><FileText/><span><Plus/></span></div>;}
