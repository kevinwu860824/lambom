-- Passdown Tool schema (F22 VXT daily shift handover board).
-- Run this once in the Supabase SQL Editor before running migrate-passdown.ts
-- or using the /passdown pages.

create table if not exists passdown_people (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table passdown_people disable row level security;

create table if not exists passdown_entries (
  id bigint generated always as identity primary key,
  entry_date date not null,
  tool_id text not null,
  product text,
  module text not null,
  status text not null default 'other' check (status in ('up', 'down', 'monitor', 'other')),
  status_raw text,
  problem_statement text,
  remark text,
  updated_by_id bigint references passdown_people(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (entry_date, tool_id, module)
);

alter table passdown_entries disable row level security;

-- Serves the default "today's board" query (entry_date = today) and the
-- keyset-paginated history search (entry_date <, id <), same pattern as
-- full_bom_items/bom_items — see memory project_lambom_composite_index_pagination.
create index if not exists passdown_entries_date_id_idx on passdown_entries (entry_date, id);
create index if not exists passdown_entries_status_idx on passdown_entries (status, entry_date);

-- Append-only shift-update log. Each teammate's note is its own row, so two
-- people updating the same entry at the same time never overwrite each
-- other's text (unlike the old shared Excel cell).
create table if not exists passdown_updates (
  id bigint generated always as identity primary key,
  entry_id bigint not null references passdown_entries(id) on delete cascade,
  person_id bigint references passdown_people(id),
  shift text check (shift in ('day', 'night')),
  note text not null,
  created_at timestamptz not null default now()
);

alter table passdown_updates disable row level security;

create index if not exists passdown_updates_entry_created_idx on passdown_updates (entry_id, created_at);

-- Required for the live board's Supabase Realtime subscription to receive
-- INSERT/UPDATE events on these tables.
alter publication supabase_realtime add table passdown_entries;
alter publication supabase_realtime add table passdown_updates;
