-- Real root cause of the timeout (v1/v2 didn't fix it — confirmed against
-- real data that even an 8-character, highly selective query still timed
-- out, which ruled out "too many matching rows" or "regexp_replace is
-- slow" as the cause):
--
-- The query needs total_matches (count(*) over()) AND an "exact match
-- first, then alphabetical" ORDER BY before LIMIT p_limit. Both of those
-- require Postgres to fully materialize and sort *every* row matching the
-- WHERE clause before it can return anything — LIMIT at the very end
-- doesn't help, because counting and sorting both need the complete set
-- first. For a group whose machine list covers ~100% of the system's
-- machines (confirmed: "F22 CVD" has 162 of ~162 total), the machine_name
-- filter has no selectivity at all, so "every row matching the WHERE
-- clause" can mean a large fraction of the several-million-row table,
-- regardless of how selective the search text itself is.
--
-- Fix: gather raw candidate rows with a bare LIMIT and no ORDER BY first
-- (confirmed against real data: a plain ilike + .limit(2000) fetch over
-- this exact worst-case group completes in 400-1600ms, because a LIMIT
-- without ORDER BY lets Postgres stop scanning as soon as it finds enough
-- matches, instead of finding all of them). Only the resulting
-- (<=2000-row) candidate set then gets deduped/sorted/counted — cheap
-- regardless of the true, uncapped match count.
--
-- Trade-off: for a search broad enough to have 2000+ raw matching rows
-- before client-side dedup (only plausible for very short/common queries
-- against a near-unfiltered machine list), results may not be the
-- true global top-p_limit in exact-match-then-alphabetical order, total_matches
-- may undercount, and search_full_bom_items_in_machines' machine_count may
-- undercount for a part that appears on many machines if not all of its
-- occurrences were scanned before hitting the cap. Accepted deliberately:
-- an approximate response beats a hard timeout failure, and normal
-- (non-worst-case) searches are entirely unaffected since they never get
-- near 2000 raw matches to begin with.

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
  candidates as (
    select f.part_no, f.description, f.qty, f.uom, f.id
    from full_bom_items f
    where f.machine_name = p_machine_name
      and (
        f.part_no ilike '%' || p_query || '%'
        or f.description ilike '%' || p_query || '%'
        or f.part_no in (select part_no from key_part_hits)
        or f.part_no in (select part_no from custom_name_hits)
      )
    limit 2000
  ),
  matches as (
    select distinct on (part_no) part_no, description, qty, uom
    from candidates
    order by part_no, id
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
  candidates as (
    select item.part_no, item.description, item.machine_name
    from public.full_bom_items item
    where cardinality(p_machine_names) > 0
      and item.machine_name = any(p_machine_names)
      and (
        item.part_no ilike '%' || p_query || '%'
        or item.description ilike '%' || p_query || '%'
        or item.part_no in (select part_no from key_part_hits)
        or item.part_no in (select part_no from custom_name_hits)
      )
    limit 2000
  ),
  matches as (
    select
      part_no,
      min(description) as description,
      count(distinct machine_name)::bigint as machine_count
    from candidates
    group by part_no
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
