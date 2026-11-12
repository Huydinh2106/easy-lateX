import { describe, expect, it } from 'vitest';
import { parseVisualDocument, parseDocumentDetails } from '../src/parser/visualDocument';
import { setVisualList, setVisualStyle, splitVisualBlock, mergeVisualBlocks } from '../src/parser/visualEdits';

describe('visual structure edits', () => {
  it('keeps unnumbered headings unnumbered', () => {
    const source = '\\section*{A title}';
    expect(setVisualStyle(source, parseVisualDocument(source).blocks[0]!, 'subsection')).toBe('\\subsection*{A title}');
  });
  it('toggles a list off while preserving inline markup and neighboring source', () => {
    const source = '\\begin{itemize}\n\\item First \\textbf{item}\n\\item Second\n\\end{itemize}\n\nAfter.';
    const block = parseVisualDocument(source).blocks[0]!;
    expect(setVisualList(source, block, 'itemize')).toBe('First \\textbf{item}\n\nSecond\n\nAfter.');
  });
  it('does not mistake an item command inside a macro argument for another item', () => {
    const source = '\\begin{itemize}\n\\item \\custom{\\item literal}\n\\item Real\n\\end{itemize}';
    expect(parseVisualDocument(source).blocks).toHaveLength(2);
  });
  it('exits a single empty list without leaving an invalid empty environment', () => {
    const source = '\\begin{itemize}\n\\item \n\\end{itemize}';
    const result = splitVisualBlock(source, parseVisualDocument(source).blocks, 0, '', '');
    expect(result?.source).not.toContain('itemize');
    expect(result?.emptyAt).toBeDefined();
  });
  it('joins prose without crossing protected environment boundaries', () => {
    const source = 'First.\n\nSecond.';
    const [first, second] = parseVisualDocument(source).blocks;
    expect(mergeVisualBlocks(source, first!, second!)).toBe('First.Second.');
    const wrapped = 'First.\n\n\\begin{quote}Second.\\end{quote}';
    const blocks = parseVisualDocument(wrapped).blocks;
    expect(mergeVisualBlocks(wrapped, blocks[0]!, blocks[1]!)).toBeNull();
  });
  it('parses document metadata without reading comments or macro bodies', () => {
    const source = '% \\title{Comment}\n\\newcommand{\\foo}{\\title{Hidden}}\n\\title{Actual title}\n\\begin{document}\\title{Body}\\end{document}';
    expect(parseDocumentDetails(source).map(detail => detail.content)).toEqual(['Actual title']);
  });
});
