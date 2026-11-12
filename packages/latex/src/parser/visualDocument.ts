/** A conservative, range-based projection. Unchanged LaTeX is never regenerated. */
export type VisualBlockKind = 'paragraph' | 'heading' | 'item' | 'protected';
export interface VisualBlock {
  kind: VisualBlockKind;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  command?: string;
  list?: 'itemize' | 'enumerate';
  listFrom?: number;
  listTo?: number;
  label?: string;
  container?: string;
}
export interface VisualDocument {
  blocks: VisualBlock[];
  bodyFrom: number;
  bodyTo: number;
  complete: boolean;
}
export interface InlineNode {
  kind: 'text' | 'bold' | 'italic' | 'underline' | 'opaque';
  source: string;
  text?: string;
  command?: string;
  children?: InlineNode[];
}

const headingCommands = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']);
const marks: Record<string, 'bold' | 'italic' | 'underline'> = {textbf: 'bold', textit: 'italic', emph: 'italic', underline: 'underline'};

export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, character => ({'\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}'}[character] ?? `\\${character}`));
}
function escaped(source: string, at: number): boolean {
  let count = 0;
  while (at > 0 && source[--at] === '\\') count++;
  return count % 2 === 1;
}
/** Returns the position after a balanced group, skipping escaped braces and comments. */
function groupEnd(source: string, at: number, open = '{', close = '}'): number | null {
  if (source[at] !== open) return null;
  let depth = 1;
  for (let index = at + 1; index < source.length; index++) {
    if (source[index] === '%' && !escaped(source, index)) {index = source.indexOf('\n', index); if (index < 0) return null; continue;}
    if (escaped(source, index)) continue;
    if (source[index] === open) depth++;
    if (source[index] === close && --depth === 0) return index + 1;
  }
  return null;
}
function commandAt(source: string, at: number): {name: string; end: number} | null {
  const match = /^\\([a-zA-Z@]+\*?|[^\s])/.exec(source.slice(at));
  return match ? {name: match[1]!, end: at + match[0].length} : null;
}
function argumentsEnd(source: string, at: number): number {
  let end = at;
  while (end < source.length) {
    const whitespace = /^[ \t]*/.exec(source.slice(end))![0].length;
    const start = end + whitespace;
    const delimiter = source[start];
    if (delimiter !== '{' && delimiter !== '[') break;
    const next = groupEnd(source, start, delimiter, delimiter === '{' ? '}' : ']');
    if (next === null) return source.length;
    end = next;
  }
  return end;
}
function inlineCommandEnd(source: string, command: {name: string; end: number}): number {
  if (/^verb\*?$/.test(command.name)) {
    const delimiter = source[command.end];
    const close = delimiter ? source.indexOf(delimiter, command.end + 1) : -1;
    return close < 0 ? source.length : close + 1;
  }
  return argumentsEnd(source, command.end);
}
function environmentEnd(source: string, at: number, depth = 0): {end: number; name: string; innerFrom: number; innerTo: number; closed: boolean} | null {
  const start = /^\\begin\{([^}]+)\}/.exec(source.slice(at));
  if (!start) return null;
  if (depth > 64) return {name: start[1]!, innerFrom: at, innerTo: source.length, end: source.length, closed: false};
  const name = start[1]!;
  const innerFrom = at + start[0].length;
  // Verbatim bodies do not follow ordinary TeX token rules.
  if (/^(verbatim\*?|lstlisting|minted|comment)$/.test(name)) {
    const close = `\\end{${name}}`;
    const innerTo = source.indexOf(close, innerFrom);
    return {name, innerFrom, innerTo: innerTo < 0 ? source.length : innerTo, end: innerTo < 0 ? source.length : innerTo + close.length, closed: innerTo >= 0};
  }
  for (let index = innerFrom; index < source.length;) {
    if (source[index] === '%' && !escaped(source, index)) {const newline = source.indexOf('\n', index); index = newline < 0 ? source.length : newline + 1; continue;}
    if (source[index] === '$' || source.startsWith('\\(', index) || source.startsWith('\\[', index)) {index = mathEnd(source, index); continue;}
    if (source[index] === '\\' && !escaped(source, index)) {
      const token = /^\\(begin|end)\{([^}]+)\}/.exec(source.slice(index));
      if (token) {
        if (token[1] === 'begin') {
          const nested = environmentEnd(source, index, depth + 1);
          if (!nested?.closed) return {name, innerFrom, innerTo: source.length, end: source.length, closed: false};
          index = nested.end; continue;
        }
        if (token[2] !== name) return {name, innerFrom, innerTo: source.length, end: source.length, closed: false};
        return {name, innerFrom, innerTo: index, end: index + token[0].length, closed: true};
      }
      const command = commandAt(source, index);
      if (command?.name === 'verb' || command?.name === 'verb*') {
        const delimiter = source[command.end];
        const end = delimiter ? source.indexOf(delimiter, command.end + 1) : -1;
        index = end < 0 ? source.length : end + 1; continue;
      }
      if (command) {index = inlineCommandEnd(source, command); continue;}
    }
    index++;
  }
  return {name, innerFrom, innerTo: source.length, end: source.length, closed: false};
}
function mathEnd(source: string, at: number): number {
  const delimiter = source.startsWith('$$', at) ? '$$' : source.startsWith('\\[', at) ? '\\]' : source.startsWith('\\(', at) ? '\\)' : '$';
  const openingLength = delimiter.length;
  for (let index = at + openingLength; index < source.length; index++) {
    if (source.startsWith(delimiter, index) && !escaped(source, index)) return index + delimiter.length;
  }
  return source.length;
}

