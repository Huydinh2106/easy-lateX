import { Pool } from 'pg';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import type { Account } from '@easy-latex/shared-types';
import { createAssetStore } from './assets';
import { ApiError, CollaborationStore } from './store';
import { ProjectUpdates } from './project-updates';
import { edgeDatabaseConfiguration, type EdgeEnvironment } from './edge-runtime';
import { createSupabaseHandler, type EmailSession, type SupabaseEmailAuth } from './supabase-handler';

const publicPath = '/easy-latex-api';
const gatewayPath = `/functions/v1${publicPath}`;
const account = (user: User): Account => ({
  id: user.id, email: user.email ?? '',
  displayName: typeof user.user_metadata.display_name === 'string' && user.user_metadata.display_name.trim()
    ? user.user_metadata.display_name.trim().slice(0, 80) : (user.email?.split('@')[0] ?? 'User'),
});
const session = (value: Session): EmailSession => ({
  token: value.access_token, refreshToken: value.refresh_token,
  expiresAt: (value.expires_at ?? Math.floor(Date.now()/1000) + value.expires_in) * 1000,
  account: account(value.user),
});

export function createSupabaseEmailRuntime(env: EdgeEnvironment) {
  const required = (name: string) => { const value = env[name]; if (!value) throw new Error(`Missing backend configuration ${name}`); return value; };
  const url = required('SUPABASE_URL'), anonKey = required('SUPABASE_ANON_KEY'), serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const pool = new Pool(edgeDatabaseConfiguration(env.DATABASE_URL ?? required('SUPABASE_DB_URL'), env.EASY_LATEX_DATABASE_CA_BASE64));
  pool.on('error', () => console.error('A database connection was interrupted.'));
  const client = () => createClient(url, anonKey, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}});
  const verify = async (token: string): Promise<Account> => {
    const {data, error} = await client().auth.getUser(token);
    if (error || !data.user?.email) throw new ApiError(401, 'Please sign in with your email and password');
    return account(data.user);
  };
  const auth: SupabaseEmailAuth = {
    async signUp(input) {
      const {data, error} = await client().auth.signUp({email: input.email, password: input.password,
        options: {emailRedirectTo: `${url}/functions/v1/easy-latex-api/auth/confirmed`, data: {display_name: input.displayName ?? input.email.split('@')[0]}}});
      if (error) throw new ApiError(error.status === 429 ? 429 : 400, error.status === 429 ? 'Too many requests. Please try again later.' : error.message);
      if (data.session) return session(data.session);
      return {confirmationRequired: true, message: 'Check your email to confirm your account, then sign in.'};
    },
    async signIn(input) {
      const {data, error} = await client().auth.signInWithPassword(input);
      if (error || !data.session) throw new ApiError(401, error?.code === 'email_not_confirmed' ? 'Confirm your email before signing in.' : 'Email or password is incorrect.');
      return session(data.session);
    },
    async refresh(refreshToken) {
      const {data, error} = await client().auth.refreshSession({refresh_token: refreshToken});
      if (error && (!error.status || error.status === 429 || error.status >= 500)) {
        throw new ApiError(error.status === 429 ? 429 : 503, 'Session refresh is temporarily unavailable. Please try again later.');
      }
      if (error || !data.session) throw new ApiError(401, 'Your session expired. Please sign in again.');
      return session(data.session);
    },
    async resetPassword(email, redirectTo) {
      const {error} = await client().auth.resetPasswordForEmail(email, redirectTo ? {redirectTo} : {});
      if (error) throw new ApiError(error.status === 429 ? 429 : 503,
        error.status === 429 ? 'Too many requests. Please try again later.' : 'Password reset email is temporarily unavailable. Please try again later.');
      return {message: 'If an account exists, a password reset link has been sent to your email.'};
    },
    async updatePassword(accessToken, password) {
      const response = await fetch(`${url}/auth/v1/user`, {method: 'PUT',
        headers: {apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({password}), signal: AbortSignal.timeout(20_000)});
      if (!response.ok) throw new ApiError(400, 'Your password could not be updated. Request a new reset link and try again.');
      await response.body?.cancel(); return {ok: true};
    },
    async signOut(accessToken) {
      const response = await fetch(`${url}/auth/v1/logout?scope=local`, {method: 'POST',
        headers: {apikey: anonKey, Authorization: `Bearer ${accessToken}`}, signal: AbortSignal.timeout(20_000)});
      await response.body?.cancel();
    },
  };
  const store = new CollaborationStore(pool, 90, createAssetStore(url, serviceKey), 'default', {enqueueHistory: false});
  const updates = new ProjectUpdates(pool);
  const handler = createSupabaseHandler(store, verify, updates, {basePath: publicPath, streamDurationMs: 110_000, auth});
  return {
    async fetch(request: Request): Promise<Response> {
      const target = new URL(request.url);
      if (target.pathname === gatewayPath || target.pathname.startsWith(`${gatewayPath}/`)) {
        target.pathname = publicPath + target.pathname.slice(gatewayPath.length);
        request = new Request(target, request);
      }
      if (request.method === 'GET' && target.pathname === `${publicPath}/health`) {
        try {
          const {rows} = await pool.query<{ready: boolean}>("select to_regclass('collaboration.files') is not null and to_regclass('collaboration.revisions') is not null as ready");
          if (!rows[0]?.ready) throw new Error('Schema is incomplete');
          return Response.json({status: 'ok', collaboration: 'supabase', authentication: 'email', database: 'ready', runtime: 'supabase-edge'});
        } catch { return Response.json({status: 'unavailable', message: 'Database is not ready'}, {status: 503}); }
      }
      return handler(request);
    },
    async close() { await updates.close(); await pool.end(); },
  };
}
