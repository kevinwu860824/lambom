-- Machine groups (visibility by employee ID / 工號).
-- Run this once in the Supabase SQL Editor before using the /groups page
-- or the group filtering on /lambom, /full-bom, /tree, /zbom, /fingerprint,
-- /machines.

create table if not exists groups (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table groups disable row level security;

-- One row per employee ID; an employee belongs to exactly one group
-- (re-adding the same employee_id to a different group moves them, via
-- upsert on this primary key).
create table if not exists group_members (
  employee_id text primary key,
  group_id bigint not null references groups(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table group_members disable row level security;

-- Many-to-many: the same machine can belong to more than one group, since a
-- machine's group membership is granted by whoever downloads it — if group B
-- wants access to a machine group A already has, someone in B just re-runs
-- the SAP download under their own employee ID and gets their own row here.
create table if not exists group_machines (
  group_id bigint not null references groups(id) on delete cascade,
  machine_name text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, machine_name)
);

create index if not exists group_machines_machine_name_idx on group_machines (machine_name);

alter table group_machines disable row level security;
