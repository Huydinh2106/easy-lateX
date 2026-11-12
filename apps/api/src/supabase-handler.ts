import { z } from 'zod';
import type { Account } from '@easy-latex/shared-types';
import { ApiError, type CollaborationStore } from './store';
import { ProjectUpdates } from './project-updates';
import type { VerifyAccount } from './server';

export interface EmailSession { token: string; refreshToken: string; expiresAt: number; account: Account; }
export interface SupabaseEmailAuth {
  signUp: (input: { email: string; password: string; displayName?: string | undefined }) => Promise<EmailSession | { confirmationRequired: true; message?: string }>;
  signIn: (input: { email: string; password: string }) => Promise<EmailSession>;
  refresh: (refreshToken: string) => Promise<EmailSession>;
  resetPassword: (email: string, redirectTo?: string) => Promise<{ message?: string }>;
  updatePassword?: (accessToken: string, password: string) => Promise<{ ok: true }>;
  signOut?: (accessToken: string) => Promise<void>;
}
export interface SupabaseHandlerOptions {
  basePath?: string;
  streamDurationMs?: number;
  auth?: SupabaseEmailAuth;
}
type Updates = Pick<ProjectUpdates, 'start' | 'subscribe' | 'close'>;
interface Context { request: Request; body: unknown; params: Record<string, string>; account?: Account; }
interface Route { method: string; path: string; pattern: RegExp; names: string[]; handler(context: Context): unknown; }
const uuid = z.uuid();
const lease = z.object({ token: uuid });
const directories = z.array(z.string().min(1).max(512)).max(1000);
const files = z.array(z.object({ path: z.string().max(512), content: z.string().max(14 * 1024 * 1024), encoding: z.enum(['utf8', 'base64']).optional() })).max(1000);
const text = z.string().max(5 * 1024 * 1024).refine(value => !value.includes('\0') && Buffer.byteLength(value) <= 5 * 1024 * 1024, 'File content is too large or contains null bytes');
const email = z.email().trim().max(254);
const recoveryRedirect = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port && !url.username && !url.password && !url.search && !url.hash && /^\/auth\/recovery\/[a-f0-9]{48}$/.test(url.pathname);
}, 'Invalid desktop recovery callback');
const json = (value: unknown, status = 200): Response => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const maximumBodyBytes = 32 * 1024 * 1024;

