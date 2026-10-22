import { createSign, createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApiError } from './store';
export interface GitHubConfig { clientId: string; clientSecret: string; callbackUrl: string; appId: string; privateKey: string; slug: string; encryptionKey: string; webhookSecret: string; }
export interface GitHubUser { id:number; login:string; name:string|null; }
export interface Repository { id:number; name:string; owner:{id:number;login:string;type:string}; private:boolean; default_branch:string; description:string|null; permissions?:{pull:boolean;push:boolean;admin:boolean}; }
export interface GitHubCredentials { access_token:string; refresh_token?:string; expires_in?:number; expiresAt?:number; }
export interface TreeEntry { path:string; sha:string; type:string; mode:string; size?:number; }
export const hash = (value:string) => createHash('sha256').update(value).digest('hex');
export class SecretBox {
  private readonly key:Buffer;
  constructor(key:string) { this.key=Buffer.from(key,'base64');if(this.key.length!==32)throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 encoded'); }
  seal(value:unknown):string {const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',this.key,iv);const bytes=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
  open<T>(value:string):T {const b=Buffer.from(value,'base64');const d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString()) as T;}
}
export class GitHubError extends ApiError {constructor(status:number,message:string,public readonly emptyRepository=false){super(status,message);}}
export class GitHub {
  constructor(public readonly config:GitHubConfig, private readonly transport:typeof fetch=fetch) {}
  async api<T>(token:string,route:string,method='GET',body?:unknown):Promise<T> {
    if(!route.startsWith('/')||route.startsWith('//'))throw new Error('Invalid GitHub route');
    let r:Response;
    try {r=await this.transport(`https://api.github.com${route}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20_000)});}
    catch {throw new ApiError(503,'GitHub could not be reached. Retry; your draft is preserved.');}
    if(!r.ok){
      let empty=false;
      try{const body=await r.json() as {message?:string};empty=typeof body.message==='string'&&/git repository is empty/i.test(body.message);}catch{/* Error bodies need not be JSON. */}
      throw new GitHubError(r.status===401?401:r.status===404?404:r.status===409||r.status===422?409:r.status===403?403:503,r.status===401?'GitHub authorization expired or was revoked. Continue with GitHub again.':r.status===404?'Repository unavailable. Restore access or install the GitHub App for this repository.':r.status===422?'GitHub rejected this operation. A repository name may already be in use.':'GitHub permission or service unavailable. Check the app installation and retry.',empty);
    }
    return (r.status===204?undefined:await r.json()) as T;
  }
  async oauth(body:Record<string,string>):Promise<GitHubCredentials> {
    const r=await this.transport('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({...body,client_id:this.config.clientId,client_secret:this.config.clientSecret}),signal:AbortSignal.timeout(20_000)});
    const value=await r.json() as GitHubCredentials&{error?:string};
    if(!r.ok||value.error||!value.access_token)throw new ApiError(401,'GitHub authorization expired or was revoked. Continue with GitHub again.');
    return {...value,expiresAt:Date.now()+(value.expires_in??28800)*1000};
  }
  user(token:string):Promise<GitHubUser> {return this.api(token,'/user');}
  installationUrl():string {return `https://github.com/apps/${encodeURIComponent(this.config.slug)}/installations/new`;}
  async installations(token:string):Promise<void> {
    const v=await this.api<{installations:{app_id:number;suspended_at:string|null}[]}>(token,'/user/installations?per_page=100');
    if(!v.installations.some(i=>String(i.app_id)===this.config.appId&&!i.suspended_at))throw new ApiError(428,'Install the Easy LaTeX GitHub App, select the project repositories, then continue.');
  }
  async repo(token:string,id:number):Promise<Repository> {return this.api(token,`/repositories/${id}`);}
  route(repo:Repository):string {return `/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`;}
  async head(token:string,repo:Repository,branch:string):Promise<string|null> {
    try {return (await this.api<{object:{sha:string}}>(token,`${this.route(repo)}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;}
    catch(e) {if(e instanceof GitHubError&&e.emptyRepository)return null;if(e instanceof ApiError&&e.statusCode===404){const refs=await this.api<unknown[]>(token,`${this.route(repo)}/git/matching-refs/heads/`);if(!refs.length)return null;}throw e;}
  }
  async tree(token:string,repo:Repository,sha:string|null):Promise<TreeEntry[]> {
    if(!sha)return [];
    const tree=await this.api<{tree:TreeEntry[];truncated:boolean}>(token,`${this.route(repo)}/git/trees/${sha}?recursive=1`);
    if(tree.truncated||tree.tree.length>10000)throw new ApiError(409,'Repository tree is too large for safe synchronization');
    return tree.tree.filter(e=>e.type==='blob');
  }
  async isAncestor(token:string,repo:Repository,ancestor:string,head:string):Promise<boolean>{
    const pending=[head],seen=new Set<string>();
    while(pending.length){const current=pending.shift()!;if(current===ancestor)return true;if(seen.has(current))continue;
      if(seen.size>=256)throw new ApiError(409,'Publication recovery history is too deep for automatic verification');seen.add(current);
      const commit=await this.api<{parents:{sha:string}[]}>(token,`${this.route(repo)}/git/commits/${current}`);
      for(const parent of commit.parents)if(!seen.has(parent.sha))pending.push(parent.sha);
    }return false;
  }
  async gitToken(repo:Repository,write:boolean):Promise<{token:string;expires_at:string}> {
    const now=Math.floor(Date.now()/1000);const b=(o:unknown)=>Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned=`${b({alg:'RS256',typ:'JWT'})}.${b({iat:now-60,exp:now+540,iss:this.config.appId})}`;
    const sign=createSign('RSA-SHA256');sign.update(unsigned);const jwt=`${unsigned}.${sign.sign(this.config.privateKey,'base64url')}`;
    const installation=await this.api<{id:number}>(jwt,`${this.route(repo)}/installation`);
    return this.api(jwt,`/app/installations/${installation.id}/access_tokens`,'POST',{repository_ids:[repo.id],permissions:{contents:write?'write':'read'}});
  }
}
