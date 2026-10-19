import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AccountState, Account } from '@easy-latex/shared-types';
import type { SecureSessionStorage } from './SecureSessionStorage';
import { normalizeApiUrl } from './ApiConfiguration';
interface Session {token:string;refreshToken:string;expiresAt:number;account:Account;backendUrl:string;}
export interface AccountConfig {url?:string|undefined;}
/** Only the main process sees app credentials. GitHub secrets never ship in desktop. */
export class AccountManager {
  private pending:(()=>void)|null=null;
  private refreshing:Promise<Session>|null=null;
  private generation=0;
  constructor(private readonly configuration:AccountConfig,private readonly storage:SecureSessionStorage,private readonly openBrowser:(url:string)=>Promise<void>) {
    configuration.url=normalizeApiUrl(configuration.url??'');
  }
  async configure(url:string):Promise<void>{if((await this.state()).account)throw new Error('Sign out before changing the collaboration server');await this.cancel();this.configuration.url=normalizeApiUrl(url);}
  private async request<T>(route:string,body:unknown,token?:string,backendUrl=this.configuration.url):Promise<T>{
    if(!backendUrl)throw new Error('GitHub collaboration is not configured. See docs/COLLABORATION.md.');
    const r=await fetch(`${backendUrl.replace(/\/$/,'')}${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(25_000)});
    const value=await r.json() as {message?:string};if(!r.ok)throw new Error(value.message||'GitHub sign-in failed');return value as T;
  }
  private async session():Promise<Session|null>{const value=await this.storage.getItem('github-app-session');const session=value?JSON.parse(value) as Session:null;return session?.backendUrl===this.configuration.url?session:null;}
  async state():Promise<AccountState>{
    const s=await this.session();return {configured:Boolean(this.configuration.url),apiUrl:this.configuration.url??'',sessionPersistence:this.storage.persistent()?'secure':'memory',googleEnabled:false,recovery:false,account:s?.account??null};
  }
  async accessToken(expectedUrl=this.configuration.url):Promise<string>{
    if(expectedUrl!==this.configuration.url)throw new Error('Collaboration server changed. Sign in again.');
    let s=await this.session();if(!s)throw new Error('Please sign in with GitHub');
    const backendUrl=this.configuration.url!,generation=this.generation;
    if(s.expiresAt<Date.now()+60_000){
      if(!this.refreshing)this.refreshing=this.request<Session>('/auth/refresh',{refreshToken:s.refreshToken},undefined,backendUrl).then(async next=>{if(generation!==this.generation)throw new Error('Session changed');const scoped={...next,backendUrl};await this.storage.setItem('github-app-session',JSON.stringify(scoped));return scoped;}).finally(()=>{this.refreshing=null;});
      s=await this.refreshing;
    }
    if(generation!==this.generation||s.backendUrl!==expectedUrl)throw new Error('Session changed. Sign in again.');
    return s.token;
  }
  async installation():Promise<void>{
    const backendUrl=this.configuration.url;
    const v=await this.request<{installed:boolean;url:string}>('/auth/github/install',{},await this.accessToken(backendUrl),backendUrl);
    if(!v.installed){await this.openInstallation(v.url);throw new Error('Finish installing the GitHub App in your browser, then Continue with GitHub or retry Collaborate.');}
  }
  async openInstallation(url:string):Promise<void>{const u=new URL(url);if(u.origin!=='https://github.com'||!/^\/apps\/[^/]+\/installations\/new$|^\/settings\/installations\/\d+$/.test(u.pathname))throw new Error('Unexpected installation address');await this.openBrowser(url);}
  cancel():Promise<void>{this.generation++;this.pending?.();return Promise.resolve();}
  async signOut():Promise<void>{const backendUrl=this.configuration.url;await this.cancel();const s=await this.session();await this.storage.clear();if(s)await this.request('/auth/logout',{refreshToken:s.refreshToken},undefined,backendUrl).catch(()=>undefined);}
  async github():Promise<AccountState>{
    if(!this.configuration.url)throw new Error('GitHub collaboration is not configured. Set the collaboration server first.');
    if(this.pending)throw new Error('A sign-in request is already open');
    const backendUrl=this.configuration.url,generation=this.generation;
    const callbackPath=`/auth/callback/${randomBytes(24).toString('hex')}`;
    const verifier=randomBytes(32).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url');
    let expectedState='';let callbackUrl='';let consumed=false;let settled=false;
    const timeout={timer:undefined as ReturnType<typeof setTimeout>|undefined};
    let finish:(e?:Error)=>void=()=>{};
    const completed=new Promise<void>((resolve,reject)=>{finish=e=>{if(settled)return;settled=true;if(timeout.timer)clearTimeout(timeout.timer);this.pending=null;server.close();if(e)reject(e);else resolve();};});
    void completed.catch(()=>undefined);
    const server=createServer((request,response)=>{
      const u=new URL(request.url??'/',callbackUrl||'http://127.0.0.1');
      if(request.method!=='GET'||u.pathname!==callbackPath){response.writeHead(404).end();return;}
      response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
      if(!expectedState||u.searchParams.get('state')!==expectedState){response.writeHead(400).end('Invalid sign-in state.');return;}
      if(consumed){response.writeHead(409).end();return;}consumed=true;
      const code=u.searchParams.get('code');if(!code||code.length>128){response.writeHead(400).end();finish(new Error('GitHub sign-in failed'));return;}
      void this.request<Session>('/auth/github/exchange',{state:expectedState,code,verifier},undefined,backendUrl).then(async session=>{
        if(settled||generation!==this.generation)throw new Error('Sign-in cancelled');
        await this.storage.setItem('github-app-session',JSON.stringify({...session,backendUrl}));response.end('Signed in. Return to Easy LaTeX.');finish();
      }).catch(()=>{response.writeHead(400).end('Sign-in failed.');finish(new Error('GitHub sign-in could not be verified'));});
    });
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();if(!address||typeof address==='string')throw new Error('Could not open sign-in callback');
    callbackUrl=`http://127.0.0.1:${address.port}${callbackPath}`;
    this.pending=()=>finish(new Error('Sign-in cancelled'));timeout.timer=setTimeout(()=>finish(new Error('Sign-in timed out')),300_000);
    try{
      const start=await this.request<{url:string;state:string}>('/auth/github/start',{returnUrl:callbackUrl,challenge},undefined,backendUrl);
      const target=new URL(start.url);if(target.origin!=='https://github.com'||target.pathname!=='/login/oauth/authorize'||target.searchParams.get('state')!==start.state)throw new Error('Unexpected authorization address');
      expectedState=start.state;await this.openBrowser(start.url);await completed;await this.installation();return this.state();
    }catch(e){finish(e instanceof Error?e:new Error('Sign-in failed'));throw e;}
  }
}
