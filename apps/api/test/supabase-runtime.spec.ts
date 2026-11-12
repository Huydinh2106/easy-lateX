import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseEmailRuntime } from '../src/supabase-runtime';

const projectUrl = 'https://runtime-fixture.supabase.co';
const callback = `http://127.0.0.1:4319/auth/recovery/${'a'.repeat(48)}`;
let runtime: ReturnType<typeof createSupabaseEmailRuntime> | undefined;

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function authRequest(route: string, input: object, status: number, payload: object) {
  const fetchAuth = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, {status}));
  vi.stubGlobal('fetch', fetchAuth);
  runtime = createSupabaseEmailRuntime({
    SUPABASE_URL: projectUrl, SUPABASE_ANON_KEY: 'fixture-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
    SUPABASE_DB_URL: 'postgresql://fixture@127.0.0.1:54322/fixture',
  });
  const response = runtime.fetch(new Request(`${projectUrl}/functions/v1/easy-latex-api${route}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(input),
  }));
  return {fetchAuth, response};
}

function resetRequest(status: number, payload: object) {
  return authRequest('/auth/reset-password', {email: 'writer@example.test', redirectTo: callback}, status, payload);
}

describe('Supabase password reset delivery', () => {
  it('preserves the private recovery callback and reports success only after Auth accepts the request', async () => {
    const {fetchAuth, response} = resetRequest(200, {});
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({message: 'If an account exists, a password reset link has been sent to your email.'});
    expect(fetchAuth).toHaveBeenCalledTimes(1);
    const [url, options] = fetchAuth.mock.calls[0]!;
    const target = new URL(url instanceof Request ? url.url : url);
    expect(target.pathname).toBe('/auth/v1/recover');
    expect(target.searchParams.get('redirect_to')).toBe(callback);
    if (typeof options?.body !== 'string') throw new Error('Expected an Auth JSON request');
    expect(JSON.parse(options.body)).toMatchObject({email: 'writer@example.test'});
  });

  it.each([429, 500])('reports Auth delivery error %s without exposing provider details', async status => {
    const {response} = resetRequest(status, {message: 'private-smtp-provider-detail', code: 'unexpected_failure'});
    const result = await response;
    expect(result.status).toBe(status === 429 ? 429 : 503);
    const body = await result.text();
    expect(body).not.toContain('private-smtp-provider-detail');
    expect(body).not.toContain('has been sent');
    expect(body).toContain(status === 429 ? 'Too many requests' : 'temporarily unavailable');
  });
});

describe('Supabase session refresh failures', () => {
  it.each([[400, 401], [429, 429], [500, 503]])('maps Auth error %s to %s so temporary failures do not discard the saved session', async (status, expected) => {
    // The official SDK retries server failures with a bounded backoff.
    vi.useFakeTimers();
    const {response} = authRequest('/auth/refresh', {refreshToken: 'opaque-refresh-token'}, status, {
      code: status === 400 ? 'refresh_token_not_found' : 'unexpected_failure', message: 'private-auth-provider-detail',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await response;
    expect(result.status).toBe(expected);
    expect(await result.text()).not.toContain('private-auth-provider-detail');
  });
});
