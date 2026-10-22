import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Account } from '@easy-latex/shared-types';
import { ApiError } from './store';
import { type GitHub, SecretBox, hash, type GitHubCredentials } from './github';
const random=()=>randomBytes(32).toString('base64url');
const challenge=(v:string)=>createHash('sha256').update(v).digest('base64url');
export class GitHubAuth {
  readonly box:SecretBox;
  constructor(public readonly pool:Pool,public readonly github:GitHub) {this.box=new SecretBox(github.config.encryptionKey);}
  async credentials(userId:string):Promise<string> {
    // A session advisory lock serializes token rotation across API instances, without an open transaction.
    const db=await this.pool.connect();
    try {
      await db.query('select pg_advisory_lock(hashtextextended($1,0))',[`github-auth:${userId}`]);
      const row=(await db.query<{token_hash:string;credentials:string}>(`select token_hash,credentials from collaboration.github_sessions where user_id=$1 and not revoked and expires_at>now() order by expires_at desc limit 1`,[userId])).rows[0];
      if(!row)throw new ApiError(401,'Please sign in with GitHub');
      let value=this.box.open<GitHubCredentials>(row.credentials);
      if((value.expiresAt??0)<Date.now()+60_000){
        if(!value.refresh_token)throw new ApiError(401,'GitHub authorization expired. Continue with GitHub again.');
        try {value=await this.github.oauth({grant_type:'refresh_token',refresh_token:value.refresh_token});}
        catch(e){await db.query('update collaboration.github_sessions set revoked=true where user_id=$1',[userId]);throw e;}
        await db.query('update collaboration.github_sessions set credentials=$2 where token_hash=$1',[row.token_hash,this.box.seal(value)]);
      }
      return value.access_token;
    } finally {await db.query('select pg_advisory_unlock(hashtextextended($1,0))',[`github-auth:${userId}`]).catch(()=>undefined);db.release();}
  }
  async verify(token:string):Promise<Account> {
    const row=(await this.pool.query<Account&{githubId:string}>(`select p.id,p.email,p.display_name as "displayName",p.github_id::text as "githubId",p.github_login as "githubLogin" from collaboration.github_sessions s join collaboration.profiles p on p.id=s.user_id where s.token_hash=$1 and not s.revoked and s.expires_at>now() and s.access_expires_at>now()`,[hash(token)])).rows[0];
    if(!row)throw new ApiError(401,'Application session expired. Continue with GitHub again.');
    try {const actual=await this.github.user(await this.credentials(row.id));if(String(actual.id)!==row.githubId)throw new ApiError(401,'GitHub identity changed');}
    catch(e){if(e instanceof ApiError&&e.statusCode===401)await this.pool.query('update collaboration.github_sessions set revoked=true where user_id=$1',[row.id]);throw e;}
    return row;
  }
  register(app:FastifyInstance):void {
    app.post('/auth/github/start',async request=>{
      const input=z.object({returnUrl:z.string().url(),challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(request.body);
      const u=new URL(input.returnUrl);
      if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.search||u.hash||!/^\/auth\/callback\/[a-f0-9]{48}$/.test(u.pathname))throw new ApiError(400,'Invalid desktop callback');
      const state=random();const verifier=random();
      await this.pool.query(`insert into collaboration.github_auth_flows values($1,$2,$3,$4,now()+interval '5 minutes',null)`,[hash(state),verifier,input.challenge,input.returnUrl]);
      const uauth=new URL('https://github.com/login/oauth/authorize');
      for(const [k,v] of Object.entries({client_id:this.github.config.clientId,redirect_uri:this.github.config.callbackUrl,state,code_challenge:challenge(verifier),code_challenge_method:'S256'}))uauth.searchParams.set(k,v);
      return {state,url:uauth.toString()};
    });
    app.get('/auth/github/callback',async(request,reply)=>{
      const {state,code}=z.object({state:z.string().min(32).max(128),code:z.string().min(1).max(4096)}).parse(request.query);
      const flow=(await this.pool.query<{verifier:string;return_url:string;desktop_challenge:string}>(`delete from collaboration.github_auth_flows where state_hash=$1 and expires_at>now() and result is null returning verifier,return_url,desktop_challenge`,[hash(state)])).rows[0];
      if(!flow)throw new ApiError(400,'Sign-in state expired or already consumed');
      const credentials=await this.github.oauth({code,redirect_uri:this.github.config.callbackUrl,code_verifier:flow.verifier});
      const user=await this.github.user(credentials.access_token);
      // Stable ID only. Never link a legacy profile merely because email matches.
      const account=(await this.pool.query<Account>(`insert into collaboration.profiles(id,email,display_name,github_id,github_login) values($1,$2,$3,$4,$5) on conflict(github_id) do update set github_login=excluded.github_login,display_name=excluded.display_name returning id,email,display_name as "displayName",github_id::text as "githubId",github_login as "githubLogin"`,[randomUUID(),`${user.id}+${user.login}@users.noreply.github.com`,user.name||user.login,user.id,user.login])).rows[0]!;
      const token=random(),refreshToken=random();const expiresAt=Date.now()+15*60_000;
      await this.pool.query(`insert into collaboration.github_sessions(token_hash,user_id,credentials,expires_at,refresh_hash,access_expires_at) values($1,$2,$3,now()+interval '30 days',$4,to_timestamp($5/1000.0))`,[hash(token),account.id,this.box.seal(credentials),hash(refreshToken),expiresAt]);
      const handoff=random();
      await this.pool.query(`insert into collaboration.github_handoffs(state_hash,challenge,code_hash,result,expires_at) values($1,$2,$3,$4,now()+interval '2 minutes')`,[hash(state),flow.desktop_challenge,hash(handoff),this.box.seal({token,refreshToken,expiresAt,account})]);
      const target=new URL(flow.return_url);target.searchParams.set('state',state);target.searchParams.set('code',handoff);
      return reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').redirect(target.toString());
    });
    app.post('/auth/github/exchange',async request=>{
      const v=z.object({state:z.string().max(128),code:z.string().max(128),verifier:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(request.body);
      const row=(await this.pool.query<{result:string}>(`delete from collaboration.github_handoffs where state_hash=$1 and code_hash=$2 and challenge=$3 and expires_at>now() and result is not null returning result`,[hash(v.state),hash(v.code),challenge(v.verifier)])).rows[0];
      if(!row)throw new ApiError(401,'Desktop sign-in proof failed');return this.box.open(row.result);
    });
    app.post('/auth/refresh',async request=>{
      const {refreshToken}=z.object({refreshToken:z.string().min(32).max(128)}).parse(request.body);
      const row=(await this.pool.query<{user_id:string}>(`select user_id from collaboration.github_sessions where refresh_hash=$1 and not revoked and expires_at>now()`,[hash(refreshToken)])).rows[0];
      if(!row)throw new ApiError(401,'Application session expired. Continue with GitHub again.');
      const githubUser=await this.github.user(await this.credentials(row.user_id));
      const profile=(await this.pool.query<Account&{githubId:string}>('select id,email,display_name as "displayName",github_id::text as "githubId",github_login as "githubLogin" from collaboration.profiles where id=$1',[row.user_id])).rows[0]!;
      if(profile.githubId!==String(githubUser.id))throw new ApiError(401,'GitHub identity changed');
      const token=random(),nextRefresh=random(),expiresAt=Date.now()+15*60_000;
      const changed=await this.pool.query(`update collaboration.github_sessions set token_hash=$2,refresh_hash=$3,access_expires_at=to_timestamp($4/1000.0) where refresh_hash=$1 and not revoked`,[hash(refreshToken),hash(token),hash(nextRefresh),expiresAt]);
      if(!changed.rowCount)throw new ApiError(401,'Session was already refreshed');
      return {token,refreshToken:nextRefresh,expiresAt,account:profile};
    });
    app.post('/auth/logout',async request=>{
      const {refreshToken}=z.object({refreshToken:z.string().max(128)}).parse(request.body);
      await this.pool.query('update collaboration.github_sessions set revoked=true where refresh_hash=$1',[hash(refreshToken)]);return {ok:true};
    });
    app.post('/auth/github/install',async request=>{
      const header=request.headers.authorization;
      if(!header?.startsWith('Bearer '))throw new ApiError(401,'Please sign in');
      const user=await this.verify(header.slice(7));
      try{await this.github.installations(await this.credentials(user.id));return {installed:true,url:this.github.installationUrl()};}
      catch(e){if(e instanceof ApiError&&e.statusCode===428)return {installed:false,url:this.github.installationUrl()};throw e;}
    });
  }
}
