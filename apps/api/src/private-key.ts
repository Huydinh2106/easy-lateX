import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function loadGitHubPrivateKey(env: NodeJS.ProcessEnv): Promise<string> {
  let pem: string;
  if (env.GITHUB_PRIVATE_KEY_BASE64) {
    const encoded = env.GITHUB_PRIVATE_KEY_BASE64.trim();
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw new Error('Invalid GITHUB_PRIVATE_KEY_BASE64');
    pem = bytes.toString('utf8');
  } else {
    if (!env.GITHUB_PRIVATE_KEY_PATH) throw new Error('Set GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY_BASE64');
    pem = await readFile(env.GITHUB_PRIVATE_KEY_PATH, 'utf8');
  }
  try {
    if (createPrivateKey(pem).asymmetricKeyType !== 'rsa') throw new Error('Unsupported key');
  } catch { throw new Error('GitHub App requires a valid RSA private key'); }
  return pem;
}
