import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { config, parse } from 'dotenv';
import { updateEnvironment } from './github-setup.mjs';
config({ path: ['.env.local', '.env'], quiet: true });
const google = false;
const file = 'supabase/config.toml';
writeFileSync(file, readFileSync(file, 'utf8').replace(/(\[auth\.external\.google\]\s*\n)enabled = (true|false)/, `$1enabled = ${google}`));
if (process.argv.includes('--configure-only')) process.exit(0);
const raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] });
const settings = JSON.parse(raw);
if (!settings.API_URL || !settings.ANON_KEY || !settings.DB_URL) throw new Error('Supabase is not running. Run npm run supabase:start first.');
// Preserve manually configured GitHub secrets and unrelated local settings.
let existing='';try{existing=readFileSync('.env.local','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
const additions={EASY_LATEX_API_URL:'http://127.0.0.1:4318',DATABASE_URL:settings.DB_URL,API_HOST:'127.0.0.1',API_PORT:'4318'};
if(process.argv.includes('--legacy')){
  const address=value=>{const url=new URL(value);return JSON.stringify([url.hostname,url.port,url.pathname]);};
  if(process.env.DATABASE_URL&&address(process.env.DATABASE_URL)!==address(settings.DB_URL))throw new Error('Legacy setup requires the same local Supabase database as DATABASE_URL');
  if(!settings.SERVICE_ROLE_KEY)throw new Error('Local Supabase service key is unavailable');
  Object.assign(additions,{LEGACY_SUPABASE_URL:settings.API_URL,LEGACY_SUPABASE_ANON_KEY:settings.ANON_KEY,LEGACY_SUPABASE_SERVICE_KEY:settings.SERVICE_ROLE_KEY});
}
for(const [key,value] of Object.entries(additions))if(!parse(existing)[key])existing=updateEnvironment(existing,{[key]:value});
writeFileSync('.env.local',`${existing.trim()}\n`,{mode:0o600});
console.log('Updated local database/API configuration without replacing existing GitHub settings. Configure the GitHub App using docs/COLLABORATION.md.');
