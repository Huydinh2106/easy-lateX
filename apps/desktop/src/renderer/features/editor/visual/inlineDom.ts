import { renderMath } from './mathPreview';
import { escapeLatex, parseInline, type InlineNode } from '@easy-latex/latex';

/** Build DOM without interpreting document text as HTML. */
export function renderInline(host: HTMLElement, source: string) {
  const render = (nodes: InlineNode[], parent: HTMLElement) => {
    for (const node of nodes) {
      const element = document.createElement(node.text === 'Line break' ? 'br' : node.kind === 'bold' ? 'strong' : node.kind === 'italic' ? 'em' : node.kind === 'underline' ? 'u' : 'span');
      if (node.kind === 'text') {
        element.dataset.original = node.source;
        element.dataset.display = node.text ?? '';
        element.textContent = node.text ?? '';
      } else if (node.kind === 'opaque') {
        element.contentEditable = 'false';
        element.dataset.latex = node.source;
        element.className = 'visual-inline-token';
        element.title = `${node.text ?? 'LaTeX'} · preserved in source`;
        if (node.text === 'Line break') {parent.append(element); continue;}
        if (node.text === 'Equation' && renderMath(element, node.source)) element.className = 'visual-inline-math';
        else element.textContent = node.text ?? 'LaTeX';
      } else {
        element.dataset.command = node.command ?? '';
        render(node.children ?? [], element);
      }
      parent.append(element);
    }
  };
  host.replaceChildren();
  render(parseInline(source), host);
}

export function serializeInline(host: HTMLElement): string {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeLatex((node.textContent ?? '').replace(/\u00a0/g, ' '));
    if (!(node instanceof HTMLElement)) return '';
    if (node.dataset.latex !== undefined) return node.dataset.latex;
    if (node.dataset.original !== undefined && node.textContent === node.dataset.display && !node.querySelector('strong, b, em, i, u, [data-latex]')) return node.dataset.original;
    const content = [...node.childNodes].map(serialize).join('');
    const command = node.tagName === 'STRONG' || node.tagName === 'B' ? 'textbf' : node.tagName === 'EM' || node.tagName === 'I' ? (node.dataset.command === 'emph' ? 'emph' : 'textit') : node.tagName === 'U' ? 'underline' : null;
    if (command) return `\\${command}{${content}}`;
    if (node.tagName === 'BR') return '';
    if (node.tagName === 'DIV' || node.tagName === 'P') return `\n${content}`;
    return content;
  };
  return [...host.childNodes].map(serialize).join('');
}

export function insertPlainText(text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
}

export function insertLineBreak() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const lineBreak = document.createElement('br');
  lineBreak.dataset.latex = '\\\\' + '\n';
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
}
