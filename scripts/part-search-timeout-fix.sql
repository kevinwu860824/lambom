-- Fixes "canceling statement due to statement timeout" on group-wide
-- search for a group whose machine list covers (or nearly covers) every
-- machine in the system — confirmed against real data: group "F22 CVD"
-- has 162 of the project's ~161-162 total distinct machines, so its
-- machine_name filter has essentially zero selectivity and forces a
-- sequential scan of all of full_bom_items (3M+ rows) no matter what.
-- That was already borderline (~4s) with a plain ILIKE before this
-- feature existed; LEFT JOINing key_parts (up to 7,311 rows matching this
-- group's machines) directly into the per-row scan — and re-evaluating it
-- for every one of those millions of rows via GROUP BY — pushed it over
-- the timeout.
--
-- Fix: key_parts and part_custom_names are tiny next to full_bom_items
-- (8,041 and a handful of rows respectively), so matching the typed query
-- against their names is cheap done on their own — the expensive full
-- full_bom_items scan only ever needs `part_no in (that small matching
-- set)`, a cheap semi-join, instead of a row-multiplying LEFT JOIN
-- evaluated across the entire scan. The actual custom_name/key_part_name
-- values for the response are then looked up only for the already-limited
-- (<= p_limit) result rows, where a per-row lookup is negligible — plus a
-- new index so that per-row key_parts lookup doesn't need to scan 8,041
-- rows each time.

create index if not exists key_parts_part_no_idx on public.key_parts(part_no);

drop function if exists search_full_bom_items(text, text, bigint, int);

create or replace function search_full_bom_items(
  p_machine_name text,
  p_query text,
  p_group_id bigint,
  p_limit int default 50
)
returns table (
  part_no text,
  description text,
  qty numeric,
  uom text,
  custom_name text,
  key_part_name text,
  total_matches bigint
)
language sql stable as $$
  with norm as (
    select regexp_replace(lower(p_query), '\s+', '', 'g') as q
  ),
  key_part_hits as (
    select distinct kp.part_no
    from key_parts kp, norm
    where kp.machine_name = p_machine_name
      and regexp_replace(lower(coalesce(kp.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
  ),
  custom_name_hits as (
    select pcn.part_no
    from part_custom_names pcn, norm
    where pcn.group_id = p_group_id
      and regexp_replace(lower(pcn.custom_name), '\s+', '', 'g') like '%' || norm.q || '%'
  ),
  matches as (
    select distinct on (f.part_no) f.part_no, f.description, f.qty, f.uom
    from full_bom_items f, norm
    where f.machine_name = p_machine_name
      and (
        regexp_replace(lower(f.part_no), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(f.description, '')), '\s+', '', 'g') like '%' || norm.q || '%'
        or f.part_no in (select part_no from key_part_hits)
        or f.part_no in (select part_no from custom_name_hits)
      )
    order by f.part_no, f.id
  ),
  limited as (
    select * from matches
    order by
      case when lower(part_no) = lower(p_query) then 0 else 1 end,
      part_no
    limit p_limit
  )
  select
    limited.part_no,
    limited.description,
    limited.qty,
    limited.uom,
    pcn2.custom_name,
    kp2.custom_name as key_part_name,
    (select count(*) from matches) as total_matches
  from limited
  left join part_custom_names pcn2
    on pcn2.part_no = limited.part_no and pcn2.group_id = p_group_id
  left join lateral (
    select kp.custom_name
    from key_parts kp
    where kp.part_no = limited.part_no and kp.machine_name = p_machine_name
    limit 1
  ) kp2 on true;
$$;

drop function if exists search_full_bom_items_in_machines(text[], text, bigint, int);

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
  key_part_name text,
  machine_count bigint,
  total_matches bigint
)
language sql
stable
as $$
  with norm as (
    select regexp_replace(lower(p_query), '\s+', '', 'g') as q
  ),
  key_part_hits as (
    select distinct kp.part_no
    from key_parts kp, norm
    where kp.machine_name = any(p_machine_names)
      and regexp_replace(lower(coalesce(kp.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
  ),
  custom_name_hits as (
    select pcn.part_no
    from part_custom_names pcn, norm
    where pcn.group_id = p_group_id
      and regexp_replace(lower(pcn.custom_name), '\s+', '', 'g') like '%' || norm.q || '%'
  ),
  matches as (
    select
      item.part_no,
      min(item.description) as description,
      count(distinct item.machine_name)::bigint as machine_count
    from public.full_bom_items item, norm
    where cardinality(p_machine_names) > 0
      and item.machine_name = any(p_machine_names)
      and (
        regexp_replace(lower(item.part_no), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(item.description, '')), '\s+', '', 'g') like '%' || norm.q || '%'
        or item.part_no in (select part_no from key_part_hits)
        or item.part_no in (select part_no from custom_name_hits)
      )
    group by item.part_no
  ),
  limited as (
    select * from matches
    order by
      case when lower(part_no) = lower(p_query) then 0 else 1 end,
      part_no
    limit p_limit
  )
  select
    limited.part_no,
    limited.description,
    null::numeric as qty,
    null::text as uom,
    pcn2.custom_name,
    kp2.custom_name as key_part_name,
    limited.machine_count,
    (select count(*) from matches) as total_matches
  from limited
  left join public.part_custom_names pcn2
    on pcn2.part_no = limited.part_no and pcn2.group_id = p_group_id
  left join lateral (
    select kp.custom_name
    from public.key_parts kp
    where kp.part_no = limited.part_no and kp.machine_name = any(p_machine_names)
    limit 1
  ) kp2 on true;
$$;
