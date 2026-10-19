import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeApiUrl, readReleaseApiUrl } from '../src/main/services/account/ApiConfiguration';
import { SettingsManager } from '../src/main/services/settings/SettingsManager';

describe('desktop server configuration', () => {
  it('rejects credential-bearing and insecure remote addresses', () => {
    for (const url of ['http://192.168.1.2:4318', 'https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#token', 'file:///tmp/api']) expect(() => normalizeApiUrl(url)).toThrow();
    expect(normalizeApiUrl(' https://example.com/api/ ')).toBe('https://example.com/api');
    expect(normalizeApiUrl('http://127.0.0.1:4318')).toBe('http://127.0.0.1:4318');
  });
  it('reads only public release settings and preserves the selected server across launches', async () => {
    const directory=await mkdtemp(path.join(os.tmpdir(),'easy-latex-api-config-'));
    try {
      expect(await readReleaseApiUrl(directory)).toBe('');
      await writeFile(path.join(directory,'desktop-config.json'),JSON.stringify({apiUrl:'https://api.example.com/'}));
      const settingsPath=path.join(directory,'settings.json');
      const first=new SettingsManager(settingsPath);
      await first.set('collaborationApiUrl',await readReleaseApiUrl(directory));
      expect(await new SettingsManager(settingsPath).get('collaborationApiUrl')).toBe('https://api.example.com');
    } finally {await rm(directory,{recursive:true,force:true});}
  });
});
