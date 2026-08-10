-- Fuzzy "similar historical problem" search for the Passdown Tool.
-- Run this once in the Supabase SQL Editor.
--
-- v2: strips list numbering ("1.", "2)", "1-1.", "a.", "-") from the start
-- of each line before comparing/grouping — real data showed ~40% of
-- Problem Statement text starts with this kind of numbering, which was
-- diluting trigram similarity and keeping otherwise-identical text (e.g.
-- "Alarm:\nP/V temperature drop." vs the same without the trailing period)
-- from being recognized as duplicates.

create extension if not exists pg_trgm;

-- Drop the v1 index (on the raw column) — superseded by the functional
-- index below, on the normalized expression the new RPCs actually filter by.
drop index if exists passdown_entries_problem_trgm_idx;

create or replace function passdown_normalize_problem(input text) returns text
language sql immutable as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(coalesce(input, '')),
              '(^|\n)[ \t]*\d+(-\d+)*[.):][ \t]*', E'\n', 'g'   -- "1.", "2)", "1-1.", "2-3."
            ),
            '(^|\n)[ \t]*[a-z][.)][ \t]*', E'\n', 'g'            -- "a.", "b)"
          ),
          '(^|\n)[ \t]*[-•][ \t]*', E'\n', 'g'                   -- "- " bullets
        ),
        '[.:]?\s+', ' ', 'g'                                     -- collapse whitespace, drop a period/colon right before it
      ),
      '[.:;,]+$', ''                                             -- drop trailing punctuation with nothing after it (e.g. a final ".")
    )
  );
$$;

create index if not exists passdown_entries_problem_norm_trgm_idx
  on passdown_entries using gin (passdown_normalize_problem(problem_statement) gin_trgm_ops);

-- Trigram similarity search over normalized text, grouped so near-duplicates
-- that only differ by numbering/punctuation/case collapse into one
-- suggestion (with how many times it's actually occurred) instead of
-- cluttering the list with what's functionally the same entry repeated.
-- Ranked with same-tool_id matches first (a recurring issue on the same
-- machine is far more likely to be the same root cause), then similarity,
-- then recency.
--
-- The v1 function had a different RETURNS TABLE shape (no occurrence_count),
-- and Postgres won't let CREATE OR REPLACE change that — drop it first.
drop function if exists passdown_search_similar_problems(text, text, integer);

create or replace function passdown_search_similar_problems(
  search_text text,
  p_tool_id text default null,
  p_limit int default 6
) returns table (
  id bigint,
  problem_statement text,
  occurrence_count int,
  entry_date date,
  tool_id text,
  module text,
  similarity real
) language sql stable as $$
  with matched as (
    select
      e.id,
      e.problem_statement,
      e.entry_date,
      e.tool_id,
      e.module,
      passdown_normalize_problem(e.problem_statement) as norm,
      similarity(passdown_normalize_problem(e.problem_statement), passdown_normalize_problem(search_text)) as sim
    from passdown_entries e
    where e.problem_statement is not null
      and passdown_normalize_problem(e.problem_statement) % passdown_normalize_problem(search_text)
  ),
  ranked as (
    select
      matched.*,
      row_number() over (
        partition by norm
        order by (tool_id = p_tool_id) desc, entry_date desc
      ) as rn,
      count(*) over (partition by norm) as cnt
    from matched
  )
  select id, problem_statement, cnt::int as occurrence_count, entry_date, tool_id, module, sim as similarity
  from ranked
  where rn = 1
  order by (tool_id = p_tool_id) desc, similarity desc, entry_date desc
  limit p_limit;
$$;

-- Every entry for one tool+module whose problem text normalizes the same as
-- the given text — used to build the "上次怎麼處理" history timeline so it
-- picks up the whole episode even across numbering/formatting variations,
-- not just rows with byte-identical problem_statement.
create or replace function passdown_entries_by_normalized_problem(
  p_tool_id text,
  p_module text,
  p_problem_statement text
) returns table (
  id bigint,
  entry_date date
) language sql stable as $$
  select id, entry_date
  from passdown_entries
  where tool_id = p_tool_id
    and module = p_module
    and passdown_normalize_problem(problem_statement) = passdown_normalize_problem(p_problem_statement)
  order by entry_date asc;
$$;