export function parseInline(source: string, depth = 0): InlineNode[] {
  if (depth > 64) return [{kind: 'opaque', source, text: 'Custom formatting'}];
  const nodes: InlineNode[] = [];
  let plain = '';
  const flush = () => {if (plain) {nodes.push({kind: 'text', source: plain, text: plain.replace(/\r?\n[ \t]*/g, ' ').replace(/~/g, '\u00a0')}); plain = '';}};
  for (let at = 0; at < source.length;) {
    const character = source[at]!;
    if (character === '$' || source.startsWith('\\(', at) || source.startsWith('\\[', at)) {
      flush(); const end = mathEnd(source, at); nodes.push({kind: 'opaque', source: source.slice(at, end), text: 'Equation'}); at = end; continue;
    }
    if (character === '%') {
      flush(); const end = source.indexOf('\n', at); const to = end < 0 ? source.length : end + 1;
      nodes.push({kind: 'opaque', source: source.slice(at, to), text: 'Comment'}); at = to; continue;
    }
    if (character === '\\') {
      flush(); const command = commandAt(source, at);
      if (!command) {nodes.push({kind: 'opaque', source: source.slice(at), text: 'LaTeX'}); break;}
      if (['%', '&', '#', '$', '_', '{', '}'].includes(command.name)) {
        nodes.push({kind: 'text', source: source.slice(at, command.end), text: command.name}); at = command.end; continue;
      }
      const literals: Record<string, string> = {textbackslash: '\\', textasciicircum: '^', textasciitilde: '~'};
      if (literals[command.name] && source.startsWith('{}', command.end)) {
        nodes.push({kind: 'text', source: source.slice(at, command.end + 2), text: literals[command.name]!}); at = command.end + 2; continue;
      }
      const mark = marks[command.name];
      if (mark && source[command.end] === '{') {
        const end = groupEnd(source, command.end);
        if (end !== null) {nodes.push({kind: mark, source: source.slice(at, end), command: command.name, children: parseInline(source.slice(command.end + 1, end - 1), depth + 1)}); at = end; continue;}
      }
      let end = argumentsEnd(source, command.end);
      if (/^verb\*?$/.test(command.name)) {const delimiter = source[command.end]; const close = delimiter ? source.indexOf(delimiter, command.end + 1) : -1; end = close < 0 ? source.length : close + 1;}
      const labels: Record<string, string> = {cite: 'Citation', citep: 'Citation', citet: 'Citation', ref: 'Reference', eqref: 'Reference', label: 'Label', includegraphics: 'Image', input: 'Included file', include: 'Included file', maketitle: 'Document title', tableofcontents: 'Table of contents', clearpage: 'Page break', newpage: 'Page break', '\\': 'Line break'};
      nodes.push({kind: 'opaque', source: source.slice(at, end), text: labels[command.name] ?? command.name}); at = end; continue;
    }
    if ('{}&#_^'.includes(character)) {
      // Bare grouping and alignment syntax may affect surrounding text: keep it opaque.
      flush(); const end = character === '{' ? groupEnd(source, at) ?? source.length : at + 1;
      nodes.push({kind: 'opaque', source: source.slice(at, end), text: 'LaTeX'}); at = end; continue;
    }
    plain += character; at++;
  }
  flush(); return nodes;
}

