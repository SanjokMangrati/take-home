create table uploaded_file (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (file_name <> ''),
  content bytea not null,
  sha256 bytea not null check (octet_length(sha256) = 32),
  uploaded_at timestamptz not null default now()
);

create index uploaded_file_sha256_idx on uploaded_file (sha256);

create table file_reading (
  file_id uuid primary key references uploaded_file (id) on delete cascade,
  outcome text not null check (outcome in ('parsed', 'rejected', 'needs-hours-per-day')),
  hours_per_day double precision check (hours_per_day > 0 and hours_per_day <= 24),
  p6_version text,
  notes jsonb,
  reason text,
  line integer check (line > 0),
  read_at timestamptz not null default now(),
  check (
    case outcome
      when 'parsed' then p6_version is not null and notes is not null and reason is null
      when 'rejected' then reason is not null
      when 'needs-hours-per-day' then line is not null
    end
  )
);

create table project (
  file_id uuid not null references file_reading (file_id) on delete cascade,
  line integer not null,
  project_id text not null,
  name text not null,
  data_date text check (data_date ~ '^\d{4}-\d{2}-\d{2}$'),
  primary key (file_id, line)
);

create table activity (
  file_id uuid not null references file_reading (file_id) on delete cascade,
  task_id text not null,
  line integer not null,
  project_id text not null,
  code text not null,
  name text not null,
  type text not null,
  checked boolean not null,
  calendar_id text not null,
  total_float_hours double precision,
  hours_per_day double precision,
  primary key (file_id, task_id)
);

create table relationship (
  file_id uuid not null references file_reading (file_id) on delete cascade,
  line integer not null,
  predecessor_task_id text not null,
  successor_task_id text not null,
  primary key (file_id, line)
);

create table broken_row (
  file_id uuid not null references file_reading (file_id) on delete cascade,
  line integer not null,
  table_name text,
  subject text,
  problems jsonb not null,
  effect jsonb not null,
  primary key (file_id, line)
);
