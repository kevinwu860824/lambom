-- Machines now come from this project's existing group/machine system
-- (useEmployeeGroup's allowedMachines, backed by bom_machines/group_machines)
-- instead of a separately-maintained table — drop the tables that only
-- existed to let this tool manage its own machine list.
drop table if exists inv_predefined_codes;
drop table if exists inv_logs;
drop table if exists inv_machines;

-- Links a real machine_name to a model, so the "pick a part" dropdown can
-- still look up that model's BOM list (inv_machine_models.bom_data).
create table if not exists inv_machine_model_links (
  machine_name text primary key,
  model_id bigint not null references inv_machine_models(id) on delete cascade
);
alter table inv_machine_model_links disable row level security;

-- Recreated keyed by machine_name (text, matching key_parts.machine_name's
-- existing convention elsewhere in this project) instead of a FK to the
-- now-removed inv_machines table.
create table if not exists inv_logs (
  id bigint generated always as identity primary key,
  machine_name text not null,
  part_name text not null,
  status text not null default 'missing'
    check (status in ('missing','ordered','arrived','picked_up','completed','loaned','returned')),
  is_loan boolean not null default false,
  borrower text,
  reporter_employee_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inv_logs_machine_name_idx on inv_logs(machine_name);
alter table inv_logs disable row level security;
