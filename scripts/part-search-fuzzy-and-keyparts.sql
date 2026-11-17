-- Two improvements to the Full BOM search RPCs (search_full_bom_items,
-- search_full_bom_items_in_machines), used by Inventory and indirectly by
-- the client-side search logic they share data shapes with:
--
-- 1. Whitespace/case-insensitive ("fuzzy") matching: "ATM Robot",
--    "atmrobot", and "ATMROBOT" should all find each other. Matching is
--    redone against lower(...) with all whitespace stripped
--    (regexp_replace(..., '\s+', '', 'g')) on both sides, instead of a
--    plain ILIKE. This needs its own expression indexes — the existing
--    plain-column trigram indexes (full_bom_items_part_no_trgm_idx /
--    _description_trgm_idx, from inventory-iam-location-global-search.sql)
--    can't accelerate a query filtering on a transformed expression, and
--    without an index this would reintroduce the exact full-table-scan
--    timeout risk those indexes were added to fix. Left the old plain
--    indexes in place rather than dropping them (harmless if unused).
--
-- 2. Fingerprint's "key part" names (key_parts.custom_name) now count as
--    another searchable alias too, alongside part_custom_names — a part
--    named via Fingerprint should be findable the same way a part_custom_names
--    nickname is, without merging the two tables (key_parts stays
--    Fingerprint/LamBOM-highlighting-specific; part_custom_names stays a
--    plain nickname with no other side effects). key_parts has no group_id,
--    so it's scoped by machine_name instead — bounded to the same
--    machine(s) already being searched, mirroring how full_bom_items
--    itself is scoped in the same query.
--
-- Run off-peak: building two GIN trigram indexes over full_bom_items'
-- several-million rows takes real time/resources.

create extension if not exists pg_trgm;

create index if not exists full_bom_items_part_no_norm_trgm_idx
  on public.full_bom_items using gin ((regexp_replace(lower(part_no), '\s+', '', 'g')) gin_trgm_ops);

create index if not exists full_bom_items_description_norm_trgm_idx
  on public.full_bom_items using gin ((regexp_replace(lower(coalesce(description, '')), '\s+', '', 'g')) gin_trgm_ops);

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
  matches as (
    select distinct on (f.part_no)
      f.part_no, f.description, f.qty, f.uom,
      pcn.custom_name,
      kp.custom_name as key_part_name
    from full_bom_items f
    left join part_custom_names pcn
      on pcn.part_no = f.part_no and pcn.group_id = p_group_id
    left join key_parts kp
      on kp.part_no = f.part_no and kp.machine_name = p_machine_name
    cross join norm
    where f.machine_name = p_machine_name
      and (
        regexp_replace(lower(f.part_no), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(f.description, '')), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(pcn.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(kp.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
      )
    order by f.part_no, f.id
  )
  select part_no, description, qty, uom, custom_name, key_part_name, count(*) over() as total_matches
  from matches
  order by
    case when lower(part_no) = lower(p_query) then 0 else 1 end,
    part_no
  limit p_limit;
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
  matches as (
    select
      item.part_no,
      min(item.description) as description,
      null::numeric as qty,
      null::text as uom,
      max(pcn.custom_name) as custom_name,
      max(kp.custom_name) as key_part_name,
      count(distinct item.machine_name)::bigint as machine_count
    from public.full_bom_items item
    left join public.part_custom_names pcn
      on pcn.part_no = item.part_no and pcn.group_id = p_group_id
    left join public.key_parts kp
      on kp.part_no = item.part_no and kp.machine_name = any(p_machine_names)
    cross join norm
    where cardinality(p_machine_names) > 0
      and item.machine_name = any(p_machine_names)
      and (
        regexp_replace(lower(item.part_no), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(item.description, '')), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(pcn.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
        or regexp_replace(lower(coalesce(kp.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
      )
    group by item.part_no
  )
  select
    matches.part_no,
    matches.description,
    matches.qty,
    matches.uom,
    matches.custom_name,
    matches.key_part_name,
    matches.machine_count,
    count(*) over() as total_matches
  from matches
  order by
    case when lower(matches.part_no) = lower(p_query) then 0 else 1 end,
    matches.part_no
  limit p_limit;
$$;
