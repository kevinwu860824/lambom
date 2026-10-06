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
create or replace function search_full_bom_items(
  p_machine_name text,
  p_query text,
  p_limit int default 20
)
returns table (part_no text, description text, qty numeric, uom text)
language sql stable as $$
  select distinct on (part_no) part_no, description, qty, uom
  from full_bom_items
  where machine_name = p_machine_name
    and (part_no ilike '%' || p_query || '%' or description ilike '%' || p_query || '%')
  order by part_no, id
  limit p_limit;
$$;
