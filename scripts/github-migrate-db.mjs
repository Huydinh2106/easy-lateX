import { config } from 'dotenv';
import { Pool } from 'pg';
import { migrateGitHubDatabase } from './lib/github-database.mjs';
config({path:['.env.local','.env'],quiet:true});
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),db=await pool.connect();
try{
  await db.query('begin');
  await migrateGitHubDatabase(db);
  await db.query('commit');
  console.log('GitHub database is ready. Existing content is retained.');
}catch(e){await db.query('rollback');throw e;}finally{db.release();await pool.end();}
