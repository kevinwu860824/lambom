create table if not exists inv_machine_models (
  id bigint generated always as identity primary key,
  name text not null unique,
  bom_data text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists inv_predefined_codes (
  id bigint generated always as identity primary key,
  model_id bigint not null references inv_machine_models(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

create table if not exists inv_machines (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  model_id bigint references inv_machine_models(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists inv_logs (
  id bigint generated always as identity primary key,
  machine_id bigint not null references inv_machines(id) on delete cascade,
  part_name text not null,
  status text not null default 'missing'
    check (status in ('missing','ordered','arrived','picked_up','completed','loaned','returned')),
  is_loan boolean not null default false,
  borrower text,
  reporter_employee_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inv_logs_machine_id_idx on inv_logs(machine_id);
create index if not exists inv_predefined_codes_model_id_idx on inv_predefined_codes(model_id);

-- New Supabase tables default to RLS enabled, which blocks every request
-- under the anon key this project uses — matching the rest of lambom
-- (no RLS, anon key, app-layer trust only), not the real-auth + RLS model
-- the original inventory-manager app used.
alter table inv_machine_models disable row level security;
alter table inv_predefined_codes disable row level security;
alter table inv_machines disable row level security;
alter table inv_logs disable row level security;
