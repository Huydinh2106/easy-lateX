-- Preserve empty folders independently of source files.
create table collaboration.directories (
  project_id uuid not null references collaboration.projects(id) on delete cascade,
  path text not null,
  primary key (project_id, path)
);
revoke all on collaboration.directories from public, anon, authenticated;
