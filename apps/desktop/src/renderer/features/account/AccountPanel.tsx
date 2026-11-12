import { useEffect, useId, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import type { AccountState } from '@easy-latex/shared-types';
import { errorMessage } from '../collaboration/utils';

interface Props { state: AccountState; onChanged(state: AccountState): void; }
type Mode = 'signin' | 'signup' | 'reset' | 'recovery';

export function AccountPanel({state,onChanged}: Props) {
  const [mode,setMode] = useState<Mode>(state.recovery ? 'recovery' : state.recoveryPending ? 'reset' : 'signin');
  const [waiting,setWaiting] = useState(Boolean(state.recoveryPending));
  const [pending,setPending] = useState<Mode | 'server' | null>(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState(state.message ?? '');
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [confirmation,setConfirmation] = useState('');
  const [displayName,setDisplayName] = useState('');
  const [server,setServer] = useState(state.apiUrl ?? '');
  const fieldId = useId();
  const busy = pending !== null;

  useEffect(() => {
    if (!waiting) return;
    let live = true, checking = false;
    const check = () => {
      if (checking) return;
      checking = true;
      void window.desktop.auth.state().then(next => {
        if (!live) return;
        if (next.recovery) {
          setWaiting(false); setMode('recovery'); setPassword(''); setConfirmation('');
          setMessage('Your reset link has been verified. Choose a new password.'); onChanged(next);
        } else if (!next.recoveryPending) {
          setWaiting(false); setMessage(''); setError('The reset link has expired or was cancelled. Request a new link.');
        }
      }).catch(e => {if (live) setError(errorMessage(e));}).finally(() => {checking = false;});
    };
    const timer = setInterval(check, 1000);
    return () => { live = false; clearInterval(timer); };
  }, [waiting,onChanged]);

  const changeMode = (next: Mode) => {
    if (waiting || mode === 'recovery') void window.desktop.auth.cancel().then(() => window.desktop.auth.state()).then(onChanged).catch(e => setError(errorMessage(e)));
    setWaiting(false);
    setMode(next); setPassword(''); setConfirmation(''); setError(''); setMessage('');
  };
  const submit = () => {
    setError(''); setMessage('');
    if ((mode === 'signup' || mode === 'recovery') && password !== confirmation) { setError('Passwords do not match.'); return; }
    setPending(mode);
    const request = mode === 'signup'
      ? window.desktop.auth.signUp({ email: email.trim(), password, displayName: displayName.trim() })
      : mode === 'reset' ? window.desktop.auth.resetPassword(email.trim())
        : mode === 'recovery' ? window.desktop.auth.updatePassword(password)
        : window.desktop.auth.signIn({ email: email.trim(), password });
    void request.then(next => {
      setPassword(''); setConfirmation('');
      if (next.confirmationRequired) setMode('signin');
      if (mode === 'reset') {
        setWaiting(Boolean(next.recoveryPending));
        if (next.recovery) setMode('recovery');
      }
      setMessage(next.message ?? (next.confirmationRequired ? 'Check your email to confirm your account, then sign in.' : ''));
      onChanged(next);
    }).catch(e => setError(errorMessage(e))).finally(() => setPending(null));
  };
  const connection = <div className="account-connection">
    <form onSubmit={event => {
      event.preventDefault(); setPending('server'); setError(''); setMessage('');
      void window.desktop.auth.configure(server.trim()).then(onChanged).catch(e => setError(errorMessage(e))).finally(() => setPending(null));
    }}>
      <label htmlFor={`${fieldId}-server`}>Collaboration server</label>
      <input id={`${fieldId}-server`} type="url" required value={server} placeholder="https://your-server.example" autoComplete="url" spellCheck={false}
        disabled={busy} onChange={event => setServer(event.target.value)}/>
      <button className="button button-secondary" disabled={busy || !server.trim()}>{pending === 'server' ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : null}{pending === 'server' ? 'Saving…' : 'Save server'}</button>
    </form>
  </div>;

  const title = !state.configured ? 'Connect' : mode === 'recovery' ? 'New password' : state.account ? 'Account' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Sign in';

  return <section className="account-card" aria-label="Account" aria-busy={busy}>
    <h2>{title}</h2>
    {state.account ? <p className="account-email">{state.account.email}</p> : null}

    {state.sessionPersistence === 'memory' ? <div className="account-feedback account-feedback-warning" role="status">
      <AlertCircle aria-hidden="true"/><span>You'll need to sign in again after closing the app.</span>
    </div> : null}
    {error ? <div className="account-feedback account-feedback-error" role="alert"><AlertCircle aria-hidden="true"/><span>{error}</span></div> : null}
    {message ? <div className="account-feedback" role="status"><CheckCircle2 aria-hidden="true"/><span>{message}</span></div> : null}

    {!state.configured ? connection : null}

    {state.configured && (!state.account || state.recovery) ? <div className="account-signin-actions">
      {waiting ? <div className="account-browser-wait"><p>Keep Easy LaTeX open while you follow the password reset link in your email.</p><button className="account-text-button" type="button" onClick={() => changeMode('reset')}>Use a different email</button></div> : <form onSubmit={event => { event.preventDefault(); submit(); }}>
        {mode === 'signup' ? <label htmlFor={`${fieldId}-name`}>Display name
          <input id={`${fieldId}-name`} name="name" required maxLength={80} autoComplete="name" value={displayName} disabled={busy} onChange={event => setDisplayName(event.target.value)}/>
        </label> : null}
        {mode !== 'recovery' ? <label htmlFor={`${fieldId}-email`}>Email
          <input id={`${fieldId}-email`} name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} disabled={busy} onChange={event => setEmail(event.target.value)}/>
        </label> : null}
        {mode !== 'reset' ? <label htmlFor={`${fieldId}-password`}>{mode === 'recovery' ? 'New password' : 'Password'}
          <input id={`${fieldId}-password`} name="password" type="password" required minLength={mode === 'signin' ? 1 : 8} maxLength={1024} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/>
        </label> : null}
        {mode === 'signup' || mode === 'recovery' ? <label htmlFor={`${fieldId}-confirmation`}>Confirm password
          <input id={`${fieldId}-confirmation`} name="confirmation" type="password" required minLength={8} maxLength={1024} autoComplete="new-password" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/>
        </label> : null}
        <button className="button button-primary account-continue" disabled={busy}>
          {busy ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : null}
          <span>{pending === 'signin' ? 'Signing in…' : pending === 'signup' ? 'Creating account…' : pending === 'reset' ? 'Sending link…' : pending === 'recovery' ? 'Saving password…' : mode === 'recovery' ? 'Save new password' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</span>
        </button>
      </form>}
      <div className="account-links">
        {mode === 'signin' ? <><button type="button" disabled={busy} onClick={() => changeMode('signup')}>Create an account</button><button type="button" disabled={busy} onClick={() => changeMode('reset')}>Forgot password?</button></>
          : <button type="button" disabled={busy} onClick={() => changeMode('signin')}>Back to sign in</button>}
      </div>
    </div> : null}
  </section>;
}
