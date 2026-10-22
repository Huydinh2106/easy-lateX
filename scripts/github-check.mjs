import { config } from 'dotenv';
import { access } from 'node:fs/promises';
config({path:['.env.local','.env'],quiet:true});
const fields=['DATABASE_URL','GITHUB_APP_ID','GITHUB_APP_SLUG','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','GITHUB_CALLBACK_URL','GITHUB_TOKEN_ENCRYPTION_KEY','GITHUB_WEBHOOK_SECRET'];
const missing=fields.filter(k=>!process.env[k]);
if(!process.env.GITHUB_PRIVATE_KEY_PATH&&!process.env.GITHUB_PRIVATE_KEY_BASE64)missing.push('GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY_BASE64');
if(missing.length){console.error(`Missing configuration: ${missing.join(', ')}. See docs/COLLABORATION.md.`);process.exitCode=1;}
else{if(!process.env.GITHUB_PRIVATE_KEY_BASE64)await access(process.env.GITHUB_PRIVATE_KEY_PATH);if(Buffer.from(process.env.GITHUB_TOKEN_ENCRYPTION_KEY,'base64').length!==32)throw new Error('Token encryption key must decode to 32 bytes');const response=await fetch(`${process.env.EASY_LATEX_API_URL||'http://127.0.0.1:4318'}/health`);if(!response.ok||(await response.json()).collaboration!=='github')throw new Error('GitHub API is not running');console.log('Configuration and API health checked. This does not prove live OAuth or GitHub push; run the two-account checklist.');}
