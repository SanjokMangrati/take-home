alter table file_reading add column reader_version integer not null default 1;
alter table file_reading alter column reader_version drop default;

alter table project
  add column scheduled_finish text check (scheduled_finish ~ '^\d{4}-\d{2}-\d{2}$'),
  add column must_finish_by text check (must_finish_by ~ '^\d{4}-\d{2}-\d{2}$');

alter table activity add column status text;

alter table relationship
  add column type text,
  add column lag_hours double precision;