function protectedBlock(from: number, to: number, label: string): VisualBlock {
  return {kind: 'protected', from, to, contentFrom: from, contentTo: to, label};
}
function parseBody(source: string, from: number, to: number): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  let at = from;
  while (at < to) {
    if (/\s/.test(source[at]!)) {at++; continue;}
    const start = at;
    if (source[at] === '%') {
      const newline = source.indexOf('\n', at); at = newline < 0 ? to : Math.min(to, newline);
      blocks.push(protectedBlock(start, at, 'Comment')); continue;
    }
    const command = commandAt(source, at);
    if (command && headingCommands.has(command.name.replace(/\*$/, ''))) {
      const contentStart = command.end + /^[ \t]*/.exec(source.slice(command.end))![0].length;
      const end = groupEnd(source, contentStart);
      if (end !== null && end <= to) {
        blocks.push({kind: 'heading', from: start, to: end, contentFrom: contentStart + 1, contentTo: end - 1, command: command.name}); at = end; continue;
      }
    }
    if (source.startsWith('\\begin{', at)) {
      const environment = environmentEnd(source.slice(0, to), at);
      if (environment) {
        const {name, end, innerFrom, innerTo, closed} = environment;
        if (closed && ['abstract', 'quote', 'quotation', 'center'].includes(name)) {
          const children = parseBody(source, innerFrom, innerTo);
          if (children.length) {blocks.push(...children.map(block => ({...block, container: name}))); at = end; continue;}
        }
        if (closed && (name === 'itemize' || name === 'enumerate')) {
          const inner = source.slice(innerFrom, innerTo);
          const items: {index: number; length: number}[] = [];
          for (let position = 0; position < inner.length;) {
            if (inner[position] === '{') {position = groupEnd(inner, position) ?? inner.length; continue;}
            if (inner[position] === '$' || inner.startsWith('\\(', position)) {position = mathEnd(inner, position); continue;}
            if (inner[position] === '\\') {
              const token = commandAt(inner, position);
              if (token) {
                if (token.name === 'item') {const length = token.end - position + /^[ \t]*/.exec(inner.slice(token.end))![0].length; items.push({index: position, length}); position += length; continue;}
                position = argumentsEnd(inner, token.end); continue;
              }
            }
            position++;
          }
          // Nested lists, custom labels, options and comments remain intact as a protected block.
          if (items.length && !inner.slice(0, items[0]!.index).trim() && !/\\begin|%|\\item\s*\[/.test(inner)) {
            items.forEach((item, index) => {
              const itemFrom = innerFrom + item.index;
              const itemTo = index + 1 < items.length ? innerFrom + items[index + 1]!.index : innerTo;
              const contentFrom = itemFrom + item.length;
              const contentTo = contentFrom + source.slice(contentFrom, itemTo).trimEnd().length;
              blocks.push({kind: 'item', from: itemFrom, to: itemTo, contentFrom, contentTo, list: name, listFrom: start, listTo: end});
            });
            at = end; continue;
          }
        }
        const labels: Record<string, string> = {tabular: 'Table', 'tabular*': 'Table', tabularx: 'Table', table: 'Table', figure: 'Figure', equation: 'Equation', 'equation*': 'Equation', align: 'Equations', 'align*': 'Equations', abstract: 'Abstract', tikzpicture: 'Diagram', itemize: 'Custom list', enumerate: 'Custom list', verbatim: 'Verbatim text'};
        blocks.push(protectedBlock(start, end, closed ? labels[name] ?? name : 'Incomplete LaTeX block')); at = end; continue;
      }
    }
    if (source.startsWith('\\[', at) || source.startsWith('$$', at)) {
      at = Math.min(to, mathEnd(source, at)); blocks.push(protectedBlock(start, at, 'Equation')); continue;
    }
    // Stop at paragraph boundaries or structural commands, but never inside a group or math.
    while (at < to) {
      if (at > start && (/^\r?\n[ \t]*\r?\n/.test(source.slice(at)) || /^\\(?:begin|end|part|chapter|section|subsection|subsubsection|paragraph|subparagraph|maketitle|tableofcontents)\b/.test(source.slice(at)))) break;
      if (source[at] === '%') {const newline = source.indexOf('\n', at); at = newline < 0 ? to : Math.min(to, newline + 1); continue;}
      if (source[at] === '$' || source.startsWith('\\(', at) || source.startsWith('\\[', at)) {at = Math.min(to, mathEnd(source, at)); continue;}
      if (source[at] === '{') {at = Math.min(to, groupEnd(source, at) ?? to); continue;}
      if (source[at] === '\\') {
        const token = commandAt(source, at);
        if (token) {
          if (/^verb\*?$/.test(token.name)) {const delimiter = source[token.end]; const close = delimiter ? source.indexOf(delimiter, token.end + 1) : -1; at = close < 0 ? to : close + 1; continue;}
          at = Math.min(to, argumentsEnd(source, token.end)); continue;
        }
      }
      at++;
    }
    const end = start + source.slice(start, at).trimEnd().length;
    if (end > start) {
      const raw = source.slice(start, end);
      // Commands which change TeX interpretation must never be edited as prose.
      const unsafe = /\\(?:def|gdef|edef|xdef|let|catcode|newcommand|renewcommand|newenvironment|renewenvironment|if[a-zA-Z]*|else|fi|verb\*?|end|documentclass|usepackage)\b/.test(raw);
      const onlyOpaque = parseInline(raw).every(node => node.kind === 'opaque');
      blocks.push(unsafe || onlyOpaque ? protectedBlock(start, end, unsafe ? 'LaTeX block' : parseInline(raw)[0]?.text ?? 'LaTeX block') : {kind: 'paragraph', from: start, to: end, contentFrom: start, contentTo: end});
    }
    if (at === start) at++;
  }
  return blocks;
}

