import { readFile } from 'node:fs/promises';

/** Run inside a transaction. A shared lock makes concurrent startup migrations safe. */
export async function migrateGitHubDatabase(db) {
  await db.query("select pg_advisory_xact_lock(hashtextextended('easy-latex-schema',0))");
  await db.query('create schema if not exists collaboration');
  const profiles = (await db.query("select to_regclass('collaboration.profiles') as existing")).rows[0].existing;
  if (!profiles) {
    const tables = await db.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='collaboration' and c.relkind in ('r','p','v','m') limit 1");
    if (tables.rowCount) throw new Error('Incomplete collaboration schema. Restore the existing database before migrating.');
    await db.query(await readFile(new URL('../sql/github-base.sql', import.meta.url), 'utf8'));
  }
  await db.query('create table if not exists collaboration.schema_migrations(name text primary key, applied_at timestamptz not null default now())');
  const name = '202610060001_github_coordination';
  if ((await db.query('select 1 from collaboration.schema_migrations where name=$1', [name])).rowCount) return;
  if (!(await db.query("select to_regclass('collaboration.github_projects') as existing")).rows[0].existing) {
    // Plain PostgreSQL has no Supabase client roles. Revoke any that do exist,
    // without requiring cluster-level CREATE ROLE permission on cloud databases.
    const roles = await db.query("select rolname from pg_roles where rolname in ('anon','authenticated') order by rolname");
    const grantees = ['public', ...roles.rows.map(row => row.rolname)].join(', ');
    const sql = await readFile(new URL('../../supabase/migrations/202610060001_github_coordination.sql', import.meta.url), 'utf8');
    await db.query(sql.replaceAll('from public, anon, authenticated', `from ${grantees}`));
  }
  await db.query('insert into collaboration.schema_migrations(name) values($1)', [name]);
}
