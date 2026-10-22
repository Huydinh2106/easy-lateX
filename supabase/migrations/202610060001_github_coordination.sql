-- Additive migration. Legacy content, Storage and server Git are deliberately retained.
alter table collaboration.profiles drop constraint if exists profiles_id_fkey;
alter table collaboration.profiles add column github_id bigint unique;
alter table collaboration.profiles add column github_login text;
create table collaboration.github_auth_flows (
  state_hash text primary key, verifier text not null, desktop_challenge text not null,
  return_url text not null, expires_at timestamptz not null, result jsonb
);
create table collaboration.github_sessions (
  token_hash text primary key, user_id uuid not null references collaboration.profiles(id),
  credentials text not null, expires_at timestamptz not null, revoked boolean not null default false
);
create table collaboration.github_projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references collaboration.profiles(id),
  request_id uuid not null, name text not null, repo_id bigint unique, repo_owner text, repo_name text,
  branch text not null default 'main', head_sha text, status text not null default 'activating',
  legacy_project_id uuid unique references collaboration.projects(id), unique(owner_id,request_id)
);
create table collaboration.github_members (
  project_id uuid not null references collaboration.github_projects(id),
  user_id uuid not null references collaboration.profiles(id), role text not null check(role in ('owner','editor','viewer')),
  primary key(project_id,user_id)
);
create table collaboration.github_files (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references collaboration.github_projects(id),
  path text not null, blob_sha text not null, deleted boolean not null default false, version integer not null default 1,
  encoding text not null check(encoding in ('utf8','base64')), updated_at timestamptz not null default now(),
  unique(project_id,path)
);
create table collaboration.github_leases (
  file_id uuid primary key references collaboration.github_files(id), user_id uuid not null references collaboration.profiles(id),
  token uuid not null, blob_sha text not null, version integer not null, expires_at timestamptz not null
);
create table collaboration.github_publications (
  project_id uuid not null references collaboration.github_projects(id), request_id uuid not null,
  user_id uuid not null references collaboration.profiles(id), fingerprint text not null,
  base_sha text, commit_sha text, changes jsonb not null, lease_tokens jsonb not null,
  status text not null check(status in ('prepared','pushing','confirmed','aborted')),
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  primary key(project_id,request_id)
);
create unique index github_one_publication on collaboration.github_publications(project_id) where status in ('prepared','pushing');
create table collaboration.github_invitations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references collaboration.github_projects(id),
  github_id bigint not null, github_login text not null, github_invitation_id bigint,
  role text not null check(role in ('editor','viewer')), unique(project_id,github_id)
);
create table collaboration.github_migrations (
  legacy_project_id uuid primary key references collaboration.projects(id),
  project_id uuid not null references collaboration.github_projects(id), manifest jsonb not null,
  verified_sha text, limitations text not null, updated_at timestamptz not null default now()
);
revoke all on all tables in schema collaboration from public, anon, authenticated;
alter table collaboration.github_sessions add column refresh_hash text unique;
alter table collaboration.github_sessions add column access_expires_at timestamptz not null default now();
create table collaboration.github_handoffs (
  state_hash text primary key, challenge text not null, code_hash text not null,
  result text not null, expires_at timestamptz not null
);
revoke all on collaboration.github_handoffs from public, anon, authenticated;
-- Fence credentials issued for an uncertain push; an expired turn cannot race a later turn.
alter table collaboration.github_publications add column fence_until timestamptz;
create table collaboration.github_legacy_links (
  github_user_id uuid not null references collaboration.profiles(id),
  legacy_user_id uuid not null references collaboration.profiles(id),
  confirmed_at timestamptz not null default now(), primary key(github_user_id,legacy_user_id)
);
revoke all on collaboration.github_legacy_links from public, anon, authenticated;
