import { useId, useState } from 'react';
import { AlertCircle, ArrowUpRight, ChevronRight, Github, LoaderCircle, LockKeyhole, Server, ShieldCheck } from 'lucide-react';
import type { AccountState } from '@easy-latex/shared-types';
import { errorMessage } from '../collaboration/utils';

interface Props { state: AccountState; onChanged(state: AccountState): void; }

export function AccountPanel({state,onChanged}: Props) {
  const [pending,setPending] = useState<'signin'|'server'|null>(null);
  const [error,setError] = useState('');
  const [server,setServer] = useState(state.apiUrl ?? '');
  const fieldId = useId();
  const busy = pending !== null;
  let serverLabel = '';
  try { serverLabel = state.apiUrl ? new URL(state.apiUrl).host : ''; } catch { /* A saved URL is validated in main. */ }

  const connection = <details className="account-connection" open={!state.configured || undefined}>
    <summary><Server aria-hidden="true"/><span>Connection settings</span><ChevronRight className="account-connection-chevron" aria-hidden="true"/></summary>
    <form onSubmit={event => {
      event.preventDefault(); setPending('server'); setError('');
      void window.desktop.auth.configure(server.trim()).then(onChanged).catch(e => setError(errorMessage(e))).finally(() => setPending(null));
    }}>
      <label htmlFor={fieldId}>Collaboration server</label>
      <input id={fieldId} type="url" required value={server} placeholder="https://your-server.example" autoComplete="url" spellCheck={false}
        aria-describedby={`${fieldId}-help`} disabled={busy} onChange={event => setServer(event.target.value)}/>
      <small id={`${fieldId}-help`}>Use the address provided by your project administrator.</small>
      <button className="button button-secondary" disabled={busy || !server.trim()}>{pending === 'server' ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : null}{pending === 'server' ? 'Saving…' : 'Save server'}</button>
    </form>
  </details>;

  return <section className="account-card" aria-label="Account" aria-busy={busy}>
    <span className="account-mark" aria-hidden="true">{state.configured ? <Github/> : <Server/>}</span>
    <p className="account-eyebrow">YOUR WRITING, TOGETHER</p>
    <h2>{state.configured ? 'Sign in to collaborate' : 'Connect to collaborate'}</h2>
    <p className="account-description">{state.configured
      ? 'Bring your projects and collaborators together with GitHub.'
      : 'Enter your collaboration server to get started. Your local projects are always available.'}</p>

    {state.configured ? <div className="account-benefits">
      <div><LockKeyhole aria-hidden="true"/><span><strong>Private projects</strong><small>You choose which repositories the app can access.</small></span></div>
      <div><ShieldCheck aria-hidden="true"/><span><strong>Sign in in your browser</strong><small>Authorize Easy LaTeX and install its GitHub App.</small></span></div>
    </div> : null}

    {state.sessionPersistence === 'memory' ? <div className="account-feedback account-feedback-warning" role="status">
      <LockKeyhole aria-hidden="true"/><span><strong>Sign-in won't be remembered</strong><small>Your system key store is unavailable. You will need to sign in again after closing the app. Unlock your system key store and restart Easy LaTeX to try again.</small></span>
    </div> : null}
    {error ? <div className="account-feedback account-feedback-error" role="alert"><AlertCircle aria-hidden="true"/><span><strong>Unable to continue</strong><small>{error}</small></span></div> : null}

    {state.configured ? <div className="account-signin-actions">
      <button className="button button-primary account-continue" disabled={busy} onClick={() => {
        setPending('signin'); setError('');
        void window.desktop.auth.github().then(onChanged).catch(e => setError(errorMessage(e))).finally(() => setPending(null));
      }}>{pending === 'signin' ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : <Github aria-hidden="true"/>}<span>{pending === 'signin' ? 'Waiting for GitHub…' : 'Continue with GitHub'}</span>{!busy ? <ArrowUpRight aria-hidden="true"/> : null}</button>
      {pending === 'signin' ? <div className="account-browser-wait"><p role="status">Complete sign-in in your browser, then return here.</p><button className="account-text-button" type="button" onClick={() => void window.desktop.auth.cancel().catch(e => setError(errorMessage(e)))}>Cancel sign-in</button></div> : <p className="account-session-hint">{state.sessionPersistence === 'secure' ? 'Your session will be encrypted on this device.' : 'Your GitHub password stays in your browser.'}</p>}
    </div> : null}
    {!state.account ? <div className="account-connection-section">{serverLabel ? <p className="account-server-label" title={state.apiUrl}>Server <span>{serverLabel}</span></p> : null}{connection}</div> : null}
  </section>;
}
