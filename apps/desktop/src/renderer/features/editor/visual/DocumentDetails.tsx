import { useMemo, useState } from 'react';
import { escapeLatex, parseDocumentDetails, parseInline, replaceVisualRange, type InlineNode } from '@easy-latex/latex';
import { Dialog } from '../../../components/Dialog';

function plainText(nodes: InlineNode[]): string | null {
  let text = '';
  for (const node of nodes) {
    if (node.kind === 'opaque') return null;
    const child = node.children ? plainText(node.children) : node.text ?? '';
    if (child === null) return null;
    text += child;
  }
  return text;
}
export function documentTitle(source: string): string | null {
  const title = parseDocumentDetails(source).find(detail => detail.name === 'title');
  return title ? plainText(parseInline(title.content)) : null;
}
export function DocumentDetails({source, onChange, onClose, onOpenCode}: {source: string; onChange(source: string): void; onClose(): void; onOpenCode(line: number): void}) {
  const [snapshot] = useState(source);
  const details = useMemo(() => parseDocumentDetails(snapshot), [snapshot]);
  const externalChange = source !== snapshot;
  const initial = useMemo(() => details.map(detail => plainText(parseInline(detail.content))), [details]);
  const [values, setValues] = useState(initial);
  const changed = values.some((value, index) => value !== initial[index]);
  return <Dialog title="Document details" description="Update the title and author shown in your document." onClose={onClose}>
    <form className="visual-details-form" onSubmit={event => {
      event.preventDefault();
      if (externalChange) return;
      let next = source;
      for (let index = details.length - 1; index >= 0; index--) {
        const detail = details[index]!, value = values[index];
        if (value !== null && value !== undefined && value !== initial[index]) next = replaceVisualRange(next, detail.from, detail.to, escapeLatex(value));
      }
      onChange(next); onClose();
    }}>
      {details.map((detail, index) => <label key={detail.from}>{detail.name === 'title' ? 'Title' : detail.name === 'author' ? 'Author' : 'Date'}
        {initial[index] === null ? <span className="visual-details-custom">This field uses custom LaTeX.<button type="button" className="button button-secondary" onClick={() => {onClose(); onOpenCode(source.slice(0, detail.from).split('\n').length);}}>Edit in Code</button></span> : <input value={values[index] ?? ''} onChange={event => setValues(current => current.map((value, key) => key === index ? event.target.value : value))}/>}
      </label>)}
      {externalChange ? <p role="alert">The document changed while this dialog was open. Reopen details to edit the latest version.</p> : null}
      <div className="visual-details-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={!changed || externalChange}>Apply changes</button></div>
    </form>
  </Dialog>;
}
