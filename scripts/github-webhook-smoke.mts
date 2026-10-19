import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { GitHub } from '../apps/api/src/github';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
config({path:[path.join(root,'.env.local'),path.join(root,'.env')],quiet:true});
if(!process.argv.includes('--live'))throw new Error('Requires permission for the existing synthetic smoke repository and --live.');
if(!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname))throw new Error('Webhook smoke requires the local test backend');
const reportPath=path.join(root,'.local/github-smoke/report.json');
const report=JSON.parse(await readFile(reportPath,'utf8'));
const repository=report.project?.repository;
if(report.status!=='passed'||!repository||repository.owner!==report.account||!/^easy-latex-smoke-test-[a-f0-9-]{36}$/.test(repository.name))throw new Error('A completed synthetic smoke report is required');
const github=new GitHub({appId:process.env.GITHUB_APP_ID!,clientId:process.env.GITHUB_CLIENT_ID!,clientSecret:process.env.GITHUB_CLIENT_SECRET!,slug:process.env.GITHUB_APP_SLUG!,callbackUrl:process.env.GITHUB_CALLBACK_URL!,encryptionKey:process.env.GITHUB_TOKEN_ENCRYPTION_KEY!,webhookSecret:process.env.GITHUB_WEBHOOK_SECRET!,privateKey:await readFile(process.env.GITHUB_PRIVATE_KEY_PATH!,'utf8')});
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
  const active=await pool.query('select 1 from collaboration.github_sessions s join collaboration.github_projects p on p.owner_id=s.user_id where p.id=$1 and not s.revoked and s.expires_at>now()',[report.project.id]);
  if(active.rowCount)throw new Error('Sign out the smoke account before testing installation-only webhook handling');
  const candidate={...repository,owner:{login:repository.owner}};
  const {token}=await github.gitToken(candidate,true);
  const repo=await github.repo(token,repository.id);
  if(!repo.private||repo.name!==repository.name||repo.owner.login!==repository.owner)throw new Error('Unexpected smoke repository');
  const route=`${github.route(repo)}/contents/main.tex`;
  const current=await github.api<{sha:string;content:string;encoding:string}>(token,`${route}?ref=${encodeURIComponent(repository.branch)}`);
  const source=Buffer.from(current.content,'base64').toString('utf8');
  if(!source.includes('synthetic GitHub smoke test'))throw new Error('Refusing to modify non-test source');
  const marker='% External webhook test after application sign-out.\n';
  const published=source.includes(marker)?null:await github.api<{commit:{sha:string}}>(token,route,'PUT',{message:'Test webhook synchronization after application sign-out',content:Buffer.from(source+marker).toString('base64'),sha:current.sha,branch:repository.branch});
  const head=published?.commit.sha??await github.head(token,repo,repository.branch);
  let confirmed=false;
  for(let attempt=0;attempt<30;attempt++){
    const row=(await pool.query('select head_sha from collaboration.github_projects where id=$1',[report.project.id])).rows[0];
    if(row?.head_sha===head){confirmed=true;break;}
    await setTimeout(1000);
  }
  if(!confirmed)throw new Error('External commit created but webhook did not reconcile it within 30 seconds; check webhook forwarding');
  report.checks.push('external GitHub commit reconciled by signed webhook after owner logout');report.webhookCommit=head;
  await writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});
  console.log('Passed: live signed webhook reconciles external GitHub edits without an owner login session.');
} finally {await pool.end();}
