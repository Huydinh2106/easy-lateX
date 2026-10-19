import { createServer } from 'node:http';
import { randomBytes, createPrivateKey } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, parse } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function updateEnvironment(source, values) {
  let output = source;
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error('Invalid configuration');
    const quote = ["'", '"', '`'].find(mark => !value.includes(mark));
    if (!quote) throw new Error('Configuration contains unsupported quote characters');
    const line = `${key}=${quote}${value}${quote}`;
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    if (pattern.test(output)) { pattern.lastIndex = 0; output = output.replace(pattern, () => line); }
    else output += `${output.endsWith('\n') || !output ? '' : '\n'}${line}\n`;
  }
  return output;
}

export function appManifest({ name, callbackUrl, redirectUrl, webhookUrl }) {
  return {
    name, url: 'https://github.com', description: 'Private GitHub collaboration for Easy LaTeX.',
    redirect_url: redirectUrl, callback_urls: [callbackUrl], public: true,
    request_oauth_on_install: false,
    hook_attributes: { url: webhookUrl || new URL('/github/webhook', callbackUrl).href, active: Boolean(webhookUrl) },
    default_permissions: { contents: 'write', administration: 'write', metadata: 'read' },
    default_events: ['push', 'repository', 'member']
  };
}

export async function runSetup() {
  config({ path: [path.join(root, '.env.local'), path.join(root, '.env')], quiet: true });
  if (process.env.GITHUB_APP_ID) throw new Error('An App is already configured. Keep its credentials; do not register a duplicate.');
  const callbackUrl = process.env.GITHUB_CALLBACK_URL || 'http://127.0.0.1:4318/auth/github/callback';
  const callback = new URL(callbackUrl);
  if (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(callback.hostname))) throw new Error('Callback must use HTTPS or loopback HTTP');
  const webhookUrl = process.env.GITHUB_SETUP_WEBHOOK_URL || '';
  if (!webhookUrl || new URL(webhookUrl).protocol !== 'https:') throw new Error('Set GITHUB_SETUP_WEBHOOK_URL to an HTTPS webhook target first');
  const state = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:4319';
  const setupPath = `/setup/${randomBytes(24).toString('hex')}`;
  let busy = false, completed = false;
  const manifest = appManifest({ name: `Easy LaTeX ${randomBytes(4).toString('hex')}`, callbackUrl, redirectUrl: `${origin}/callback`, webhookUrl });
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; form-action https://github.com; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.headers.host !== '127.0.0.1:4319' || request.method !== 'GET') { response.writeHead(404).end(); return; }
    const url = new URL(request.url, origin);
    if (url.pathname === setupPath) {
      response.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Thiết lập GitHub cho Easy LaTeX</title><h1>Thiết lập GitHub App</h1><p>App sẽ yêu cầu Contents và Administration đọc/ghi trên repository được chọn. Bạn sẽ duyệt thông tin và tạo App trên GitHub.</p><p>Private key và client secret sẽ được lưu vào cấu hình backend trên máy này, không hiển thị trong chat hoặc desktop.</p><p>${webhookUrl ? 'Webhook đã có URL HTTPS.' : 'Webhook ngoài app chưa bật vì chưa có URL HTTPS; đăng nhập và xuất bản trong app có thể được thử trước.'}</p><form action="https://github.com/settings/apps/new?state=${state}" method="post"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button type="submit">Tiếp tục trên GitHub</button></form></html>`);
      return;
    }
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state || busy || completed || !/^[A-Za-z0-9_-]{1,512}$/.test(url.searchParams.get('code') || '')) { response.writeHead(400).end('Invalid or already consumed setup callback.'); return; }
    busy = true;
    try {
      const result = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, { method: 'POST', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }, redirect: 'error', signal: AbortSignal.timeout(25_000) });
      if (!result.ok) throw new Error('GitHub manifest conversion failed');
      const app = await result.json();
      if (!Number.isSafeInteger(app.id) || typeof app.slug !== 'string' || !/^[a-z0-9-]+$/i.test(app.slug) || ![app.pem, app.client_id, app.client_secret, app.webhook_secret].every(v => typeof v === 'string' && v.length > 0)) throw new Error('Invalid GitHub App configuration');
      createPrivateKey(app.pem);
      const envPath = path.join(root, '.env.local');
      let source = ''; try { source = await readFile(envPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const current = parse(source);
      if (current.GITHUB_APP_ID) throw new Error('App configuration changed while setup was open');
      const keyPath = path.join(root, '.secrets', `github-app-${app.id}.pem`);
      await mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
      await writeFile(keyPath, app.pem, { mode: 0o600, flag: 'wx' });
      const values = { GITHUB_APP_ID: String(app.id), GITHUB_APP_SLUG: app.slug, GITHUB_CLIENT_ID: app.client_id, GITHUB_CLIENT_SECRET: app.client_secret, GITHUB_CALLBACK_URL: callbackUrl, GITHUB_PRIVATE_KEY_PATH: keyPath, GITHUB_WEBHOOK_SECRET: app.webhook_secret,
        GITHUB_TOKEN_ENCRYPTION_KEY: current.GITHUB_TOKEN_ENCRYPTION_KEY || process.env.GITHUB_TOKEN_ENCRYPTION_KEY || randomBytes(32).toString('base64') };
      const temporary = `${envPath}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, updateEnvironment(source, values), { mode: 0o600 });
      await rename(temporary, envPath);
      completed = true;
      console.log('GitHub App configured. Credentials saved privately; existing database/API settings preserved.');
      console.log(`App settings: https://github.com/settings/apps/${app.slug}`);
      response.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>Đã thiết lập GitHub</title><h1>Đã lưu cấu hình GitHub App</h1><p>Quay lại Easy LaTeX. Secret và private key đã được lưu trên backend.</p></html>');
      server.close();
    } catch {
      // Never print callback codes, private keys, tokens or upstream error bodies.
      response.writeHead(502).end('Setup could not be saved. Keep this process open and check local configuration before retrying.');
      console.error('GitHub App setup did not finish; no credentials were logged.');
    } finally { busy = false; }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4319, '127.0.0.1', resolve); });
  const timeout = setTimeout(() => { console.log('GitHub setup expired. Run npm run github:setup again.'); server.close(); }, 55 * 60_000);
  timeout.unref();
  server.once('close', () => clearTimeout(timeout));
  console.log(`Open setup: ${origin}${setupPath}`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSetup().catch(() => { console.error('Could not start GitHub setup. Check existing App configuration, callback URL and port 4319.'); process.exitCode = 1; });
}
