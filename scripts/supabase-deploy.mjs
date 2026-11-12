import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { config, Pool } from './lib/api-dependencies.mjs';
import { createSupabasePoolConfig } from './lib/supabase-database.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
config({path: [path.join(root,'.local/supabase-cloud.env'),path.join(root,'.env.local')], quiet:true});
const cli = path.join(root,'node_modules/.bin/supabase');
async function run(command,args,label) {
  try { return await execute(command,args,{cwd:root,timeout:300_000,maxBuffer:8*1024*1024}); }
  catch { throw new Error(`${label} failed. Check CLI login and project access; no secret values were logged.`); }
}
async function initialize(projectRef) {
  if(!process.env.EASY_LATEX_CLOUD_DATABASE_URL)throw new Error('Set EASY_LATEX_CLOUD_DATABASE_URL privately for --initialize-db.');
  const ca=process.env.EASY_LATEX_SUPABASE_CA_CERT?await readFile(process.env.EASY_LATEX_SUPABASE_CA_CERT,'utf8'):undefined;
  const pool=new Pool(createSupabasePoolConfig(process.env.EASY_LATEX_CLOUD_DATABASE_URL,{projectRef,ca}));
  const db=await pool.connect();
  try {
    await db.query('begin');
    await db.query("select pg_advisory_xact_lock(hashtextextended('easy-latex-schema',0))");
    if((await db.query("select to_regclass('collaboration.files') as name")).rows[0].name)throw new Error('The application schema already exists. Deploy without --initialize-db.');
    for(const name of (await readdir(path.join(root,'supabase/migrations'))).filter(v=>v.endsWith('.sql')).sort()) {
      await db.query(await readFile(path.join(root,'supabase/migrations',name),'utf8'));
    }
    await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  finally{db.release();await pool.end();}
}
async function activate(baseUrl) {
  const filename=path.join(root,'.env.local');
  let content='';try{content=await readFile(filename,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const key of ['EASY_LATEX_API_URL','EASY_LATEX_RELEASE_API_URL']) {
    const line=`${key}=${baseUrl}`;const pattern=new RegExp(`^${key}=.*$`,'gm');
    content=pattern.test(content)?content.replace(pattern,()=>line):content+`${content.endsWith('\n')?'':'\n'}${line}\n`;
  }
  await writeFile(filename+'.tmp',content,{mode:0o600});await rename(filename+'.tmp',filename);
  await writeFile(path.join(root,'apps/desktop/resources/desktop-config.json'),JSON.stringify({apiUrl:baseUrl},null,2)+'\n');
}
async function main() {
  const {values}=parseArgs({options:{'project-ref':{type:'string'},'dry-run':{type:'boolean'},'initialize-db':{type:'boolean'},'activate-desktop':{type:'boolean'},help:{type:'boolean',short:'h'}}});
  if(values.help){console.log('Usage: npm run supabase:deploy -- --project-ref <ref> [--dry-run] [--initialize-db] [--activate-desktop]\nEmail/password authentication and project storage use the selected Supabase project. No GitHub configuration or uploaded application secrets are required.');return;}
  const ref=values['project-ref']??process.env.EASY_LATEX_SUPABASE_PROJECT_REF;
  if(!/^[a-z0-9]{20}$/.test(ref??''))throw new Error('Provide the selected 20-character Supabase --project-ref.');
  const baseUrl=`https://${ref}.supabase.co/functions/v1/easy-latex-api`;
  console.log(`API: ${baseUrl}`);
  if(values['dry-run']){console.log(`Plan: build email/password backend; ${values['initialize-db']?'initialize an absent application schema; ':''}deploy Edge Function; verify cloud health${values['activate-desktop']?'; activate desktop URL':''}. No cloud changes were made.`);return;}
  const response=await run(cli,['projects','list','--output','json'],'Project access check');
  const payload=JSON.parse(response.stdout);const projects=Array.isArray(payload)?payload:payload.projects;
  if(!projects?.some(project=>project.id===ref||project.ref===ref))throw new Error('The CLI account cannot access this project. Run npx supabase login.');
  await run(process.execPath,[path.join(root,'scripts/supabase-build.mjs')],'Edge build');
  if(values['initialize-db'])await initialize(ref);
  await run(cli,['functions','deploy','easy-latex-api','--project-ref',ref,'--use-api'],'Edge deployment');
  const healthResponse=await fetch(baseUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(30_000)});
  const health=await healthResponse.json();
  if(!healthResponse.ok||health.collaboration!=='supabase'||health.authentication!=='email'||health.database!=='ready')throw new Error('Cloud health failed; desktop configuration was not changed.');
  await mkdir(path.join(root,'.local'),{recursive:true,mode:0o700});
  await writeFile(path.join(root,'.local/supabase-cloud-deployment.json'),JSON.stringify({projectRef:ref,apiUrl:baseUrl,authentication:'email',storage:'supabase',verifiedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
  if(values['activate-desktop'])await activate(baseUrl);
  console.log('Supabase email backend and database are ready. Configure Auth redirects and SMTP as described in docs/SUPABASE_CLOUD.vi.md.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
