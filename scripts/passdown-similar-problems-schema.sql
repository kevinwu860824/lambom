-- Fuzzy "similar historical problem" search for the Passdown Tool.
-- Run this once in the Supabase SQL Editor.

create extension if not exists pg_trgm;

create index if not exists passdown_entries_problem_trgm_idx
  on passdown_entries using gin (problem_statement gin_trgm_ops);

-- Trigram similarity search, ranked with same-tool_id matches first (a
-- recurring issue on the same machine is far more likely to be the same
-- root cause than a superficially similar one on a different machine),
-- then by similarity, then by recency. A Postgres function (not a plain
-- PostgREST query) because that ranking isn't expressible through the
-- normal table query interface.
create or replace function passdown_search_similar_problems(
  search_text text,
  p_tool_id text default null,
  p_limit int default 6
) returns table (
  id bigint,
  entry_date date,
  tool_id text,
  module text,
  problem_statement text,
  similarity real
) language sql stable as $$
  select id, entry_date, tool_id, module, problem_statement,
         similarity(problem_statement, search_text) as similarity
  from passdown_entries
  where problem_statement is not null
    and problem_statement % search_text
  order by (tool_id = p_tool_id) desc, similarity desc, entry_date desc
  limit p_limit;
$$;
