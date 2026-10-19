import { useId, useState } from 'react';
import { AlertCircle, Github, LoaderCircle, Send, Users } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { errorMessage } from './utils';

interface Props { projectName: string; onClose(): void; onInvite(username: string): Promise<void>; }

export function InvitationDialog({projectName,onClose,onInvite}: Props) {
  const [username,setUsername] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const id = useId();
  return <Dialog title="Invite collaborators" label="Invite people" description={`Work together on ${projectName}.`} closeLabel="Close invitation" busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError('');
      void onInvite(username.trim()).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }}>
      <div className="dashboard-dialog-field"><label htmlFor={id}>GitHub username</label><div className="collaboration-username"><span aria-hidden="true">@</span><input id={id} data-autofocus type="text" required pattern={'[a-zA-Z0-9][a-zA-Z0-9\\-]{0,38}'} maxLength={39} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="username" disabled={busy} value={username} aria-describedby={`${id}-help`} onChange={event => setUsername(event.target.value)}/></div></div>
      <p className="collaboration-field-help" id={`${id}-help`}>Use their GitHub username, without the @ symbol.</p>
      <div className="collaboration-permission"><Users aria-hidden="true"/><span><strong>Can edit</strong><small>Read and write access to this project's GitHub repository, including outside Easy LaTeX.</small></span></div>
      <p className="collaboration-explanation"><Github aria-hidden="true"/><span>They'll receive a GitHub invitation and can accept it from Projects after signing in.</span></p>
      {error ? <p className="dashboard-dialog-error" role="alert"><AlertCircle aria-hidden="true"/>{error}</p> : null}
      <footer className="dashboard-dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy || !username.trim()}>{busy ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : <Send aria-hidden="true"/>}{busy ? 'Sending invitation…' : 'Add invitation'}</button></footer>
    </form>
  </Dialog>;
}
