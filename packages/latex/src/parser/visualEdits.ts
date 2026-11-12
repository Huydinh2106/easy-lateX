import { parseVisualDocument, replaceVisualRange, type VisualBlock } from './visualDocument';

export interface VisualEditResult { source: string; focusIndex: number; emptyAt?: number; }
export function setVisualStyle(source: string, block: VisualBlock, style: string): string {
  if (!['paragraph', 'section', 'subsection', 'subsubsection'].includes(style) || block.kind === 'protected' || block.kind === 'item') return source;
  const content = source.slice(block.contentFrom, block.contentTo);
  // Keep starred headings unnumbered when changing their level.
  const command = style + (block.command?.endsWith('*') ? '*' : '');
  return replaceVisualRange(source, block.from, block.to, style === 'paragraph' ? content : `\\${command}{${content}}`);
}
export function setVisualList(source: string, block: VisualBlock, type: 'itemize' | 'enumerate'): string {
  if (block.kind === 'protected') return source;
  if (block.kind === 'item' && block.listFrom !== undefined && block.listTo !== undefined) {
    if (block.list === type) {
      const content = parseVisualDocument(source).blocks.filter(item => item.kind === 'item' && item.listFrom === block.listFrom).map(item => source.slice(item.contentFrom, item.contentTo)).join('\n\n');
      return replaceVisualRange(source, block.listFrom, block.listTo, content);
    }
    const raw = source.slice(block.listFrom, block.listTo).replace(`\\begin{${block.list}}`, `\\begin{${type}}`).replace(`\\end{${block.list}}`, `\\end{${type}}`);
    return replaceVisualRange(source, block.listFrom, block.listTo, raw);
  }
  return replaceVisualRange(source, block.from, block.to, `\\begin{${type}}\n\\item ${source.slice(block.contentFrom, block.contentTo)}\n\\end{${type}}`);
}
export function insertVisualParagraph(source: string, at: number, blocks: VisualBlock[]): VisualEditResult {
  return {source: replaceVisualRange(source, at, at, '\n\n\n\n'), emptyAt: at + 2, focusIndex: blocks.filter(block => block.from < at).length};
}
export function splitVisualBlock(source: string, blocks: VisualBlock[], index: number, before: string, after: string): VisualEditResult | null {
  const block = blocks[index];
  if (!block || block.kind === 'protected') return null;
  if (block.kind === 'item') {
    if (!before && !after && block.listTo !== undefined && block.listFrom !== undefined) {
      const listItems = blocks.filter(item => item.listFrom === block.listFrom);
      const removeFrom = listItems.length === 1 ? block.listFrom : block.from;
      const removeTo = listItems.length === 1 ? block.listTo : block.to;
      const withoutItem = replaceVisualRange(source, removeFrom, removeTo, '');
      const at = block.listTo - (removeTo - removeFrom);
      return insertVisualParagraph(withoutItem, at, parseVisualDocument(withoutItem).blocks);
    }
    return {source: replaceVisualRange(source, block.contentFrom, block.contentTo, `${before}\n\\item ${after}`), focusIndex: index + 1};
  }
  const left = block.kind === 'heading' ? `\\${block.command}{${before}}` : before;
  return {source: replaceVisualRange(source, block.from, block.to, `${left}\n\n${after}`), focusIndex: before || block.kind === 'heading' ? index + 1 : index, ...(!after ? {emptyAt: block.from + left.length + 2} : {})};
}
/** Backspace at a block boundary joins prose or neighboring items in the same list. */
export function mergeVisualBlocks(source: string, previous: VisualBlock, current: VisualBlock): string | null {
  const sameList = previous.kind === 'item' && current.kind === 'item' && previous.listFrom === current.listFrom;
  const prose = previous.kind === 'paragraph' && current.kind === 'paragraph' && previous.container === current.container;
  if (!sameList && !prose) return null;
  // Do not cross comments, commands or wrapper boundaries between paragraphs.
  if (prose && source.slice(previous.to, current.from).trim()) return null;
  const before = source.slice(previous.contentFrom, previous.contentTo);
  const after = source.slice(current.contentFrom, current.contentTo);
  return replaceVisualRange(source, previous.contentFrom, current.contentTo, before + after);
}