async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maximumBodyBytes) throw new ApiError(413, 'Request body is too large');
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBodyBytes) { await reader.cancel(); throw new ApiError(413, 'Request body is too large'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return undefined;
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Use application/json');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new ApiError(400, 'Invalid JSON'); }
}

/** Email-authenticated cloud source, resource and revision APIs. No Git dependency. */
export function createSupabaseHandler(
  store: CollaborationStore,
  verify: VerifyAccount,
  updates: Updates = new ProjectUpdates(store.pool),
  options: SupabaseHandlerOptions = {}
): (request: Request) => Promise<Response> {
  const routes: Route[] = [];
  const basePath = options.basePath?.replace(/\/$/, '') ?? '';
  if (basePath && (!basePath.startsWith('/') || basePath.includes('?') || basePath.includes('#'))) throw new Error('Invalid Edge base path');
  const duration = options.streamDurationMs ?? 110_000;
  if (!Number.isFinite(duration) || duration < 1 || duration > 110_000) throw new Error('Edge stream duration must be between 1 and 110000 milliseconds');
  const add = (method: string, path: string, handler: Route['handler']) => {
    const names: string[] = [];
    const expression = path.split('/').map(part => {
      if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    routes.push({ method, path, names, pattern: new RegExp(`^${expression}$`), handler });
  };
  const get = (path: string, handler: Route['handler']) => add('GET', path, handler);
  const post = (path: string, handler: Route['handler']) => add('POST', path, handler);
  const user = (context: Context): Account => {
    if (!context.account) throw new ApiError(401, 'Please sign in');
    return context.account;
  };
  const id = (context: Context) => z.object({ id: uuid }).parse(context.params).id;
  const auth = () => {
    if (!options.auth) throw new ApiError(503, 'Email authentication is not configured');
    return options.auth;
  };
  const publicRoutes = new Set(['/health', '/auth/confirmed', '/auth/signup', '/auth/login', '/auth/refresh', '/auth/reset-password']);
  get('/health', () => ({ status: 'ok', collaboration: 'supabase', authentication: 'email' }));
  get('/auth/confirmed', () => new Response('Your email is confirmed. You can return to Easy LaTeX and sign in.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  }));
  post('/auth/signup', context => auth().signUp(z.object({ email, password: z.string().min(8).max(1024), displayName: z.string().trim().min(1).max(100).optional() }).strict().parse(context.body)));
  post('/auth/login', context => auth().signIn(z.object({ email, password: z.string().min(1).max(1024) }).strict().parse(context.body)));
  post('/auth/refresh', context => auth().refresh(z.object({ refreshToken: z.string().min(1).max(8192) }).strict().parse(context.body).refreshToken));
  post('/auth/reset-password', context => {
    const input = z.object({ email, redirectTo: recoveryRedirect.optional() }).strict().parse(context.body);
    return auth().resetPassword(input.email, input.redirectTo);
  });
  get('/auth/user', context => user(context));
  post('/auth/update-password', context => {
    const password = z.object({ password: z.string().min(8).max(1024) }).strict().parse(context.body).password;
    const service = auth();
    if (!service.updatePassword) throw new ApiError(503, 'Password recovery is not configured');
    return service.updatePassword(context.request.headers.get('authorization')!.slice(7), password);
  });
  post('/auth/logout', async context => {
    const token = context.request.headers.get('authorization')!.slice(7);
    if (auth().signOut) await auth().signOut!(token);
    return { ok: true };
  });
  get('/projects', context => store.projects(user(context).id));
  post('/projects', context => store.create(user(context), z.object({ name: z.string().trim().min(1).max(80), requestId: uuid.optional(), directories: directories.optional(), files: files.min(1).optional() }).parse(context.body)));
  get('/projects/:id', async context => {
    const projectId = id(context);
    await store.member(store.pool, projectId, user(context).id);
    const project = (await store.projects(user(context).id)).find(value => value.id === projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    return project;
  });
  get('/projects/:id/files', context => store.files(id(context), user(context).id));
  post('/projects/:id/files', context => store.createFile(id(context), user(context), z.object({ path: z.string().max(512) }).parse(context.body).path));
  get('/projects/:id/directories', context => store.directories(id(context), user(context).id));
  post('/projects/:id/directories', context => store.createDirectory(id(context), user(context), z.object({ path: z.string().max(512) }).parse(context.body).path));
  post('/projects/:id/import', context => {
    const input = z.object({ files, directories: directories.default([]) }).parse(context.body);
    return store.importEntries(id(context), user(context), input.files, input.directories);
  });
  post('/files/:id/edit', context => store.acquire(id(context), user(context).id));
  post('/files/:id/renew', context => store.renew(id(context), user(context).id, lease.parse(context.body).token));
  post('/files/:id/release', async context => { await store.release(id(context), user(context).id, lease.parse(context.body).token); return { ok: true }; });
  post('/files/:id/done', context => store.done(user(context), { ...z.object({ token: uuid, baseVersion: z.number().int().positive(), content: text, requestId: uuid }).parse(context.body), fileId: id(context) }));
  get('/files/:id/history', context => store.history(id(context), user(context).id));
  post('/projects/:id/invitations', async context => {
    const input = z.object({ email, role: z.enum(['editor', 'viewer']) }).parse(context.body);
    await store.invite(id(context), user(context).id, input.email, input.role);
    return { ok: true };
  });
  get('/invitations', context => store.invitations(user(context).email));
  post('/invitations/:id/accept', async context => { await store.accept(id(context), user(context)); return { ok: true }; });
  get('/projects/:id/events', async context => {
    const projectId = id(context), account = user(context);
    await store.member(store.pool, projectId, account.id);
    try { await updates.start(); } catch { throw new ApiError(503, 'Live updates are temporarily unavailable'); }
    const encoder = new TextEncoder();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let closed = false, sending = false, pending = false;
    let unsubscribe = () => {};
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      unsubscribe();
      context.request.signal.removeEventListener('abort', close);
      try { controller?.close(); } catch { /* Cancelled responses are already closed. */ }
    };
    const write = (frame: string) => {
      if (closed) return;
      if (controller && controller.desiredSize !== null && controller.desiredSize <= 0) { close(); return; }
      try { controller?.enqueue(encoder.encode(frame)); } catch { close(); }
    };
    const send = (event: string) => write(`event: ${event}\ndata: ${JSON.stringify({ projectId })}\n\n`);
    const changed = () => {
      pending = true;
      if (sending || closed) return;
      sending = true;
      void (async () => {
        try {
          while (pending && !closed) { pending = false; await store.member(store.pool, projectId, account.id); send('changed'); }
        } catch { close(); } finally { sending = false; }
      })();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(output) {
        controller = output;
        context.request.signal.addEventListener('abort', close, { once: true });
        if (context.request.signal.aborted) { close(); return; }
        unsubscribe = updates.subscribe(projectId, { changed, disconnected: close });
        if (closed) { unsubscribe(); return; }
        timers.push(setInterval(() => write(': keepalive\n\n'), 15_000));
        timers.push(setInterval(() => {
          void verify(context.request.headers.get('authorization')!.slice(7)).then(async verified => {
            if (verified.id !== account.id) throw new Error('Account changed');
            await store.member(store.pool, projectId, account.id);
          }).catch(close);
        }, 60_000));
        timers.push(setTimeout(close, duration));
        send('ready');
      },
      cancel: close
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  });

  return async request => {
    try {
      let pathname = new URL(request.url).pathname;
      if (basePath) {
        if (!pathname.startsWith(`${basePath}/`)) throw new ApiError(404, 'Route not found');
        pathname = pathname.slice(basePath.length);
      }
      const route = routes.find(value => value.method === request.method && value.pattern.test(pathname));
      if (!route) throw new ApiError(404, 'Route not found');
      const match = route.pattern.exec(pathname)!;
      const params: Record<string, string> = {};
      for (const [index, name] of route.names.entries()) {
        try { params[name] = decodeURIComponent(match[index + 1]!); } catch { throw new ApiError(400, 'Invalid request'); }
      }
      const context: Context = { request, body: undefined, params };
      if (request.method !== 'GET' && request.method !== 'HEAD') context.body = await body(request);
      if (!publicRoutes.has(route.path)) {
        const authorization = request.headers.get('authorization');
        if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) throw new ApiError(401, 'Please sign in');
        context.account = await verify(authorization.slice(7));
        await store.profile(context.account);
      }
      const result = await route.handler(context);
      return result instanceof Response ? result : json(result);
    } catch (error) {
      if (error instanceof ApiError) return json({ message: error.message }, error.statusCode);
      if (error instanceof z.ZodError) return json({ message: 'Invalid request' }, 400);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return json({ message: 'This file or project entry already exists' }, 409);
      return json({ message: 'The operation could not be completed. Please retry.' }, 500);
    }
  };
}
