-- Fast machine-name list for the ZBOM Viewer (/zbom). Run this once in the
-- Supabase SQL Editor before the fetchZbomMachineNames rewrite in lib/bom.ts
-- will work.
--
-- Why an RPC instead of a plain `select("machine_name")`: a plain select
-- over zbom_options returns every row, and Supabase/PostgREST caps rows
-- returned per request (project-level `db.max_rows`, commonly 1000). If a
-- single machine already has more option rows than that cap (the reference
-- machine alone had 378 — plausible to exceed 1000 for a bigger one), a
-- plain select can fill the entire response with just that one machine's
-- rows and silently never reach any other machine, alphabetically after it.
-- That's exactly the bug the old skip-scan (fetchDistinctMachineNames, one
-- request per distinct machine) was written to avoid — it was correct but
-- slow. Doing the DISTINCT in Postgres instead sidesteps the row cap
-- entirely (the response is only ever one row per machine, tens of rows
-- total) and is a single fast round trip.
create or replace function zbom_distinct_machine_names()
returns table (machine_name text)
language sql stable as $$
  select distinct machine_name from zbom_options order by machine_name;
$$;
