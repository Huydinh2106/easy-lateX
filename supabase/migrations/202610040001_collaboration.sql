-- App data is private: all mutations pass through the authenticated backend.
create schema if not exists collaboration;
revoke all on schema collaboration from public, anon, authenticated;

create table collaboration.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null
);
create table collaboration.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references collaboration.profiles(id),
  created_at timestamptz not null default now()
);
create table collaboration.members (
  project_id uuid not null references collaboration.projects(id) on delete cascade,
  user_id uuid not null references collaboration.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (project_id, user_id)
);
create table collaboration.invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references collaboration.projects(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (project_id, email)
);
create table collaboration.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references collaboration.projects(id) on delete cascade,
  path text not null,
  content text not null default '',
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);
create table collaboration.leases (
  file_id uuid primary key references collaboration.files(id) on delete cascade,
  user_id uuid not null references collaboration.profiles(id),
  token uuid not null,
  expires_at timestamptz not null
);
create table collaboration.revisions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references collaboration.files(id) on delete cascade,
  version integer not null,
  content text not null,
  author_id uuid not null references collaboration.profiles(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (file_id, version),
  unique (author_id, request_id)
);
create table collaboration.git_jobs (
  id bigint generated always as identity primary key,
  project_id uuid not null references collaboration.projects(id) on delete cascade,
  snapshot jsonb not null,
  author_name text not null,
  author_email text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  commit_sha text,
  attempts integer not null default 0,
  last_error text
);
create index on collaboration.members(user_id);
create index on collaboration.invitations(email);
create index on collaboration.git_jobs(id) where completed_at is null;
create index on collaboration.revisions(file_id, version desc);

-- No client role may bypass lease checks through the Supabase Data API.
revoke all on all tables in schema collaboration from public, anon, authenticated;
revoke all on all sequences in schema collaboration from public, anon, authenticated;
alter default privileges in schema collaboration revoke all on tables from public, anon, authenticated;

insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do nothing;
