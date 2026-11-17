-- Per-group nicknames for a part_no, searchable alongside part_no/
-- description anywhere parts are searched (Inventory, Full BOM viewer,
-- LamBOM comparison). Scoped by group_id rather than shared company-wide:
-- a group that doesn't have a given part_no on any of its machines
-- shouldn't see an unrelated group's nickname for it show up as a match.
-- One name per (group, part_no) — re-saving the same pair overwrites it.
create table if not exists public.part_custom_names (
  group_id bigint not null references public.groups(id) on delete cascade,
  part_no text not null,
  custom_name text not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, part_no)
);
alter table public.part_custom_names disable row level security;

-- Both search RPCs below are drop+recreate because their return column
-- list changes (adding custom_name) — Postgres requires that whenever a
-- function's OUT columns change, even with create or replace.

drop function if exists search_full_bom_items(text, text, int);

create or replace function search_full_bom_items(
  p_machine_name text,
  p_query text,
  p_group_id bigint,
  p_limit int default 50
)
returns table (part_no text, description text, qty numeric, uom text, custom_name text, total_matches bigint)
language sql stable as $$
  with matches as (
    select distinct on (f.part_no) f.part_no, f.description, f.qty, f.uom, pcn.custom_name
    from full_bom_items f
    left join part_custom_names pcn
      on pcn.part_no = f.part_no and pcn.group_id = p_group_id
    where f.machine_name = p_machine_name
      and (
        f.part_no ilike '%' || p_query || '%'
        or f.description ilike '%' || p_query || '%'
        or pcn.custom_name ilike '%' || p_query || '%'
      )
    order by f.part_no, f.id
  )
  select part_no, description, qty, uom, custom_name, count(*) over() as total_matches
  from matches
  order by
    case when lower(part_no) = lower(p_query) then 0 else 1 end,
    part_no
  limit p_limit;
$$;

drop function if exists search_full_bom_items_in_machines(text[], text, int);

create or replace function search_full_bom_items_in_machines(
  p_machine_names text[],
  p_query text,
  p_group_id bigint,
  p_limit integer default 50
)
returns table (
  part_no text,
  description text,
  qty numeric,
  uom text,
  custom_name text,
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
      max(pcn.custom_name) as custom_name,
      count(distinct item.machine_name)::bigint as machine_count
    from public.full_bom_items item
    left join public.part_custom_names pcn
      on pcn.part_no = item.part_no and pcn.group_id = p_group_id
    where cardinality(p_machine_names) > 0
      and item.machine_name = any(p_machine_names)
      and (
        item.part_no ilike '%' || p_query || '%'
        or item.description ilike '%' || p_query || '%'
        or pcn.custom_name ilike '%' || p_query || '%'
      )
    group by item.part_no
  )
  select
    matches.part_no,
    matches.description,
    matches.qty,
    matches.uom,
    matches.custom_name,
    matches.machine_count,
    count(*) over() as total_matches
  from matches
  order by
    case when lower(matches.part_no) = lower(p_query) then 0 else 1 end,
    matches.part_no
  limit p_limit;
$$;
