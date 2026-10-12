-- Backs the new "Stock" tab on /inventory — a simple on-hand parts list,
-- separate from inv_logs (which tracks missing/loan *requests*, not actual
-- stock levels). Global rather than per-machine: many spare parts (screws,
-- cables, etc.) are shared across machines rather than belonging to one, so
-- a machine-scoped stock table would force an artificial choice for those.
-- One row per part_no — editing re-saves the same row via upsert rather
-- than accumulating duplicate rows for the same part.
create table if not exists inv_stock (
  id bigint generated always as identity primary key,
  part_no text not null unique,
  description text,
  qty integer not null default 0,
  note text,
  updated_at timestamptz not null default now()
);
alter table inv_stock disable row level security;
