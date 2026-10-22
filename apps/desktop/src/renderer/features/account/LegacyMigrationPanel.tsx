import { useState } from 'react';
import { AlertCircle, ArrowRight, Check, FolderOpen, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { SharedProject } from '@easy-latex/shared-types';
import { Dialog } from '../../components/Dialog';
import { errorMessage } from '../collaboration/utils';

export function LegacyMigrationPanel({onClose,onMigrated}: {onClose(): void; onMigrated(): void}) {
  const [email,setEmail] = useState('');
  const [code,setCode] = useState('');
  const [sent,setSent] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [projects,setProjects] = useState<SharedProject[]|null>(null);
  const [selected,setSelected] = useState<SharedProject|null>(null);
  const [completed,setCompleted] = useState<string[]>([]);
  const api = window.desktop.collaboration;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Dialog title="Migrate legacy projects" description="Bring your previous projects into your GitHub workspace." busy={busy} onClose={onClose}>
    <ol className="migration-steps" aria-label="Migration steps"><li aria-current={projects === null ? 'step' : undefined}><span>{projects === null ? '1' : <Check aria-hidden="true"/>}</span>Verify ownership</li><li aria-current={projects !== null ? 'step' : undefined}><span>2</span>Choose projects</li></ol>
    {error ? <p className="dashboard-dialog-error" role="alert"><AlertCircle aria-hidden="true"/>{error}</p> : null}
    {notice ? <div className="account-feedback migration-success" role="status"><Check aria-hidden="true"/><span><strong>Project migrated</strong><small>{notice}</small></span></div> : null}
    {projects === null ? <form onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        if (!sent) { await api.legacyConfirmation(email.trim()); setSent(true); }
        else { await api.linkLegacy(email.trim(),code); setProjects(await api.legacyProjects()); }
      });
    }}>
      <p className="collaboration-dialog-copy">Confirm your previous account before linking it to your signed-in GitHub account.</p>
      <label className="dashboard-dialog-field"><span>Legacy account email</span><input type="email" required value={email} disabled={busy || sent} autoComplete="email" onChange={event => setEmail(event.target.value)}/></label>
      {sent ? <><p className="collaboration-field-help">Enter the 6-digit confirmation code sent to {email}.</p><label className="dashboard-dialog-field"><span>Ownership confirmation code</span><input className="migration-code" autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} disabled={busy}/></label><button className="account-text-button" type="button" disabled={busy} onClick={() => {setSent(false); setCode(''); setError('');}}>Use another email</button></> : null}
      <footer className="dashboard-dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : <ArrowRight aria-hidden="true"/>}{busy ? (sent ? 'Verifying…' : 'Sending code…') : sent ? 'Confirm account link' : 'Send confirmation code'}</button></footer>
    </form> : selected ? <div>
      <div className="collaboration-permission"><FolderOpen aria-hidden="true"/><span><strong>{selected.name}</strong><small>A private GitHub repository will be created for this project.</small></span></div>
      <ul className="migration-details"><li>Source files and project resources will be copied.</li><li>Previous file revisions will be preserved as archives.</li><li>Original data stays available. Invite collaborators again through GitHub.</li></ul>
      <footer className="dashboard-dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => {setSelected(null); setError('');}}>Back</button><button className="button button-primary" disabled={busy} onClick={() => void run(async () => {
        const result = await api.migrateLegacy(selected.id);
        setCompleted(previous => [...previous,selected.id]); setNotice(result.limitations); setSelected(null); onMigrated();
      })}>{busy ? <LoaderCircle className="account-spinner" aria-hidden="true"/> : <ArrowRight aria-hidden="true"/>}{busy ? 'Migrating project…' : 'Migrate project'}</button></footer>
    </div> : <div>
      <p className="collaboration-dialog-copy">Choose a project to review before migrating.</p>
      {projects.length === 0 ? <div className="migration-empty"><FolderOpen aria-hidden="true"/><strong>No owned legacy projects found</strong><small>Only projects owned by your verified account can be migrated.</small></div> : <div className="migration-projects">{projects.map(project => <button className="migration-project" aria-label={completed.includes(project.id) ? `${project.name}, migrated` : `Review ${project.name}`} key={project.id} disabled={busy || completed.includes(project.id)} onClick={() => {setSelected(project); setNotice('');}}><FolderOpen aria-hidden="true"/><strong>{project.name}</strong><span>{completed.includes(project.id) ? <><Check aria-hidden="true"/> Migrated</> : <ArrowRight aria-label="Review project"/>}</span></button>)}</div>}
      <p className="collaboration-explanation"><ShieldCheck aria-hidden="true"/><span>Your original projects remain available throughout migration.</span></p>
      <footer className="dashboard-dialog-actions"><button className="button button-secondary" onClick={onClose}>Close</button></footer>
    </div>}
  </Dialog>;
}
