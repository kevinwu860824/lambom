-- Backs the "Stock" tab on /inventory — a simple on-hand parts list,
-- separate from inv_logs (which tracks missing/loan *requests*, not actual
-- stock levels).
--
-- machine_name: which machine's Full BOM this entry was looked up/added
-- against (same "" = not tied to a specific machine convention as
-- inv_logs.machine_name — see inventory-schema-v2.sql) — recorded so a
-- stock entry can show why/for-what it was stocked, not just discarded
-- after using it to drive the add form's autocomplete. A part can
-- legitimately be stocked under more than one machine context (e.g. the
-- same screw requested because of two different machines' orders), so the
-- unique key is (part_no, machine_name), not part_no alone — editing an
-- existing (part_no, machine_name) pair re-saves that same row.
--
-- Table was empty (feature just shipped, no real rows yet) when this
-- machine_name column was added, so this just redefines the table from
-- scratch instead of an in-place ALTER.
drop table if exists inv_stock;
create table if not exists inv_stock (
  id bigint generated always as identity primary key,
  part_no text not null,
  machine_name text not null default '',
  description text,
  qty integer not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  unique (part_no, machine_name)
);
alter table inv_stock disable row level security;
