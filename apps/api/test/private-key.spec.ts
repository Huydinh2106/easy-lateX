import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGitHubPrivateKey } from '../src/private-key';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('GitHub App deployment key', () => {
  it('loads the existing file configuration', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'easy-latex-key-'));
    try {
      const filename = path.join(directory, 'app.pem');
      await writeFile(filename, pem, { mode: 0o600 });
      expect(await loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_PATH: filename })).toBe(pem);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('accepts a single-line secret variable on cloud hosts', async () => {
    expect(await loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_BASE64: Buffer.from(pem).toString('base64') })).toBe(pem);
  });
  it('rejects malformed base64 without disclosing its contents', async () => {
    await expect(loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_BASE64: 'private!data' })).rejects.toThrow('Invalid GITHUB_PRIVATE_KEY_BASE64');
  });
  it('rejects a non-RSA key', async () => {
    const key = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    await expect(loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_BASE64: Buffer.from(key).toString('base64') })).rejects.toThrow('GitHub App requires a valid RSA private key');
  });
});
