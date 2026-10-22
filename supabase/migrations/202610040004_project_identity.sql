-- Enabling collaboration can be retried without creating another project.
alter table collaboration.projects add column creation_request_id uuid;
create unique index projects_creation_request on collaboration.projects(owner_id, creation_request_id)
where creation_request_id is not null;
