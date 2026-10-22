-- Independent deployment/test queues share a database without consuming each other's jobs.
alter table collaboration.git_jobs add column queue text not null default 'default';
create index on collaboration.git_jobs(queue,id) where completed_at is null;
