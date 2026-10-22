alter table collaboration.files add column encoding text not null default 'utf8' check (encoding in ('utf8','base64'));
alter table collaboration.files add column size_bytes integer not null default 0;
update collaboration.files set size_bytes=octet_length(content);
alter table collaboration.revisions add column encoding text not null default 'utf8' check (encoding in ('utf8','base64'));
