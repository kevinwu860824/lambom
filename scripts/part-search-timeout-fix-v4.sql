-- v3 fixed the common case (broad/short queries like "104", "1", "ab" now
-- reliably complete in well under a second for the worst-case 162-machine
-- group) but a query that only matches via a nickname/key-part name with
-- very few true matches (e.g. "atmrobot", matching just 2 part numbers out
-- of millions of rows) still times out. The LIMIT 2000 cap in v3 only lets
-- Postgres stop scanning early when it actually *finds* 2000 matches —
-- when the true match count is tiny, it still has to scan the whole table
-- to confirm there's nothing more, which is the original problem again.
--
-- The likely reason exact-match-via-nickname is slow in particular: mixing
-- a cheap, highly-selective condition (part_no in a tiny exact set) into
-- the same OR chain as the broad ILIKE conditions seems to stop Postgres
-- from planning each independently — it has to find one strategy for the
-- whole OR, rather than using an efficient exact-match path for the
-- selective branch and a separate strategy for the pattern-match branch.
-- Splitting them into two independently-planned queries combined with
-- UNION ALL (instead of one OR) lets each get its own appropriate plan,
-- and a plain btree index on part_no (the trigram indexes only help
-- pattern/substring matching, not exact-value lookups) gives the
-- nickname-match branch a real index to use for that.
--
-- Note: measuring this change's real-world impact has been noisy — this
-- investigation involved a lot of rapid back-to-back test queries against
-- the live project, which may itself have caused some of the inconsistent
-- timings observed. The structural reasoning above holds regardless, but
-- this exact edge case (a group whose machine list covers virtually every
-- machine in the system, searched for a name that matches almost nothing)
-- is inherently a hard case to guarantee fast — if it's still occasionally
-- slow after this, that's a sign this specific scenario may need a
-- different approach entirely (e.g. a dedicated search index) rather than
-- further tuning this query shape.

create index if not exists full_bom_items_part_no_plain_idx on public.full_bom_items(part_no);

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
  name_hits as (
    select distinct part_no from (
      select kp.part_no
      from key_parts kp, norm
      where kp.machine_name = p_machine_name
        and regexp_replace(lower(coalesce(kp.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
      union all
      select pcn.part_no
      from part_custom_names pcn, norm
      where pcn.group_id = p_group_id
        and regexp_replace(lower(pcn.custom_name), '\s+', '', 'g') like '%' || norm.q || '%'
    ) hits
  ),
  candidates as (
    (
      select f.part_no, f.description, f.qty, f.uom, f.id
      from full_bom_items f
      where f.machine_name = p_machine_name
        and (f.part_no ilike '%' || p_query || '%' or f.description ilike '%' || p_query || '%')
      limit 2000
    )
    union all
    (
      select f.part_no, f.description, f.qty, f.uom, f.id
      from full_bom_items f
      where f.machine_name = p_machine_name
        and f.part_no in (select part_no from name_hits)
      limit 2000
    )
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
  name_hits as (
    select distinct part_no from (
      select kp.part_no
      from key_parts kp, norm
      where kp.machine_name = any(p_machine_names)
        and regexp_replace(lower(coalesce(kp.custom_name, '')), '\s+', '', 'g') like '%' || norm.q || '%'
      union all
      select pcn.part_no
      from part_custom_names pcn, norm
      where pcn.group_id = p_group_id
        and regexp_replace(lower(pcn.custom_name), '\s+', '', 'g') like '%' || norm.q || '%'
    ) hits
  ),
  candidates as (
    (
      select item.part_no, item.description, item.machine_name
      from public.full_bom_items item
      where cardinality(p_machine_names) > 0
        and item.machine_name = any(p_machine_names)
        and (item.part_no ilike '%' || p_query || '%' or item.description ilike '%' || p_query || '%')
      limit 2000
    )
    union all
    (
      select item.part_no, item.description, item.machine_name
      from public.full_bom_items item
      where cardinality(p_machine_names) > 0
        and item.machine_name = any(p_machine_names)
        and item.part_no in (select part_no from name_hits)
      limit 2000
    )
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
