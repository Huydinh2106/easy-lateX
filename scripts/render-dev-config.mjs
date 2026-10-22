import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './lib/api-dependencies.mjs';

config({ path: ['.env.local', '.env'], quiet: true });
const url = new URL(process.argv[2] || '');
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('Pass the HTTPS root URL of your Render API');
}
const values = { NODE_VERSION: '22', API_HOST: '0.0.0.0' };
for (const key of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_TOKEN_ENCRYPTION_KEY', 'GITHUB_WEBHOOK_SECRET']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
  values[key] = process.env[key];
}
values.GITHUB_CALLBACK_URL = new URL('/auth/github/callback', url).href;
values.GITHUB_PRIVATE_KEY_BASE64 = process.env.GITHUB_PRIVATE_KEY_BASE64 || Buffer.from(await readFile(process.env.GITHUB_PRIVATE_KEY_PATH)).toString('base64');
const directory = path.resolve('.local', 'cloud-dev');
await mkdir(directory, { recursive: true, mode: 0o700 });
const filename = path.join(directory, 'render.env');
await writeFile(filename, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
console.log(`Private configuration written to ${filename}. Import into Render only; never commit or share with desktop clients.`);
