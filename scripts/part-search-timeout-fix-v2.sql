-- Follow-up to part-search-timeout-fix.sql: that fix (moving the key_parts/
-- part_custom_names match out of the main join) didn't actually resolve the
-- timeout — confirmed against real data that even an 8-character, highly
-- selective query ("atmrobot") still times out for the worst-case group.
-- That rules out "too many matching rows" as the cause: the real problem is
-- that this group's machine list covers ~100% of the system's machines, so
-- Postgres has no reason to use any index at all and falls back to a
-- sequential scan of the full several-million-row table — and evaluating
-- regexp_replace() on both part_no and description for every one of those
-- rows is simply more expensive per row than a plain ILIKE comparison,
-- regardless of the search text. Plain ILIKE alone was already borderline
-- for this case (~4s) before this feature existed; the added per-row
-- function-call cost is what pushes it over the timeout.
--
-- Fix: keep plain ILIKE (unchanged from before this feature, proven to at
-- least complete for the worst case) for the expensive full_bom_items
-- part_no/description match. Whitespace/case-insensitive normalization
-- stays only for part_custom_names and key_parts — both tiny tables where
-- the regexp_replace cost is negligible regardless of how many machines
-- are being searched. This keeps fuzzy matching working for nicknames and
-- key-part names (the actual motivating case — "ATM Robot" was found via
-- both of those, not via a BOM part_no/description with mixed casing or
-- stray whitespace) while dropping it only for raw BOM text, which rarely
-- has that kind of mismatch to begin with (part numbers and descriptions
-- are mostly structured codes/uppercase text).
--
-- The two expression trigram indexes from part-search-fuzzy-and-keyparts.sql
-- are no longer used by these functions; left in place since they're
-- harmless, not worth another migration just to drop them.

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
    from full_bom_items f
    where f.machine_name = p_machine_name
      and (
        f.part_no ilike '%' || p_query || '%'
        or f.description ilike '%' || p_query || '%'
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
    from public.full_bom_items item
    where cardinality(p_machine_names) > 0
      and item.machine_name = any(p_machine_names)
      and (
        item.part_no ilike '%' || p_query || '%'
        or item.description ilike '%' || p_query || '%'
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
