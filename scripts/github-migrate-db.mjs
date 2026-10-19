import { config } from 'dotenv';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
config({path:['.env.local','.env'],quiet:true});
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),db=await pool.connect();
try{
  await db.query('begin');
  await db.query("select pg_advisory_xact_lock(hashtextextended('easy-latex-schema',0))");
  await db.query('create table if not exists collaboration.schema_migrations(name text primary key, applied_at timestamptz not null default now())');
  const name='202610060001_github_coordination';
  if(!(await db.query('select 1 from collaboration.schema_migrations where name=$1',[name])).rowCount){if(!(await db.query("select to_regclass('collaboration.github_projects') as existing")).rows[0].existing)await db.query(await readFile(`supabase/migrations/${name}.sql`,'utf8'));await db.query('insert into collaboration.schema_migrations(name) values($1)',[name]);console.log('Applied additive GitHub coordination migration. Legacy content is retained.');}
  else console.log('GitHub coordination migration already applied.');
  await db.query('commit');
}catch(e){await db.query('rollback');throw e;}finally{db.release();await pool.end();}
