-- Fixes /inventory's Part Name autocomplete returning an apparently
-- incomplete suggestion list. The same part_no legitimately appears many
-- times in one machine's Full BOM (once per sub-assembly it's used under —
-- e.g. a common screw can show up 100+ times across a 20k-row tree). The
-- old plain `select ... ilike ... limit 20` had no de-duplication, so a
-- query matching that one screw could fill the entire 20-row limit with
-- repeats of it, crowding out every other genuinely different matching
-- part. Doing the DISTINCT in Postgres (same reasoning as
-- zbom-distinct-machines-schema.sql) keeps the response capped at
-- p_limit *distinct* parts instead of p_limit rows.
--
-- total_matches (added after the first version of this function): how many
-- distinct parts matched in total, attached to every returned row via
-- count(*) over() — computed over the full deduplicated match set, before
-- the final `limit p_limit` trims the rows actually sent back. Lets the UI
-- tell the user "there are more matches than shown, type more to narrow"
-- instead of silently truncating — verified against real data where a
-- machine had 23 distinct matches for "104" and the part the user wanted
-- sorted alphabetically just past the old limit of 20, with no indication
-- anything had been cut off.
drop function if exists search_full_bom_items(text, text, int);

create or replace function search_full_bom_items(
  p_machine_name text,
  p_query text,
  p_limit int default 50
)
returns table (part_no text, description text, qty numeric, uom text, total_matches bigint)
language sql stable as $$
  with matches as (
    select distinct on (part_no) part_no, description, qty, uom
    from full_bom_items
    where machine_name = p_machine_name
      and (part_no ilike '%' || p_query || '%' or description ilike '%' || p_query || '%')
    order by part_no, id
  )
  select part_no, description, qty, uom, count(*) over() as total_matches
  from matches
  order by part_no
  limit p_limit;
$$;
