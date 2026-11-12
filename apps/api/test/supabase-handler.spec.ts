import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account, SharedFile } from '@easy-latex/shared-types';
import { createSupabaseHandler, type SupabaseEmailAuth, type EmailSession } from '../src/supabase-handler';
import { CollaborationStore, ApiError } from '../src/store';
import type { ProjectUpdates } from '../src/project-updates';

const projectId = randomUUID(), fileId = randomUUID(), requestId = randomUUID(), token = randomUUID();
const account: Account = { id: randomUUID(), email: 'owner@example.test', displayName: 'Owner' };
const file: SharedFile = { id: fileId, projectId, path: 'main.tex', content: 'source', encoding: 'utf8', version: 1, updatedAt: new Date().toISOString(), editor: null };
const session: EmailSession = { token: 'auth-access-token', refreshToken: 'auth-refresh-token', expiresAt: Date.now() + 3_600_000, account };
type Listener = Parameters<ProjectUpdates['subscribe']>[1];
const fixture = (options: Parameters<typeof createSupabaseHandler>[3] = {}) => {
  const pool = new Pool({ connectionString: 'postgresql://test@localhost/test' });
  const store = new CollaborationStore(pool, 90, undefined, 'default', { enqueueHistory: false });
  const profile = vi.spyOn(store, 'profile').mockResolvedValue();
  const verify = vi.fn().mockResolvedValue(account);
  const auth: SupabaseEmailAuth = {
    signUp: vi.fn().mockResolvedValue({ confirmationRequired: true, message: 'Check your email' }),
    signIn: vi.fn().mockResolvedValue(session), refresh: vi.fn().mockResolvedValue(session),
    resetPassword: vi.fn().mockResolvedValue({ message: 'Check your email' }), updatePassword: vi.fn().mockResolvedValue({ ok: true }), signOut: vi.fn().mockResolvedValue(undefined)
  };
  let listener: Listener | undefined;
  const unsubscribe = vi.fn();
  const updates = {
    start: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((_id: string, value: Listener) => { listener = value; return unsubscribe; })
  };
  const handler = createSupabaseHandler(store, verify, updates, { auth, ...options });
  const request = (path: string, input?: unknown, headers: HeadersInit = { Authorization: 'Bearer supabase-jwt' }) => handler(new Request(`https://example.supabase.co${path}`, {
    ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
    headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...Object.fromEntries(new Headers(headers)) }
  }));
  return { store, profile, verify, auth, handler, request, updates, unsubscribe, changed: () => listener!.changed() };
};

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Supabase email and cloud document transport', () => {
  it('exposes email auth routes without accepting GitHub routes and verifies project access with a Supabase JWT', async () => {
    const f = fixture({ basePath: '/functions/v1/easy-latex-api' });
    const prefix = '/functions/v1/easy-latex-api';
    expect((await f.request(`${prefix}/health`, undefined, {})).status).toBe(200);
    const confirmed = await f.request(`${prefix}/auth/confirmed`, undefined, {});
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(confirmed.headers.get('cache-control')).toBe('no-store');
    expect(confirmed.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await confirmed.text()).toBe('Your email is confirmed. You can return to Easy LaTeX and sign in.');
    expect(f.verify).not.toHaveBeenCalled();
    expect((await f.request(`${prefix}/auth/github/start`, {}, {})).status).toBe(404);
    const signup = await f.request(`${prefix}/auth/signup`, { email: account.email, password: 'password123', displayName: 'Owner' }, {});
    expect(await signup.json()).toEqual({ confirmationRequired: true, message: 'Check your email' });
    expect(f.auth.signUp).toHaveBeenCalledWith({ email: account.email, password: 'password123', displayName: 'Owner' });
    const login = await f.request(`${prefix}/auth/login`, { email: account.email, password: 'password123' }, {});
    expect(await login.json()).toEqual(session);
    expect((await f.request(`${prefix}/auth/refresh`, { refreshToken: session.refreshToken }, {})).status).toBe(200);
    expect(f.auth.refresh).toHaveBeenCalledWith(session.refreshToken);
    // Supabase refresh tokens are opaque and can be shorter than app-generated tokens.
    expect((await f.request(`${prefix}/auth/refresh`, { refreshToken: 'short-token' }, {})).status).toBe(200);
    expect(f.auth.refresh).toHaveBeenCalledWith('short-token');
    expect((await f.request(`${prefix}/auth/reset-password`, { email: account.email }, {})).status).toBe(200);
    const redirectTo = `http://127.0.0.1:4319/auth/recovery/${'a'.repeat(48)}`;
    expect((await f.request(`${prefix}/auth/reset-password`, { email: account.email, redirectTo }, {})).status).toBe(200);
    expect(f.auth.resetPassword).toHaveBeenCalledWith(account.email, redirectTo);
    expect((await f.request(`${prefix}/auth/reset-password`, { email: account.email, redirectTo: 'https://evil.example/recovery' }, {})).status).toBe(400);
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.profile).not.toHaveBeenCalled();
    expect((await f.request(`${prefix}/projects`, undefined, {})).status).toBe(401);
    vi.spyOn(f.store, 'projects').mockResolvedValue([{ id: projectId, name: 'Cloud', role: 'owner' }]);
    const projects = await f.request(`${prefix}/projects`);
    expect(projects.status).toBe(200);
    expect(f.verify).toHaveBeenCalledWith('supabase-jwt');
    expect(f.profile).toHaveBeenCalledWith(account);
    expect(await (await f.request(`${prefix}/auth/user`)).json()).toEqual(account);
    expect((await f.request(`${prefix}/auth/update-password`, { password: 'new-password123' })).status).toBe(200);
    expect(f.auth.updatePassword).toHaveBeenCalledWith('supabase-jwt', 'new-password123');
    expect((await f.request(`${prefix}/auth/update-password`, { password: 'short' })).status).toBe(400);
    expect((await f.request(`${prefix}/auth/logout`, {})).status).toBe(200);
    expect(f.auth.signOut).toHaveBeenCalledWith('supabase-jwt');
    expect((await f.request('/projects')).status).toBe(404);
  });

  it('accepts complete source/resource imports and publishes Done through the transactional store', async () => {
    const f = fixture();
    const create = vi.spyOn(f.store, 'create').mockResolvedValue({ id: projectId, name: 'Cloud', role: 'owner' });
    const entries = [{ path: 'main.tex', content: 'source', encoding: 'utf8' }, { path: 'figures/logo.png', content: 'AQID', encoding: 'base64' }];
    const input = { name: ' Cloud ', requestId, files: entries, directories: ['figures/empty'] };
    expect((await f.request('/projects', input)).status).toBe(200);
    expect(create).toHaveBeenCalledWith(account, { ...input, name: 'Cloud' });
    const importEntries = vi.spyOn(f.store, 'importEntries').mockResolvedValue(['appendix.tex']);
    expect((await f.request(`/projects/${projectId}/import`, { files: [{ path: 'appendix.tex', content: 'appendix' }] })).status).toBe(200);
    expect(importEntries).toHaveBeenCalledWith(projectId, account, [{ path: 'appendix.tex', content: 'appendix' }], []);
    const done = vi.spyOn(f.store, 'done').mockResolvedValue({ ...file, version: 2, content: 'saved source' });
    const published = { token, baseVersion: 1, requestId, content: 'saved source' };
    expect(await (await f.request(`/files/${fileId}/done`, published)).json()).toMatchObject({ version: 2, content: 'saved source' });
    expect(done).toHaveBeenCalledWith(account, { fileId, ...published });
    expect((await f.request(`/files/${fileId}/done`, { ...published, content: 'bad\0source' })).status).toBe(400);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('passes email invitations only from the verified identity and preserves conflict/error semantics', async () => {
    const f = fixture();
    const invite = vi.spyOn(f.store, 'invite').mockResolvedValue();
    expect((await f.request(`/projects/${projectId}/invitations`, { email: 'editor@example.test', role: 'viewer' })).status).toBe(200);
    expect(invite).toHaveBeenCalledWith(projectId, account.id, 'editor@example.test', 'viewer');
    const invitations = vi.spyOn(f.store, 'invitations').mockResolvedValue([]);
    await f.request('/invitations');
    expect(invitations).toHaveBeenCalledWith(account.email);
    const files = vi.spyOn(f.store, 'files').mockRejectedValue(new ApiError(403, 'You do not have permission for this project'));
    expect((await f.request(`/projects/${projectId}/files`)).status).toBe(403);
    files.mockRejectedValue({ code: '23505' });
    expect((await f.request(`/projects/${projectId}/files`)).status).toBe(409);
    files.mockRejectedValue(new Error('database-password-private'));
    const safe = await f.request(`/projects/${projectId}/files`);
    expect(safe.status).toBe(500);
    expect(await safe.text()).not.toContain('database-password');
    f.verify.mockRejectedValue(new ApiError(401, 'Invalid Supabase token'));
    const rejected = await f.request(`/projects/${projectId}/files`);
    expect(rejected.status).toBe(401);
  });

  it('rejects invalid auth and oversized/invalid request payloads before mutation', async () => {
    const f = fixture();
    expect((await f.request('/auth/signup', { email: account.email, password: 'short' }, {})).status).toBe(400);
    expect((await f.request('/auth/login', { email: 'wrong', password: 'password123' }, {})).status).toBe(400);
    expect((await f.request('/auth/reset-password', { email: account.email, admin: true }, {})).status).toBe(400);
    const tooLarge = await f.handler(new Request('https://example.supabase.co/projects', { method: 'POST', headers: { 'Content-Length': String(32 * 1024 * 1024 + 1), 'Content-Type': 'application/json' }, body: '{}' }));
    expect(tooLarge.status).toBe(413);
    const invalidJson = await f.handler(new Request('https://example.supabase.co/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
    expect(invalidJson.status).toBe(400);
    expect(f.auth.signUp).not.toHaveBeenCalled();
    expect(f.auth.signIn).not.toHaveBeenCalled();
  });

  it('delivers project-ID-only subscription events and cleans up aborts and timed renewal', async () => {
    vi.useFakeTimers();
    const f = fixture({ streamDurationMs: 30_000 });
    vi.spyOn(f.store, 'member').mockResolvedValue('owner');
    const abort = new AbortController();
    const response = await f.handler(new Request(`https://example.supabase.co/projects/${projectId}/events`, { signal: abort.signal, headers: { Authorization: 'Bearer supabase-jwt' } }));
    const reader = response.body!.getReader();
    const decode = (value?: Uint8Array) => new TextDecoder().decode(value);
    expect(decode((await reader.read()).value)).toBe(`event: ready\ndata: ${JSON.stringify({ projectId })}\n\n`);
    f.changed();
    expect(decode((await reader.read()).value)).toBe(`event: changed\ndata: ${JSON.stringify({ projectId })}\n\n`);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(decode((await reader.read()).value)).toBe(': keepalive\n\n');
    abort.abort();
    expect((await reader.read()).done).toBe(true);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const renewed = await f.request(`/projects/${projectId}/events`);
    const next = renewed.body!.getReader();
    await next.read();
    await vi.advanceTimersByTimeAsync(15_000);
    await next.read();
    await vi.advanceTimersByTimeAsync(15_000);
    await next.read();
    expect((await next.read()).done).toBe(true);
    expect(f.unsubscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes active streams when the session or project membership is revoked', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const member = vi.spyOn(f.store, 'member').mockResolvedValue('owner');
    const response = await f.request(`/projects/${projectId}/events`);
    const reader = response.body!.getReader();
    await reader.read();
    member.mockRejectedValue(new ApiError(403, 'Membership removed'));
    f.changed();
    expect((await reader.read()).done).toBe(true);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    member.mockResolvedValue('owner');
    const second = (await f.request(`/projects/${projectId}/events`)).body!.getReader();
    await second.read();
    f.verify.mockRejectedValue(new ApiError(401, 'Session revoked'));
    for (let n = 0; n < 4; n++) { await vi.advanceTimersByTimeAsync(15_000); await second.read(); }
    expect((await second.read()).done).toBe(true);
    expect(f.unsubscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Email cloud persistence policy', () => {
  it('keeps full revision writes and atomic commit notifications while disabling legacy Git jobs', async () => {
    const pool = new Pool({ connectionString: 'postgresql://test@localhost/test' });
    let current = { ...file };
    const query = vi.fn((sql: string, values?: unknown[]) => {
      if (sql.startsWith('insert into collaboration.projects')) return Promise.resolve({ rows: [{ id: projectId, name: 'Cloud', role: 'owner' }], rowCount: 1 });
      if (sql.startsWith('insert into collaboration.files')) return Promise.resolve({ rows: [{ id: fileId }], rowCount: 1 });
      if (sql.startsWith('select f.encoding')) return Promise.resolve({ rows: [current], rowCount: 1 });
      if (sql.startsWith('select role')) return Promise.resolve({ rows: [{ role: 'owner' }], rowCount: 1 });
      if (sql.startsWith('select token')) return Promise.resolve({ rows: [{ token }], rowCount: 1 });
      if (sql.startsWith('select coalesce(sum')) return Promise.resolve({ rows: [{ bytes: 0 }], rowCount: 1 });
      if (sql.startsWith('update collaboration.files')) current = { ...current, content: String(values?.[1]), version: 2 };
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as never);
    const store = new CollaborationStore(pool, 90, undefined, 'default', { enqueueHistory: false });
    expect(await store.create(account, { name: 'Cloud', files: [{ path: 'main.tex', content: 'source' }] })).toMatchObject({ id: projectId });
    expect(await store.done(account, { fileId, token, baseVersion: 1, requestId, content: 'saved' })).toMatchObject({ content: 'saved', version: 2 });
    const statements = query.mock.calls.map(call => call[0]);
    expect(statements.filter(sql => sql.startsWith('insert into collaboration.revisions'))).toHaveLength(2);
    expect(statements.some(sql => sql.includes('insert into collaboration.git_jobs'))).toBe(false);
    expect(statements.filter(sql => sql === 'commit')).toHaveLength(2);
    expect(statements.some(sql => sql.includes('pg_notify'))).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('refuses to silently replace a GitHub identity with an email profile', async () => {
    const pool = new Pool({ connectionString: 'postgresql://test@localhost/test' });
    const query = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const store = new CollaborationStore(pool);
    await expect(store.profile(account)).rejects.toMatchObject({ statusCode: 409 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("to_jsonb(profiles)->>'github_id' is null"), [account.id, account.email, account.displayName]);
  });
});
