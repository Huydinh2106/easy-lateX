import type { AccountState, Account, Credentials } from '@easy-latex/shared-types';
import type { SecureSessionStorage } from './SecureSessionStorage';
import { normalizeApiUrl } from './ApiConfiguration';

interface Session { token: string; refreshToken: string; expiresAt: number; account: Account; backendUrl: string; }
interface SignupConfirmation { confirmationRequired: true; message?: string; }
export interface AccountConfig { url?: string | undefined; }
const sessionKey = 'supabase-app-session';

class AccountRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<Session>;
  return typeof session.token === 'string' && Boolean(session.token)
    && typeof session.refreshToken === 'string' && Boolean(session.refreshToken)
    && typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt)
    && Boolean(session.account) && typeof session.account?.id === 'string'
    && typeof session.account.email === 'string' && typeof session.account.displayName === 'string';
}

/** Passwords are sent to the backend; only encrypted session tokens are retained. */
export class AccountManager {
  private pending: AbortController | null = null;
  private refreshing: { generation: number; promise: Promise<Session> } | null = null;
  private generation = 0;
  private recoverySession: Session | null = null;
  private recoveryListener: { close(): void } | null = null;

  constructor(private readonly configuration: AccountConfig, private readonly storage: SecureSessionStorage, openBrowser?: (url: string) => Promise<void>) {
    // Keep the existing main-process constructor compatible while removing browser auth.
    void openBrowser;
    configuration.url = normalizeApiUrl(configuration.url ?? '');
  }

  async configure(url: string): Promise<void> {
    if ((await this.state()).account) throw new Error('Sign out before changing the cloud server');
    await this.cancel();
    this.configuration.url = normalizeApiUrl(url);
  }

