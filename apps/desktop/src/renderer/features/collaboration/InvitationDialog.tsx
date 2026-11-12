import { useId, useState } from 'react';
import { AlertCircle, LoaderCircle, Mail, Send, Users } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { errorMessage } from './utils';

interface Props { projectName: string; onClose(): void; onInvite(email: string, role: 'editor' | 'viewer'): Promise<void>; }

export function InvitationDialog({projectName,onClose,onInvite}: Props) {
  const [email,setEmail] = useState('');
  const [role,setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const id = useId();
  return <Dialog title="Invite collaborators" label="Invite people" description={`Work together on ${projectName}.`} closeLabel="Close invitation" busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault(); if (busy || !event.currentTarget.checkValidity()) return;
      setBusy(true); setError('');
      void onInvite(email.trim().toLowerCase(),role).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }}>
      <div className="dashboard-dialog-field"><label htmlFor={id}>Email address</label><input id={id} data-autofocus type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" disabled={busy} value={email} aria-describedby={`${id}-help`} onChange={event => setEmail(event.target.value)}/></div>
      <p className="collaboration-field-help" id={`${id}-help`}>Use the email address they use to sign in to Easy LaTeX.</p>
      <div className="dashboard-dialog-field"><label htmlFor={`${id}-role`}>Permission</label><select id={`${id}-role`} disabled={busy} value={role} onChange={event => setRole(event.target.value as 'editor' | 'viewer')}><option value="editor">Can edit</option><option value="viewer">View only</option></select></div>
      <div className="collaboration-permission"><Users aria-hidden="true"/><span><strong>Project access</strong><small>{role==='editor'?'Read and edit the project files saved in the cloud.':'Read and compile project files without changing them.'}</small></span></div>
      <p className="collaboration-explanation"><Mail aria-hidden="true"/><span>They can accept the invitation from Projects after signing in with this email address.</span></p>
      {error ? <p className="dashboard-dialog-error" role="alert"><AlertCircle aria-hidden="true"/>{error}</p> : null}
      <footer className="dashboard-dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy || !email.trim()}>{busy ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : <Send aria-hidden="true"/>}{busy ? 'Adding invitation…' : 'Add invitation'}</button></footer>
    </form>
  </Dialog>;
}