export function parseVisualDocument(source: string): VisualDocument {
  // Locate document boundaries using the same structural scanner as the body.
  // This skips comments, macro arguments and verbatim environments in the preamble.
  let bodyFrom = 0, bodyTo = source.length;
  let found = false, complete = true;
  for (let at = 0; at < source.length;) {
    if (source[at] === '%') {const next = source.indexOf('\n', at); at = next < 0 ? source.length : next + 1; continue;}
    if (source.startsWith('\\begin{document}', at)) {bodyFrom = at + '\\begin{document}'.length; found = true; break;}
    if (source.startsWith('\\begin{', at)) {const env = environmentEnd(source, at); if (env) {at = env.end; continue;}}
    if (source[at] === '\\') {const command = commandAt(source, at); if (command) {at = inlineCommandEnd(source, command); continue;}}
    if (source[at] === '{') {at = groupEnd(source, at) ?? source.length; continue;}
    at++;
  }
  if (found) {
    let at = bodyFrom;
    complete = false;
    while (at < source.length) {
      if (source[at] === '%') {const next = source.indexOf('\n', at); at = next < 0 ? source.length : next + 1; continue;}
      if (source.startsWith('\\end{document}', at)) {bodyTo = at; complete = true; break;}
      if (source.startsWith('\\begin{', at)) {const env = environmentEnd(source, at); if (env) {at = env.end; continue;}}
      if (source[at] === '{') {at = groupEnd(source, at) ?? source.length; continue;}
      if (source[at] === '\\') {const command = commandAt(source, at); if (command) {at = inlineCommandEnd(source, command); continue;}}
      at++;
    }
  } else if (/\\(?:documentclass|usepackage)\b/.test(source)) {
    // A preamble being written by an agent is not a body fragment.
    return {blocks: source.trim() ? [protectedBlock(0, source.length, 'Document setup')] : [], bodyFrom: source.length, bodyTo: source.length, complete: false};
  }
  return {blocks: parseBody(source, bodyFrom, bodyTo), bodyFrom, bodyTo, complete};
}

export function replaceVisualRange(source: string, from: number, to: number, replacement: string): string {
  if (from < 0 || to < from || to > source.length) throw new Error('Invalid visual edit range');
  return source.slice(0, from) + replacement + source.slice(to);
}

export interface DocumentDetail {name: 'title' | 'author' | 'date'; from: number; to: number; content: string;}
/** Metadata ranges in the preamble, excluding macro definitions and comments. */
export function parseDocumentDetails(source: string): DocumentDetail[] {
  const details: DocumentDetail[] = [];
  for (let at = 0; at < source.length;) {
    if (source.startsWith('\\begin{document}', at)) break;
    if (source[at] === '%') {const next = source.indexOf('\n', at); at = next < 0 ? source.length : next + 1; continue;}
    if (source.startsWith('\\begin{', at)) {const environment = environmentEnd(source, at); if (environment) {at = environment.end; continue;}}
    if (source[at] === '{') {at = groupEnd(source, at) ?? source.length; continue;}
    if (source[at] === '\\') {
      const command = commandAt(source, at);
      if (command) {
        if ((command.name === 'title' || command.name === 'author' || command.name === 'date') && source[command.end] === '{') {
          const end = groupEnd(source, command.end);
          if (end !== null) details.push({name: command.name, from: command.end + 1, to: end - 1, content: source.slice(command.end + 1, end - 1)});
        }
        at = inlineCommandEnd(source, command); continue;
      }
    }
    at++;
  }
  return details;
}
