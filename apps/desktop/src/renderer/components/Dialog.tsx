import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  label?: string;
  closeLabel?: string;
  busy?: boolean;
  children: ReactNode;
  onClose(): void;
}

/** Shared keyboard and focus behavior for collaboration dialogs. */
export function Dialog({title,description,label,closeLabel='Close dialog',busy=false,children,onClose}: Props) {
  const ref = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    (ref.current?.querySelector<HTMLElement>('[data-autofocus]')
      ?? ref.current?.querySelector<HTMLElement>('input:not(:disabled)')
      ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="dashboard-dialog-backdrop" onMouseDown={event => {if (!busy && event.target === event.currentTarget) onClose();}}>
    <section ref={ref} className="dashboard-dialog collaboration-dialog" role="dialog" aria-modal="true" aria-label={label} aria-labelledby={label ? undefined : `${id}-title`} aria-describedby={description ? `${id}-description` : undefined} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]') ?? [])]
        .filter(element => !element.closest('details:not([open])') || element.tagName === 'SUMMARY');
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <header className="dashboard-dialog-header"><div><h2 id={`${id}-title`}>{title}</h2>{description ? <p id={`${id}-description`}>{description}</p> : null}</div><button type="button" aria-label={closeLabel} disabled={busy} onClick={onClose}><X aria-hidden="true"/></button></header>
      {children}
    </section>
  </div>;
}
