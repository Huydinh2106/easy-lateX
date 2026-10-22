import { config } from 'dotenv';
import { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { migrateGitHubDatabase } from './lib/github-database.mjs';
config({path:['.env.local','.env'],quiet:true});
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL to a local PostgreSQL admin connection. This test uses a disposable separate database.');
const source=new URL(process.env.DATABASE_URL);if(!['127.0.0.1','localhost'].includes(source.hostname))throw new Error('Integration tests require a local PostgreSQL server');
const name=`easy_latex_github_test_${Date.now()}`;
const admin=new Pool({connectionString:source.toString()});
await admin.query(`create database "${name}"`);
source.pathname=`/${name}`;const connectionString=source.toString();const pool=new Pool({connectionString});
try{
  if(process.argv.includes('--standalone')) {
    const db=await pool.connect();
    try{await db.query('begin');await migrateGitHubDatabase(db);await db.query('commit');}
    catch(error){await db.query('rollback');throw error;}
    finally{db.release();}
  } else {
    await pool.query('create schema auth; create table auth.users(id uuid primary key,email text); create schema storage; create table storage.buckets(id text primary key,name text,public boolean);');
    for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile(`supabase/migrations/${file}`,'utf8'));
  }
  await pool.end();
  const code=await new Promise(resolve=>{const child=spawn('npm',['run','test','--workspace','@easy-latex/api','--','test/github-integration.spec.ts'],{stdio:'inherit',env:{...process.env,GITHUB_INTEGRATION_DATABASE_URL:connectionString}});child.on('exit',resolve);});
  if(code!==0)process.exitCode=1;
}finally{await pool.end().catch(()=>{});await admin.query(`drop database "${name}" with (force)`);await admin.end();}
