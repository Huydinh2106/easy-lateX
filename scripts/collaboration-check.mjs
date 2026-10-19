import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { rm } from 'node:fs/promises';
import path from 'node:path';
config({path:['.env.local','.env'],quiet:true});
const url=process.env.EASY_LATEX_SUPABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1') throw new Error('This check only runs against local Supabase.');
const api=process.env.EASY_LATEX_API_URL;
const settings=JSON.parse(execFileSync('npx',['supabase','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
const admin=createClient(url,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[];let projectId;
function check(condition,message){if(!condition)throw new Error(message);}
async function otp(email,subject){
  for(let n=0;n<20;n++){
    const {messages}=await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json();
    const mail=messages?.find(m=>m.Subject.includes(subject)&&m.To?.some(to=>to.Address===email));
    if(mail){const body=await (await fetch(`http://127.0.0.1:54324/api/v1/message/${mail.ID}`)).json();const code=(body.Text??body.HTML??'').match(/\b(\d{6})\b/)?.[1];if(code)return code;}
    await new Promise(r=>setTimeout(r,200));
  }throw new Error('Local email code was not delivered.');
}
async function request(client,route,body){const token=(await client.auth.getSession()).data.session?.access_token;const response=await fetch(`${api}${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};}
try{
  const clients=[];
  for(const name of ['Alice','Bob']){
    const email=`easy-latex-check-${randomUUID()}@example.test`;const password=`Check-${randomUUID()}-aA9!`;const client=createClient(url,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const signup=await client.auth.signUp({email,password,options:{data:{full_name:name}}});check(!signup.error,signup.error?.message);users.push(signup.data.user.id);check(!signup.data.session,'Email confirmation was not required');
    const confirm=await client.auth.verifyOtp({email,token:await otp(email,'Confirm'),type:'signup'});check(!confirm.error,confirm.error?.message);
    clients.push({client,email,password});
  }
  console.log('PASS: signup and real local email confirmation for two accounts');
  const a=clients[0],b=clients[1];
  const recovery=await a.client.auth.resetPasswordForEmail(a.email);check(!recovery.error,recovery.error?.message);
  const verified=await a.client.auth.verifyOtp({email:a.email,token:await otp(a.email,'Reset'),type:'recovery'});check(!verified.error,verified.error?.message);
  const updatedPassword=`New-${randomUUID()}-aA9!`;const updated=await a.client.auth.updateUser({password:updatedPassword});check(!updated.error,updated.error?.message);await a.client.auth.signOut({scope:'local'});
  const signedIn=await a.client.auth.signInWithPassword({email:a.email,password:updatedPassword});check(!signedIn.error,signedIn.error?.message);
  console.log('PASS: password recovery, password change and sign-in');
  const activation={name:'End-to-end check',requestId:randomUUID()};
  const created=await request(a.client,'/projects',activation);check(created.status===200,JSON.stringify(created.value));projectId=created.value.id;
  const retry=await request(a.client,'/projects',activation);check(retry.status===200&&retry.value.id===projectId,'Activation retry created a duplicate project');
  console.log('PASS: repeated activation preserves one project identity through the running API');
  check((await request(a.client,`/projects/${projectId}/invitations`,{email:b.email,role:'editor'})).status===200,'Invitation failed');
  const invitations=await request(b.client,'/invitations');check(invitations.value.length===1,'Invitation not visible');check((await request(b.client,`/invitations/${invitations.value[0].id}/accept`,{})).status===200,'Accept failed');
  console.log('PASS: authenticated project creation and invitation acceptance');
  const files=await request(a.client,`/projects/${projectId}/files`);const file=files.value[0];
  const leases=await Promise.all([request(a.client,`/files/${file.id}/edit`,{}),request(b.client,`/files/${file.id}/edit`,{})]);check(leases.filter(l=>l.status===200).length===1&&leases.filter(l=>l.status===409).length===1,'Exclusive Edit violated');
  const winnerIndex=leases[0].status===200?0:1;const winner=clients[winnerIndex].client,other=clients[1-winnerIndex].client;
  const lease=leases[winnerIndex].value;const payload={token:lease.token,baseVersion:file.version,content:'\\documentclass{article}\n\\begin{document}\nShared version\n\\end{document}\n',requestId:randomUUID()};
  check((await request(winner,`/files/${file.id}/done`,payload)).status===200,'Done failed');check((await request(winner,`/files/${file.id}/done`,payload)).status===200,'Done retry failed');
  const latest=await request(other,`/projects/${projectId}/files`);check(latest.value[0].version===2&&!latest.value[0].editor,'Published version/lease invalid');check((await request(other,`/files/${file.id}/edit`,{})).status===200,'Edit handoff failed');
  console.log('PASS: concurrent Edit, Done retry and handoff through the running API');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try{for(let n=0;n<40;n++){const row=(await pool.query('select count(*)::int as count from collaboration.git_jobs where project_id=$1 and completed_at is null',[projectId])).rows[0];if(row.count===0)break;await new Promise(r=>setTimeout(r,250));}
    const jobs=(await pool.query('select commit_sha from collaboration.git_jobs where project_id=$1 order by id',[projectId])).rows;check(jobs.length===2&&jobs.every(j=>j.commit_sha),'History worker did not commit accepted versions');console.log('PASS: accepted versions written to Git by the running worker');
  }finally{await pool.end();}
  console.log('Google: configuration and callback tests are separate; real Google sign-in awaits your OAuth credentials.');
}finally{
  const pool=new Pool({connectionString:process.env.DATABASE_URL});try{if(projectId)await pool.query('delete from collaboration.projects where id=$1',[projectId]);}finally{await pool.end();}
  for(const id of users)await admin.auth.admin.deleteUser(id);
  if(projectId)await rm(path.join('.local','git',projectId),{recursive:true,force:true});
}
