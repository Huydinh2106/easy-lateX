import katex from 'katex';
import 'katex/dist/katex.min.css';

export function mathExpression(source: string): string | null {
  if (source.startsWith('$$') && source.endsWith('$$')) return source.slice(2, -2);
  if (source.startsWith('$') && source.endsWith('$')) return source.slice(1, -1);
  if ((source.startsWith('\\(') && source.endsWith('\\)')) || (source.startsWith('\\[') && source.endsWith('\\]'))) return source.slice(2, -2);
  const environment = /^\\begin\{(equation\*?|align\*?|gather\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/.exec(source);
  if (!environment) return null;
  const body = environment[2]!.replace(/\\label\{[^}]*\}/g, '');
  return environment[1]!.startsWith('align') ? `\\begin{aligned}${body}\\end{aligned}` : environment[1]!.startsWith('gather') ? `\\begin{gathered}${body}\\end{gathered}` : body;
}

/** Project macros are not executed; unsupported expressions retain the protected fallback. */
export function renderMath(host: HTMLElement, source: string, displayMode = false): boolean {
  const expression = mathExpression(source);
  if (expression === null || expression.length > 12000) return false;
  try {
    katex.render(expression, host, {displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20, output: 'htmlAndMathml'});
    return true;
  } catch {
    host.replaceChildren();
    return false;
  }
}
