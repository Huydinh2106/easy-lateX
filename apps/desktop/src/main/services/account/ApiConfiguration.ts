import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function normalizeApiUrl(value: string): string {
  if (!value.trim()) return '';
  if (value.length > 2048) throw new Error('Server address is too long');
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Use an HTTPS server address, or localhost for development');
  return url.href.replace(/\/+$/, '');
}

export async function readReleaseApiUrl(resourcesPath: string): Promise<string> {
  try {
    const value: unknown = JSON.parse(await readFile(path.join(resourcesPath, 'desktop-config.json'), 'utf8'));
    if (!value || typeof value !== 'object' || !('apiUrl' in value) || typeof value.apiUrl !== 'string') throw new Error('Invalid desktop server configuration');
    return normalizeApiUrl(value.apiUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
