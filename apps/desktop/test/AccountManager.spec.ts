import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';

const storage = () => new SecureSessionStorage(path.join(os.tmpdir(), `easy-latex-auth-${randomUUID()}`), {available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => ''});
const account = {id: 'user', email: 'alice@example.test', displayName: 'Alice'};
const backendUrl = 'http://127.0.0.1:4318';
const session = {token: 'private-access-token', refreshToken: 'private-refresh-token', expiresAt: Date.now() + 900_000, account, backendUrl};
const urlText = (value: string | URL | Request) => typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {status}));
afterEach(() => vi.restoreAllMocks());

describe('Email and password accounts', () => {
  it('signs in through the backend and returns no tokens or password to the renderer', async () => {
    const store = storage(), browser = vi.fn();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      expect(urlText(url)).toBe(`${backendUrl}/auth/login`);
      expect(options?.method).toBe('POST');
      expect(JSON.parse(options?.body as string)).toEqual({email: account.email, password: 'entered-password'});
      return json(session);
    });
    const manager = new AccountManager({url: backendUrl}, store, browser);
    const state = await manager.signIn({email: ` ${account.email} `, password: 'entered-password'});
    expect(state.account).toEqual(account);
    expect(JSON.stringify(state)).not.toContain(session.token);
    expect(JSON.stringify(state)).not.toContain(session.refreshToken);
    expect(await store.getItem('supabase-app-session')).not.toContain('entered-password');
    expect(await manager.accessToken()).toBe(session.token);
    expect(fetcher).toHaveBeenCalledOnce(); expect(browser).not.toHaveBeenCalled();
  });

  it('handles email confirmation without creating an authenticated session', async () => {
    const store = storage();
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      expect(urlText(url)).toBe(`${backendUrl}/auth/signup`);
      expect(JSON.parse(options?.body as string)).toEqual({email: account.email, password: 'new-password', displayName: 'Alice'});
      return json({confirmationRequired: true});
    });
    const manager = new AccountManager({url: backendUrl}, store);
    const state = await manager.signUp({email: account.email, password: 'new-password', displayName: ' Alice '});
    expect(state.confirmationRequired).toBe(true); expect(state.message).toMatch(/confirm your account/);
    expect(state.account).toBeNull(); expect(await store.getItem('supabase-app-session')).toBeNull();
  });

  it('accepts an immediate signup session when email confirmation is disabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(session));
    const manager = new AccountManager({url: backendUrl}, storage());
    expect((await manager.signUp({email: account.email, password: 'new-password', displayName: 'Alice'})).account).toEqual(account);
  });

  it('rotates refresh tokens once for concurrent requests and clears credentials even when logout is offline', async () => {
    const store = storage(); await store.setItem('supabase-app-session', JSON.stringify({...session, expiresAt: 0}));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      if (urlText(url).endsWith('/refresh')) return json({...session, token: 'rotated-access', refreshToken: 'rotated-refresh'});
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer rotated-access');
      expect(JSON.parse(options?.body as string)).toEqual({refreshToken: 'rotated-refresh'});
      return Promise.reject(new Error('offline'));
    });
    const manager = new AccountManager({url: backendUrl}, store);
    expect(await Promise.all([manager.accessToken(), manager.accessToken()])).toEqual(['rotated-access', 'rotated-access']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await manager.signOut(); expect((await manager.state()).account).toBeNull();
  });

  it('refreshes an expired access token only for revocation after clearing local credentials', async () => {
    const store = storage(); await store.setItem('supabase-app-session', JSON.stringify({...session, expiresAt: 0}));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      expect(await store.getItem('supabase-app-session')).toBeNull();
      if (urlText(url).endsWith('/refresh')) {
        expect(JSON.parse(options?.body as string)).toEqual({refreshToken: session.refreshToken});
        return json({...session, token: 'logout-access', refreshToken: 'logout-refresh'});
      }
      expect(urlText(url)).toBe(`${backendUrl}/auth/logout`);
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer logout-access');
      expect(JSON.parse(options?.body as string)).toEqual({refreshToken: 'logout-refresh'});
      return json({ok: true});
    });
    const manager = new AccountManager({url: backendUrl}, store);
    await manager.signOut();
    expect(fetcher).toHaveBeenCalledTimes(2); expect((await manager.state()).account).toBeNull();
    expect(await store.getItem('supabase-app-session')).toBeNull();
  });

  it('keeps local credentials cleared when the logout refresh cannot reach the backend', async () => {
    const store = storage(); await store.setItem('supabase-app-session', JSON.stringify({...session, expiresAt: 0}));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const manager = new AccountManager({url: backendUrl}, store);
    await manager.signOut();
    expect(fetcher).toHaveBeenCalledOnce(); expect(urlText(fetcher.mock.calls[0]![0])).toBe(`${backendUrl}/auth/refresh`);
    expect((await manager.state()).account).toBeNull();
  });

  it('does not overwrite or revoke a new sign-in while an old logout refresh is pending', async () => {
    const store = storage(); await store.setItem('supabase-app-session', JSON.stringify({...session, expiresAt: 0}));
    const newAccount = {...account, id: 'another-user', email: 'bob@example.test', displayName: 'Bob'};
    const nextSession = {...session, account: newAccount, token: 'new-access', refreshToken: 'new-refresh'};
    let finishRefresh: (value: Response) => void = () => {};
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      if (urlText(url).endsWith('/refresh')) return new Promise<Response>(resolve => { finishRefresh = resolve; });
      if (urlText(url).endsWith('/login')) return json(nextSession);
      expect(urlText(url)).toBe(`${backendUrl}/auth/logout`);
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer old-logout-access');
      return json({ok: true});
    });
    const manager = new AccountManager({url: backendUrl}, store);
    const signingOut = manager.signOut();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect((await manager.state()).account).toBeNull();
    await manager.signIn({email: newAccount.email, password: 'new-password'});
    finishRefresh(new Response(JSON.stringify({...session, token: 'old-logout-access', refreshToken: 'old-logout-refresh'})));
    await signingOut;
    expect((await manager.state()).account).toEqual(newAccount); expect(await manager.accessToken()).toBe(nextSession.token);
  });

  it('clears a rejected refresh session while keeping credentials on a temporary network error', async () => {
    const store = storage(); await store.setItem('supabase-app-session', JSON.stringify({...session, expiresAt: 0}));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const manager = new AccountManager({url: backendUrl}, store);
    await expect(manager.accessToken()).rejects.toThrow('Could not reach');
    expect((await manager.state()).account).toEqual(account);
    fetcher.mockImplementation(() => json({message: 'Session expired'}, 401));
    await expect(manager.accessToken()).rejects.toThrow('Session expired');
    expect((await manager.state()).account).toBeNull();
  });

  it('never uses GitHub sessions, malformed storage, or a session scoped to a different server', async () => {
    const store = storage(); await store.setItem('github-app-session', JSON.stringify(session));
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const manager = new AccountManager({url: backendUrl}, store);
    expect((await manager.state()).account).toBeNull();
    await store.setItem('supabase-app-session', '{invalid'); expect((await manager.state()).account).toBeNull();
    await store.setItem('supabase-app-session', JSON.stringify({...session, backendUrl: 'https://different.example'}));
    await expect(manager.accessToken()).rejects.toThrow('Please sign in'); expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not restore a session if refresh completes after sign-out and a server change', async () => {
    const store = storage(); await store.setItem('supabase-app-session', JSON.stringify({...session, expiresAt: 0}));
    let finish: (value: Response) => void = () => {}, refreshes = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      if (!urlText(url).endsWith('/refresh')) return json({ok: true});
      refreshes++;
      return refreshes === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : json({...session, token: 'logout-access'});
    });
    const manager = new AccountManager({url: backendUrl}, store);
    const pending = manager.accessToken(); const rejected = expect(pending).rejects.toThrow('Session changed');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); await manager.signOut(); await manager.configure('https://different.example');
    finish(new Response(JSON.stringify(session))); await rejected;
    expect((await manager.state()).account).toBeNull();
  });

  it('does not save a sign-in response after cancellation', async () => {
    let finish: (value: Response) => void = () => {};
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const manager = new AccountManager({url: backendUrl}, storage());
    const pending = manager.signIn({email: account.email, password: 'password'});
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); await manager.cancel();
    finish(new Response(JSON.stringify(session))); await rejected; expect((await manager.state()).account).toBeNull();
  });

  it('verifies a recovery link on loopback and updates the password without exposing recovery tokens', async () => {
    const realFetch = globalThis.fetch; let redirectTo = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      if (!urlText(url).startsWith(backendUrl)) return realFetch(url, options);
      if (urlText(url).endsWith('/reset-password')) {
        const body = JSON.parse(options?.body as string) as {email: string; redirectTo: string};
        expect(body.email).toBe(account.email); redirectTo = body.redirectTo;
        return json({message: 'Check your email.'});
      }
      expect((options?.headers as Record<string, string>).Authorization).toBe(`Bearer ${session.token}`);
      if (urlText(url).endsWith('/user')) { expect(options?.method).toBe('GET'); return json(account); }
      expect(urlText(url)).toBe(`${backendUrl}/auth/update-password`);
      expect(JSON.parse(options?.body as string)).toEqual({password: 'updated-password'});
      return json({ok: true});
    });
    const manager = new AccountManager({url: backendUrl}, storage());
    try {
      expect((await manager.resetPassword(account.email)).recoveryPending).toBe(true);
      expect(new URL(redirectTo).hostname).toBe('127.0.0.1');
      expect(new URL(redirectTo).pathname).toMatch(/^\/auth\/recovery\/[a-f0-9]{48}$/);
      const page = await realFetch(redirectTo);
      expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(await page.text()).not.toContain(session.token);
      const complete = {method: 'POST', headers: {'Content-Type': 'application/json', Origin: new URL(redirectTo).origin}, body: JSON.stringify({token: session.token, refreshToken: session.refreshToken, expiresIn: '3600'})};
      expect((await realFetch(`${redirectTo}/complete`, {...complete, headers: {...complete.headers, Origin: 'https://untrusted.example'}})).status).toBe(404);
      expect((await realFetch(`${redirectTo}/complete`, complete)).status).toBe(200);
      const recovery = await manager.state(); expect(recovery.recovery).toBe(true); expect(JSON.stringify(recovery)).not.toContain(session.token);
      await expect(manager.accessToken()).rejects.toThrow('Please sign in');
      const updated = await manager.updatePassword('updated-password');
      expect(updated.recovery).toBe(false); expect(updated.account).toEqual(account); expect(await manager.accessToken()).toBe(session.token);
    } finally { await manager.cancel(); }
  });

  it('requires a verified recovery link before changing a password and checks missing server configuration', async () => {
    const manager = new AccountManager({}, storage());
    await expect(manager.updatePassword('updated-password')).rejects.toThrow('Open the password reset link');
    await expect(manager.signIn({email: account.email, password: 'password'})).rejects.toThrow('not configured');
    await expect(manager.resetPassword(account.email)).rejects.toThrow('not configured');
  });
});
