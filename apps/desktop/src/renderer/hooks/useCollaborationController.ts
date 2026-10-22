import { useEffect, useRef, useState } from "react";
import type { AccountState, ProjectCollaborationLink, ProjectInvitation, SharedProject } from "@easy-latex/shared-types";
import { errorMessage } from "../features/collaboration/utils";

export function useCollaborationController() {
  const [account, setAccount] = useState<AccountState>({configured: false, googleEnabled: false, account: null, recovery: false});
  const [accountReady, setAccountReady] = useState(false);
  const [projects, setProjects] = useState<SharedProject[]>([]);
  const [links, setLinks] = useState<ProjectCollaborationLink[]>([]);
  const [linksReady, setLinksReady] = useState(false);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {let live = true; void window.desktop.auth.state().then(s => {if (live) {setAccount(s); setAccountReady(true);}}).catch(e => {if (live) setError(errorMessage(e));}); return () => {live = false;};}, []);
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => window.desktop.collaboration.links()).then(entries => {if (live) {setLinks(entries); setLinksReady(true);}}).catch(e => {
      if (live) setError(/Unknown collaboration operation|collaboration\.links is not a function/.test(errorMessage(e)) ? 'Please quit and restart Easy LaTeX to finish the update.' : errorMessage(e));
    });
    return () => {live = false;};
  }, []);
  const refreshLinks = async () => {setLinks(await window.desktop.collaboration.links()); setLinksReady(true);};
  const refresh = async () => {
    const [p, i] = await Promise.all([window.desktop.collaboration.projects(), window.desktop.collaboration.invitations()]);
    setProjects(p); setInvitations(i);
  };
  useEffect(() => {
    if (!account.account || account.recovery) return;
    let live = true; let loading = false;
    const poll = () => {
      if (loading) return; loading = true;
      void Promise.all([window.desktop.collaboration.projects(), window.desktop.collaboration.invitations()]).then(([p, i]) => {if (live) {setProjects(p); setInvitations(i);}}).catch(e => {if (live) setError(errorMessage(e));}).finally(() => {loading = false;});
    };
    poll(); const timer = setInterval(poll, 10_000);
    window.addEventListener("github-migration-completed",poll);
    return () => {live = false; clearInterval(timer);window.removeEventListener("github-migration-completed",poll);};
  }, [account.account?.id, account.recovery]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try {await action(); return true;} catch (e) {setError(errorMessage(e)); return false;} finally {setBusy(false);}
  };
  const requireAccount = (action?: () => Promise<void>) => {
    if (account.account && !account.recovery) {if (action) void run(action); return;}
    pending.current = action ?? null; setError(null); setAuthOpen(true);
  };
  const changed = (state: AccountState) => {
    setAccount(state);
    if (!state.account || state.recovery) return;
    setAuthOpen(false);
    const action = pending.current; pending.current = null;
    if (action) void run(action);
  };
  const closeAuth = () => {pending.current = null; setAuthOpen(false); void window.desktop.auth.cancel().catch(e => setError(errorMessage(e)));};
  const signOut = () => run(async () => {
    await window.desktop.auth.signOut(); setAccount(await window.desktop.auth.state()); setProjects([]); setInvitations([]);
  });
  const accept = (invitation: ProjectInvitation) => requireAccount(async () => {await window.desktop.collaboration.accept(invitation.id); await refresh();});
  return {account, accountReady, projects, links, linksReady, refreshLinks, invitations, authOpen, busy, error, refresh, run, requireAccount, changed, closeAuth, signOut, accept, clearError: () => setError(null)};
}
