import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
const directories:string[]=[];
afterEach(async()=>{for(const d of directories.splice(0))await rm(d,{recursive:true,force:true});});
const encryption={available:()=>true,encrypt:(s:string)=>Buffer.from([...s].reverse().join('')),decrypt:(b:Buffer)=>[...b.toString()].reverse().join('')};
describe('Secure account session storage',()=>{
  it('persists encrypted data and serializes writes without exposing the token',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'easy-latex-account-'));directories.push(dir);const file=path.join(dir,'session');
    const store=new SecureSessionStorage(file,encryption);await Promise.all([store.setItem('token','secret-account-token'),store.setItem('pkce','private-verifier')]);
    expect(await readFile(file,'utf8')).not.toContain('secret-account-token');
    const restored=new SecureSessionStorage(file,encryption);expect(await Promise.all([restored.getItem('token'),restored.getItem('pkce')])).toEqual(['secret-account-token','private-verifier']);
    await restored.removeItem('token');expect(await new SecureSessionStorage(file,encryption).getItem('token')).toBeNull();
  });
  it('keeps credentials in memory when OS encryption is unavailable',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'easy-latex-account-'));directories.push(dir);const file=path.join(dir,'session');const store=new SecureSessionStorage(file,{...encryption,available:()=>false});
    await store.setItem('token','secret');expect(await store.getItem('token')).toBe('secret');await expect(readFile(file)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('restores the saved session when the OS key store becomes available later',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'easy-latex-account-'));directories.push(dir);const file=path.join(dir,'session');
    await new SecureSessionStorage(file,encryption).setItem('token','saved-session');
    let available=false;const store=new SecureSessionStorage(file,{...encryption,available:()=>available});
    expect(await store.getItem('token')).toBeNull();
    available=true;
    expect(await store.getItem('token')).toBe('saved-session');
  });
  it('persists memory-only changes on recovery without restoring a signed-out session',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'easy-latex-account-'));directories.push(dir);const file=path.join(dir,'session');
    const original=new SecureSessionStorage(file,encryption);await original.setItem('token','old-session');await original.setItem('other','preserved');
    let available=false;const store=new SecureSessionStorage(file,{...encryption,available:()=>available});
    await store.removeItem('token');await store.setItem('new','memory-session');
    available=true;
    expect(await store.getItem('token')).toBeNull();
    const restored=new SecureSessionStorage(file,encryption);
    expect(await restored.getItem('token')).toBeNull();expect(await restored.getItem('new')).toBe('memory-session');expect(await restored.getItem('other')).toBe('preserved');
  });
  it('removes the encrypted session on sign-out even when the key store is unavailable',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'easy-latex-account-'));directories.push(dir);const file=path.join(dir,'session');
    await new SecureSessionStorage(file,encryption).setItem('token','saved-session');
    const store=new SecureSessionStorage(file,{...encryption,available:()=>false});
    await store.clear();
    expect(await new SecureSessionStorage(file,encryption).getItem('token')).toBeNull();
    await expect(readFile(file)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('flushes a changed session after the key store becomes unavailable and then recovers',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'easy-latex-account-'));directories.push(dir);const file=path.join(dir,'session');
    let available=true;const store=new SecureSessionStorage(file,{...encryption,available:()=>available});
    await store.setItem('token','old-session');available=false;
    await store.setItem('token','refreshed-session');available=true;
    expect(await store.getItem('token')).toBe('refreshed-session');
    expect(await new SecureSessionStorage(file,encryption).getItem('token')).toBe('refreshed-session');
    await Promise.all([store.setItem('token','late-session'),store.clear()]);
    expect(await new SecureSessionStorage(file,encryption).getItem('token')).toBeNull();
  });
});
