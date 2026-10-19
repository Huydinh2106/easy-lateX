import Fastify from 'fastify';
import { z } from 'zod';
import type { Account } from '@easy-latex/shared-types';
import { ApiError, type CollaborationStore } from './store';
import { ProjectUpdates } from './project-updates';

export type VerifyAccount = (token: string) => Promise<Account>;
const uuid = z.uuid();
const leaseBody = z.object({ token: uuid });
const text = z.string().max(5 * 1024 * 1024).refine(value => !value.includes('\0') && Buffer.byteLength(value) <= 5 * 1024 * 1024, 'File content is too large or contains null bytes');
export function createServer(store: CollaborationStore, verify: VerifyAccount, updates = new ProjectUpdates(store.pool)) {
  const app = Fastify({ bodyLimit: 32 * 1024 * 1024, logger: false });
  app.addHook('preClose', async () => { await updates.close(); });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ message: error.message });
    if (error instanceof z.ZodError) return reply.code(400).send({ message: 'Invalid request' });
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return reply.code(409).send({ message: 'This file or project entry already exists' });
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.code(statusCode).send({ message: statusCode === 500 ? 'The operation could not be completed. Please retry.' : 'Invalid request' });
  });
  const accounts = new WeakMap<object, Account>();
  app.addHook('preHandler', async request => {
    if (request.routeOptions.url === '/health') return;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ') || header.length > 8192) throw new ApiError(401, 'Please sign in');
    const account = await verify(header.slice(7));
    await store.profile(account);
    accounts.set(request, account);
  });
  const user = (request: object): Account => accounts.get(request)!;
  const id = (params: unknown): string => z.object({ id: uuid }).parse(params).id;
  app.get('/health', () => ({ status: 'ok' }));
  app.get('/projects', request => store.projects(user(request).id));
  const directories = z.array(z.string().min(1).max(512)).max(1000);
  const files = z.array(z.object({ path: z.string().max(512), content: z.string().max(14*1024*1024), encoding: z.enum(['utf8','base64']).optional() })).max(1000);
  app.post('/projects', request => store.create(user(request), z.object({ name: z.string().trim().min(1).max(80), requestId: uuid.optional(), directories: directories.optional(), files: files.min(1).optional() }).parse(request.body)));
  app.get('/projects/:id/files', request => store.files(id(request.params), user(request).id));
  app.get('/projects/:id/events', async (request, reply) => {
    const projectId = id(request.params);
    const account = user(request);
    await store.member(store.pool, projectId, account.id);
    try { await updates.start(); } catch { throw new ApiError(503, 'Live updates are temporarily unavailable'); }
    if (request.raw.destroyed) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    });
    let closed = false;
    let sending = false;
    let pending = false;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(heartbeat); clearInterval(authorization); unsubscribe(); reply.raw.end();
    };
    const send = (event: string) => {
      if (!closed && !reply.raw.write(`event: ${event}\ndata: ${JSON.stringify({ projectId })}\n\n`)) close();
    };
    const changed = async () => {
      pending = true;
      if (sending || closed) return;
      sending = true;
      try {
        while (pending && !closed) {
          pending = false;
          await store.member(store.pool, projectId, account.id);
          send('changed');
        }
      } catch { close(); } finally { sending = false; }
    };
    unsubscribe = updates.subscribe(projectId, { changed: () => { void changed(); }, disconnected: close });
    reply.raw.once('close', close);
    reply.raw.once('error', close);
    const heartbeat = setInterval(() => { if (!closed && !reply.raw.write(': keepalive\n\n')) close(); }, 15_000);
    // Long-lived streams must not outlive revoked membership or account credentials.
    const authorization = setInterval(() => {
      void verify(request.headers.authorization!.slice(7)).then(async verified => {
        if (verified.id !== account.id) throw new Error('Account changed');
        await store.member(store.pool, projectId, account.id);
      }).catch(close);
    }, 60_000);
    send('ready');
  });
  app.post('/projects/:id/files', request => store.createFile(id(request.params), user(request), z.object({ path: z.string().max(512) }).parse(request.body).path));
  app.get('/projects/:id/directories', request => store.directories(id(request.params), user(request).id));
  app.post('/projects/:id/directories', request => store.createDirectory(id(request.params), user(request), z.object({ path: z.string().max(512) }).parse(request.body).path));
  app.post('/projects/:id/import', request => {
    const input = z.object({files, directories: directories.default([])}).parse(request.body);
    return store.importEntries(id(request.params), user(request), input.files, input.directories);
  });
  app.post('/files/:id/edit', request => store.acquire(id(request.params), user(request).id));
  app.post('/files/:id/renew', request => store.renew(id(request.params), user(request).id, leaseBody.parse(request.body).token));
  app.post('/files/:id/release', async request => { await store.release(id(request.params), user(request).id, leaseBody.parse(request.body).token); return { ok: true }; });
  app.post('/files/:id/done', request => store.done(user(request), { ...z.object({ token: uuid, baseVersion: z.number().int().positive(), content: text, requestId: uuid }).parse(request.body), fileId: id(request.params) }));
  app.get('/files/:id/history', request => store.history(id(request.params), user(request).id));
  app.post('/projects/:id/invitations', async request => {
    const b = z.object({ email: z.email().max(254), role: z.enum(['editor','viewer']) }).parse(request.body);
    await store.invite(id(request.params), user(request).id, b.email, b.role); return { ok: true };
  });
  app.get('/invitations', request => store.invitations(user(request).email));
  app.post('/invitations/:id/accept', async request => { await store.accept(id(request.params), user(request)); return { ok: true }; });
  return app;
}
