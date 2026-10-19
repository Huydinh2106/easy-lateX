import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { GitHub, SecretBox } from '../src/github';
import { verifyPublication, validateGitPath } from '../src/github-store';
import type { PublishTicket } from '@easy-latex/shared-types';
const config={clientId:'id',clientSecret:'server-only',callbackUrl:'http://127.0.0.1/auth/github/callback',appId:'123',privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString(),slug:'easy-latex',encryptionKey:Buffer.alloc(32,7).toString('base64'),webhookSecret:'secret'};
describe('GitHub transport and publication verification',()=>{
  it('encrypts tokens with authentication and rejects ciphertext tampering',()=>{const box=new SecretBox(config.encryptionKey);const sealed=box.seal({access_token:'sensitive'});expect(sealed).not.toContain('sensitive');expect(box.open(sealed)).toEqual({access_token:'sensitive'});const bytes=Buffer.from(sealed,'base64');bytes[28]=bytes[28]!^1;expect(()=>box.open(bytes.toString('base64'))).toThrow();});
  it('limits installation Git credentials to one repository and the requested Contents permission',async()=>{
    const calls:{url:string;body:unknown}[]=[];
    const github=new GitHub(config,(url,options)=>{calls.push({url:typeof url==='string'?url:url instanceof URL?url.href:url.url,body:options?.body?JSON.parse(options.body as string) as unknown:null});return Promise.resolve(new Response(JSON.stringify(calls.length===1?{id:9}:{token:'scoped',expires_at:'later'}),{status:200}));});
    await github.gitToken({id:42,name:'paper',owner:{id:10,login:'alice',type:'User'},private:true,default_branch:'main',description:null},false);
    expect(calls[1]?.body).toEqual({repository_ids:[42],permissions:{contents:'read'}});expect(calls[0]?.url).toBe('https://api.github.com/repos/alice/paper/installation');
  });
  it('fails safely on GitHub token revocation and API timeout',async()=>{
    const github=new GitHub(config,()=>Promise.resolve(new Response('{}',{status:401})));await expect(github.user('revoked')).rejects.toMatchObject({statusCode:401});
    const offline=new GitHub(config,()=>Promise.reject(new Error('offline')));await expect(offline.user('token')).rejects.toMatchObject({statusCode:503});
  });
  it('recognizes the GitHub empty-repository conflict without treating unrelated errors as an empty head',async()=>{
    const repository={id:42,name:'paper',owner:{id:10,login:'alice',type:'User'},private:true,default_branch:'main',description:null};
    const empty=new GitHub(config,()=>Promise.resolve(new Response(JSON.stringify({message:'Git Repository is empty.'}),{status:409})));expect(await empty.head('token',repository,'main')).toBeNull();
    const conflict=new GitHub(config,()=>Promise.resolve(new Response(JSON.stringify({message:'Repository is unavailable'}),{status:409})));await expect(conflict.head('token',repository,'main')).rejects.toMatchObject({statusCode:409});
  });
  it('rejects extra paths, wrong parents, wrong request IDs and noncanonical file modes',()=>{
    const before=[{path:'main.tex',sha:'a'.repeat(40),type:'blob',mode:'100644'}];const after=[{...before[0]!,sha:'b'.repeat(40)}];
    const ticket:PublishTicket={projectId:'project',requestId:'request',baseSha:'1'.repeat(40),commitSha:'2'.repeat(40),status:'pushing',changes:[{path:'main.tex',blobSha:'b'.repeat(40),encoding:'utf8'}],expiresAt:'later'};
    const commit={sha:ticket.commitSha!,parents:[{sha:ticket.baseSha!}],message:'Publish\nEasy-LaTeX-Request: request'};
    expect(()=>verifyPublication(ticket,before,after,commit,ticket.commitSha)).not.toThrow();
    expect(()=>verifyPublication(ticket,before,[...after,{path:'other.tex',sha:'c'.repeat(40),type:'blob',mode:'100644'}],commit,ticket.commitSha)).toThrow();
    expect(()=>verifyPublication(ticket,before,after,{...commit,parents:[]},ticket.commitSha)).toThrow();
    expect(()=>verifyPublication(ticket,before,[{...after[0]!,mode:'120000'}],commit,ticket.commitSha)).toThrow();
    expect(()=>verifyPublication(ticket,before,after,{...commit,message:'wrong'},ticket.commitSha)).toThrow();
    for(const p of ['../secret.tex','.git/config.txt','build/main.pdf','secrets.txt','a\n.tex'])expect(()=>validateGitPath(p)).toThrow();
  });
});
