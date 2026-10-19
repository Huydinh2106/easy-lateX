import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
const storage=()=>new SecureSessionStorage('/unused',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''});
const account={id:'user',email:'42+alice@users.noreply.github.com',displayName:'Alice',githubId:'42',githubLogin:'alice'};
const session={token:'never-in-renderer',refreshToken:'refresh-private',expiresAt:Date.now()+900000,account,backendUrl:'http://127.0.0.1:4318'};
afterEach(()=>vi.restoreAllMocks());
const urlText=(v:string|URL|Request)=>typeof v==='string'?v:v instanceof URL?v.href:v.url;
const json=(v:unknown)=>Promise.resolve(new Response(JSON.stringify(v),{status:200}));
describe('GitHub desktop sign-in',()=>{
  it('verifies loopback state and exchanges the handoff with desktop proof; renderer receives no tokens',async()=>{
    const realFetch=globalThis.fetch;let callback='';let proof='';
    vi.spyOn(globalThis,'fetch').mockImplementation((url,options)=>{
      if(urlText(url).startsWith('http://127.0.0.1:4318')){
        if(urlText(url).endsWith('/start')){const body=JSON.parse(options!.body as string) as {returnUrl:string;challenge:string};callback=body.returnUrl;proof=body.challenge;return json({state:'backend-state',url:'https://github.com/login/oauth/authorize?state=backend-state'});}
        if(urlText(url).endsWith('/exchange')){const body=JSON.parse(options!.body as string) as {state:string;verifier:string};expect(body.state).toBe('backend-state');expect(body.verifier).toHaveLength(43);expect(proof).toHaveLength(43);return json(session);}
        if(urlText(url).endsWith('/install'))return json({installed:true,url:'https://github.com/apps/easy-latex/installations/new'});
      }
      return realFetch(url,options);
    });
    const manager=new AccountManager({url:'http://127.0.0.1:4318'},storage(),async()=>{
      expect((await realFetch(`${callback}?state=wrong&code=bad`)).status).toBe(400);
      expect((await realFetch(`${callback}?state=backend-state&code=handoff`)).status).toBe(200);
    });
    const state=await manager.github();expect(new URL(callback).hostname).toBe('127.0.0.1');expect(state.account).toEqual(account);expect(JSON.stringify(state)).not.toContain(session.token);expect(await manager.accessToken()).toBe(session.token);
  });
  it('serializes session refresh and clears local credentials when logout cannot reach the API',async()=>{
    const store=storage();await store.setItem('github-app-session',JSON.stringify({...session,expiresAt:0}));
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(url=>urlText(url).endsWith('/refresh')?json({...session,token:'renewed'}):Promise.reject(new Error('offline')));
    const manager=new AccountManager({url:'http://127.0.0.1:4318'},store,async()=>{});
    expect(await Promise.all([manager.accessToken(),manager.accessToken()])).toEqual(['renewed','renewed']);expect(fetcher).toHaveBeenCalledTimes(1);
    await manager.signOut();expect((await manager.state()).account).toBeNull();
  });
  it('cancels an outstanding sign-in and rejects an unexpected authorization URL',async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(()=>json({state:'state',url:'https://github.com/login/oauth/authorize?state=state'}));
    let opened=()=>{};const ready=new Promise<void>(r=>{opened=r;});
    const manager=new AccountManager({url:'http://127.0.0.1:4318'},storage(),()=>{opened();return Promise.resolve();});
    const result=manager.github();const rejected=expect(result).rejects.toThrow('cancelled');await ready;await manager.cancel();await rejected;
    vi.mocked(fetch).mockImplementation(()=>json({state:'state',url:'https://evil.example/auth?state=state'}));
    await expect(manager.github()).rejects.toThrow('Unexpected authorization');
  });
  it('reports missing backend configuration before opening a browser',async()=>{const manager=new AccountManager({},storage(),async()=>{});await expect(manager.accessToken()).rejects.toThrow('Please sign in');await expect(manager.github()).rejects.toThrow('not configured');});
  it('never sends a stored session to a different configured server',async()=>{
    const store=storage();await store.setItem('github-app-session',JSON.stringify(session));
    const fetcher=vi.spyOn(globalThis,'fetch');
    const manager=new AccountManager({url:'https://different.example'},store,async()=>{});
    expect((await manager.state()).account).toBeNull();
    await expect(manager.accessToken()).rejects.toThrow('Please sign in');expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not restore an old session when refresh completes after sign-out and a server change',async()=>{
    const store=storage();await store.setItem('github-app-session',JSON.stringify({...session,expiresAt:0}));
    let finish:(value:Response)=>void=()=>{};
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(url=>urlText(url).endsWith('/refresh')?new Promise<Response>(resolve=>{finish=resolve;}):json({ok:true}));
    const manager=new AccountManager({url:session.backendUrl},store,async()=>{});
    const pending=manager.accessToken();const rejected=expect(pending).rejects.toThrow('Session changed');
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalled());await manager.signOut();await manager.configure('https://different.example');
    finish(new Response(JSON.stringify(session)));await rejected;expect((await manager.state()).account).toBeNull();
  });
});