  private async request<T>(route: string, body: unknown, token?: string, backendUrl = this.configuration.url, signal?: AbortSignal, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    if (!backendUrl) throw new Error('Cloud account is not configured. Set the cloud server first.');
    let response: Response;
    try {
      response = await fetch(`${backendUrl.replace(/\/$/, '')}${route}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(method === 'POST' ? {body: JSON.stringify(body)} : {}), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
      });
    } catch {
      if (signal?.aborted) throw new Error('Sign-in cancelled');
      throw new Error('Could not reach the cloud server. Check your connection and try again.');
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error('The cloud server returned an invalid response. Try again.'); }
    if (!response.ok) {
      const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
        ? value.message : 'The account request could not be completed. Try again.';
      throw new AccountRequestError(message, response.status);
    }
    return value as T;
  }

  private async session(): Promise<Session | null> {
    const value = await this.storage.getItem(sessionKey);
    if (!value) return null;
    try {
      const session: unknown = JSON.parse(value);
      return isSession(session) && session.backendUrl === this.configuration.url ? session : null;
    } catch { return null; }
  }

  async state(): Promise<AccountState> {
    const session = this.recoverySession ?? await this.session();
    return { configured: Boolean(this.configuration.url), apiUrl: this.configuration.url ?? '', sessionPersistence: this.storage.persistent() ? 'secure' : 'memory', googleEnabled: false, recovery: Boolean(this.recoverySession), recoveryPending: Boolean(this.recoveryListener), account: session?.account ?? null };
  }

  private async authenticate(route: '/auth/login' | '/auth/signup', input: Credentials & { displayName?: string }): Promise<AccountState> {
    if (!this.configuration.url) throw new Error('Cloud account is not configured. Set the cloud server first.');
    if (this.pending) throw new Error('An account request is already in progress');
    await this.cancel();
    const backendUrl = this.configuration.url, generation = this.generation;
    const controller = new AbortController();
    this.pending = controller;
    try {
      const value = await this.request<unknown>(route, input, undefined, backendUrl, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) throw new Error('Sign-in cancelled');
      if (route === '/auth/signup' && value && typeof value === 'object' && 'confirmationRequired' in value && value.confirmationRequired === true) {
        const result = value as SignupConfirmation;
        return { ...await this.state(), confirmationRequired: true, message: result.message || 'Check your email to confirm your account, then sign in.' };
      }
      if (!isSession(value)) throw new Error('The cloud server returned an invalid session. Try signing in again.');
      await this.storage.setItem(sessionKey, JSON.stringify({ ...value, backendUrl }));
      if (generation !== this.generation) throw new Error('Sign-in cancelled');
      return this.state();
    } finally { if (this.pending === controller) this.pending = null; }
  }

  signIn(input: Credentials): Promise<AccountState> { return this.authenticate('/auth/login', { email: input.email.trim(), password: input.password }); }
  signUp(input: Credentials & { displayName: string }): Promise<AccountState> {
    return this.authenticate('/auth/signup', { email: input.email.trim(), password: input.password, displayName: input.displayName.trim() });
  }

  private async recoveryCallback(generation: number, backendUrl: string): Promise<{ url: string; close(): void }> {
    const callbackPath = `/auth/recovery/${randomBytes(24).toString('hex')}`;
    let origin = '', completing = false;
    const nonce = randomBytes(24).toString('base64');
    const server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (!origin || request.headers.host !== new URL(origin).host) { response.writeHead(400).end(); return; }
      if (request.method === 'GET' && request.url === callbackPath) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Easy LaTeX password reset</title><h1>Easy LaTeX</h1><p id="message">Verifying your password reset link…</p><script nonce="${nonce}">
const values = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
const message = document.getElementById('message');
if (!values.get('access_token') || !values.get('refresh_token')) message.textContent = 'This reset link is invalid or expired. Request a new link in Easy LaTeX.';
else fetch(location.pathname + '/complete', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: values.get('access_token'), refreshToken: values.get('refresh_token'), expiresIn: values.get('expires_in')})})
.then(response => {if (!response.ok) throw new Error(); message.textContent = 'Reset link verified. Return to Easy LaTeX to choose your new password.';})
.catch(() => {message.textContent = 'The reset link could not be verified. Return to Easy LaTeX and request a new link.';});
</script></html>`);
        return;
      }
      if (request.method !== 'POST' || request.url !== `${callbackPath}/complete` || request.headers.origin !== origin || completing) { response.writeHead(404).end(); return; }
      completing = true;
      void (async () => {
        try {
          let body = '';
          for await (const chunk of request) {
            body += String(chunk);
            if (Buffer.byteLength(body) > 32_768) throw new Error('Invalid callback');
          }
          const data: unknown = JSON.parse(body);
          if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string' || !data.token || data.token.length > 8192 || !('refreshToken' in data) || typeof data.refreshToken !== 'string' || !data.refreshToken || data.refreshToken.length > 8192) throw new Error('Invalid callback');
          const account = await this.request<Account>('/auth/user', undefined, data.token, backendUrl, undefined, 'GET');
          const seconds = 'expiresIn' in data ? Number(data.expiresIn) : 3600;
          const candidate = { token: data.token, refreshToken: data.refreshToken, expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 3600) * 1000, account, backendUrl };
          if (generation !== this.generation || !isSession(candidate)) throw new Error('Invalid callback');
          this.recoverySession = candidate;
          response.writeHead(200).end();
          this.recoveryListener?.close(); this.recoveryListener = null;
        } catch { response.writeHead(400).end('The reset link could not be verified.'); }
        finally { completing = false; }
      })();
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') { server.close(); throw new Error('Could not open the password reset callback.'); }
    origin = `http://127.0.0.1:${address.port}`;
    const timer = setTimeout(() => { server.close(); if (this.recoveryListener === listener) this.recoveryListener = null; }, 15 * 60_000);
    timer.unref();
    const listener = { url: `${origin}${callbackPath}`, close: () => { clearTimeout(timer); server.close(); } };
    return listener;
  }

  async resetPassword(email: string): Promise<AccountState> {
    if (!this.configuration.url) throw new Error('Cloud account is not configured. Set the cloud server first.');
    if (this.pending) throw new Error('An account request is already in progress');
    await this.cancel();
    const generation = this.generation, backendUrl = this.configuration.url;
    const controller = new AbortController(); this.pending = controller;
    let listener: Awaited<ReturnType<AccountManager['recoveryCallback']>> | undefined;
    try {
      listener = await this.recoveryCallback(generation, backendUrl);
      if (generation !== this.generation) throw new Error('Account request cancelled');
      this.recoveryListener = listener;
      const value = await this.request<{ message?: string }>('/auth/reset-password', { email: email.trim(), redirectTo: listener.url }, undefined, backendUrl, controller.signal);
      if (generation !== this.generation) throw new Error('Account request cancelled');
      return { ...await this.state(), message: value.message || 'If an account exists for this email, you will receive a password reset link. Keep Easy LaTeX open while you follow the link.' };
    } catch (error) {
      listener?.close(); if (this.recoveryListener === listener) this.recoveryListener = null;
      throw error;
    } finally { if (this.pending === controller) this.pending = null; }
  }

  async updatePassword(password: string): Promise<AccountState> {
    const session = this.recoverySession, generation = this.generation;
    if (!session) throw new Error('Open the password reset link in your email first.');
    await this.request('/auth/update-password', { password }, session.token, session.backendUrl);
    if (generation !== this.generation) throw new Error('Account request cancelled');
    await this.storage.setItem(sessionKey, JSON.stringify(session));
    if (generation !== this.generation) throw new Error('Account request cancelled');
    this.recoverySession = null;
    return this.state();
  }

  async accessToken(expectedUrl = this.configuration.url): Promise<string> {
    if (expectedUrl !== this.configuration.url) throw new Error('Cloud server changed. Sign in again.');
    let session = await this.session();
    if (!session) throw new Error('Please sign in with your email and password');
    const backendUrl = this.configuration.url!, generation = this.generation;
    if (session.expiresAt < Date.now() + 60_000) {
      if (!this.refreshing || this.refreshing.generation !== generation) {
        const entry = { generation, promise: Promise.resolve(session) };
        entry.promise = this.request<unknown>('/auth/refresh', { refreshToken: session.refreshToken }, undefined, backendUrl).then(async value => {
          if (generation !== this.generation) throw new Error('Session changed. Sign in again.');
          if (!isSession(value)) throw new Error('The cloud server returned an invalid session. Sign in again.');
          const next = { ...value, backendUrl };
          await this.storage.setItem(sessionKey, JSON.stringify(next));
          return next;
        }).catch(async (error: unknown) => {
          if (generation === this.generation && error instanceof AccountRequestError && [400, 401, 403].includes(error.status)) await this.storage.removeItem(sessionKey);
          throw error;
        }).finally(() => { if (this.refreshing === entry) this.refreshing = null; });
        this.refreshing = entry;
      }
      session = await this.refreshing.promise;
    }
    if (generation !== this.generation || session.backendUrl !== expectedUrl) throw new Error('Session changed. Sign in again.');
    return session.token;
  }

  cancel(): Promise<void> {
    this.generation++;
    this.pending?.abort(); this.pending = null;
    this.recoveryListener?.close(); this.recoveryListener = null; this.recoverySession = null;
    return Promise.resolve();
  }

  async signOut(): Promise<void> {
    const backendUrl = this.configuration.url, recoverySession = this.recoverySession;
    // Queue the read and deletion before yielding. A later sign-in writes after
    // this deletion; logout refreshes never write their temporary tokens to disk.
    const storedSession = this.session();
    const cancellation = this.cancel();
    const clearing = this.storage.clear();
    const [stored, cleared] = await Promise.allSettled([storedSession, clearing]);
    await cancellation;
    const sessions = [stored.status === 'fulfilled' ? stored.value : null, recoverySession].filter((value): value is Session => Boolean(value));
    await Promise.all(sessions.map(async value => {
      try {
        let active = value;
        if (active.expiresAt < Date.now() + 60_000) {
          const refreshed = await this.request<unknown>('/auth/refresh', { refreshToken: active.refreshToken }, undefined, backendUrl);
          if (!isSession(refreshed) || refreshed.account.id !== active.account.id) throw new Error('Invalid logout session');
          active = { ...refreshed, backendUrl: value.backendUrl };
        }
        await this.request('/auth/logout', { refreshToken: active.refreshToken }, active.token, backendUrl);
      } catch { /* Local credentials are already cleared, including while offline. */ }
    }));
    if (cleared.status === 'rejected') throw new Error('The saved session could not be removed from this device. Try signing out again.');
  }
}
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
