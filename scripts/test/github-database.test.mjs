import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, config } from '../lib/api-dependencies.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { migrateGitHubDatabase } from '../lib/github-database.mjs';

config({ path: ['.env.local', '.env'], quiet: true });
const adminUrl = process.env.GITHUB_MIGRATION_TEST_ADMIN_URL;

async function database(run) {
  const url = new URL(adminUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Use a local test server');
  const name = `easy_latex_migration_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url.href });
  let pool;
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.href });
    await run(pool);
  } finally {
    await pool?.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
}

async function migrate(pool) {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await migrateGitHubDatabase(db);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally { db.release(); }
}

test('fresh PostgreSQL starts without Supabase Auth/Storage and retains data on restart', { skip: !adminUrl }, async () => {
  await database(async pool => {
    await migrate(pool);
    assert.equal((await pool.query("select to_regclass('auth.users') as value")).rows[0].value, null);
    const user = randomUUID();
    await pool.query("insert into collaboration.profiles(id,email,display_name) values($1,'test@example.invalid','Test')", [user]);
    await Promise.all([migrate(pool), migrate(pool)]);
    assert.equal((await pool.query('select id from collaboration.profiles')).rows[0].id, user);
    assert.equal((await pool.query('select count(*)::int as count from collaboration.schema_migrations')).rows[0].count, 1);
    const rows = await pool.query("select table_name from information_schema.tables where table_schema='collaboration' and table_name in ('github_projects','github_handoffs','github_legacy_links')");
    assert.equal(rows.rowCount, 3);
  });
});

test('legacy Supabase schema is migrated without deleting profiles or projects', { skip: !adminUrl }, async () => {
  await database(async pool => {
    await pool.query('create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key,name text,public boolean)');
    const roles = (await pool.query("select rolname from pg_roles where rolname in ('anon','authenticated') order by rolname")).rows.map(row => row.rolname);
    for (const file of (await readdir('supabase/migrations')).filter(name => /^20261004.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
      await pool.query(sql.replaceAll('from public, anon, authenticated', `from ${['public', ...roles].join(', ')}`));
    }
    const user = randomUUID(), project = randomUUID();
    await pool.query('insert into auth.users values($1)', [user]);
    await pool.query("insert into collaboration.profiles values($1,'legacy@example.invalid','Legacy')", [user]);
    await pool.query("insert into collaboration.projects(id,name,owner_id) values($1,'Keep this project',$2)", [project, user]);
    await migrate(pool);
    await migrate(pool);
    assert.equal((await pool.query('select owner_id from collaboration.projects where id=$1', [project])).rows[0].owner_id, user);
  });
});

test('partial schema is rejected and left intact', { skip: !adminUrl }, async () => {
  await database(async pool => {
    await pool.query('create schema collaboration; create table collaboration.keep_me(value text); insert into collaboration.keep_me values(\'preserve\')');
    await assert.rejects(migrate(pool), /Incomplete collaboration schema/);
    assert.equal((await pool.query('select value from collaboration.keep_me')).rows[0].value, 'preserve');
    assert.equal((await pool.query("select to_regclass('collaboration.profiles') as value")).rows[0].value, null);
  });
});
