import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { AccountState } from "@easy-latex/shared-types";
import { AccountPanel } from "./AccountPanel";

export function AccountDialog({state, onChanged, onClose}: {state: AccountState; onChanged(state: AccountState): void; onClose(): void}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {if (previous instanceof HTMLElement) previous.focus();};
  }, []);
  return <div className="dashboard-dialog-backdrop account-dialog-backdrop" onMouseDown={event => {if (event.target === event.currentTarget) onClose();}}>
    <div ref={dialog} className="account-dialog" role="dialog" aria-modal="true" aria-label="Sign in to collaborate" onKeyDown={event => {
      if (event.key === "Escape") {event.stopPropagation(); onClose();}
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href]') ?? [])]
        .filter(element => !element.closest('details:not([open])') || element.tagName === 'SUMMARY');
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    }}>
      <button className="account-dialog-close" type="button" aria-label="Close sign-in" onClick={onClose}><X /></button>
      <AccountPanel state={state} onChanged={onChanged}/>
    </div>
  </div>;
}
