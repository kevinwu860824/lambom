-- Inventory IAM/storage-location fields and current-group global Full BOM search.
-- Run this once in Supabase before deploying the application code that calls the new RPC.
-- The trigram indexes cover the existing multi-million-row Full BOM table; run off-peak.

create extension if not exists pg_trgm;

create index if not exists full_bom_items_part_no_trgm_idx
  on public.full_bom_items using gin (part_no gin_trgm_ops);

create index if not exists full_bom_items_description_trgm_idx
  on public.full_bom_items using gin (description gin_trgm_ops);

create table if not exists public.inv_storage_locations (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (group_id, name),
  unique (group_id, id)
);
alter table public.inv_storage_locations disable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inv_storage_locations'::regclass
      and conname = 'inv_storage_locations_group_id_id_key'
  ) then
    alter table public.inv_storage_locations
      add constraint inv_storage_locations_group_id_id_key unique (group_id, id);
  end if;
end;
$$;

alter table public.inv_stock
  add column if not exists iam text,
  add column if not exists storage_location_id bigint;

alter table public.inv_logs
  add column if not exists iam text,
  add column if not exists storage_location_id bigint;

do $$
begin
  alter table public.inv_stock
    drop constraint if exists inv_stock_storage_location_id_fkey;
  alter table public.inv_logs
    drop constraint if exists inv_logs_storage_location_id_fkey;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inv_stock'::regclass
      and conname = 'inv_stock_group_location_fk'
  ) then
    alter table public.inv_stock
      add constraint inv_stock_group_location_fk
      foreign key (group_id, storage_location_id)
      references public.inv_storage_locations (group_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inv_logs'::regclass
      and conname = 'inv_logs_group_location_fk'
  ) then
    alter table public.inv_logs
      add constraint inv_logs_group_location_fk
      foreign key (group_id, storage_location_id)
      references public.inv_storage_locations (group_id, id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists inv_storage_locations_group_name_idx
  on public.inv_storage_locations (group_id, name);

create or replace function public.search_full_bom_items_in_machines(
  p_machine_names text[],
  p_query text,
  p_limit integer default 50
)
returns table (
  part_no text,
  description text,
  qty numeric,
  uom text,
  machine_count bigint,
  total_matches bigint
)
language sql
stable
as $$
  with matches as (
    select
      item.part_no,
      min(item.description) as description,
      null::numeric as qty,
      null::text as uom,
      count(distinct item.machine_name)::bigint as machine_count
    from public.full_bom_items item
    where cardinality(p_machine_names) > 0
      and item.machine_name = any(p_machine_names)
      and (
        item.part_no ilike '%' || p_query || '%'
        or item.description ilike '%' || p_query || '%'
      )
    group by item.part_no
  )
  select
    matches.part_no,
    matches.description,
    matches.qty,
    matches.uom,
    matches.machine_count,
    count(*) over() as total_matches
  from matches
  order by matches.part_no
  limit p_limit;
$$;