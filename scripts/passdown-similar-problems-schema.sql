-- Fuzzy "similar historical problem" search for the Passdown Tool.
-- Run this once in the Supabase SQL Editor.
--
-- v2: strips list numbering ("1.", "2)", "1-1.", "a.", "-") from the start
-- of each line before comparing/grouping — real data showed ~40% of
-- Problem Statement text starts with this kind of numbering, which was
-- diluting trigram similarity and keeping otherwise-identical text (e.g.
-- "Alarm:\nP/V temperature drop." vs the same without the trailing period)
-- from being recognized as duplicates.
--
-- v3: switched the match predicate from similarity()/% to word_similarity()
-- plus an ILIKE substring fallback. similarity() scores by the *combined*
-- trigram count of both strings, so a short typed query against a much
-- longer stored problem_statement mathematically can't clear the default
-- 0.3 threshold even on a clean phrase match (confirmed in practice: typing
-- "P/V Leaking" returned zero suggestions despite matching history
-- existing). word_similarity() instead measures how well the query matches
-- *some contiguous extent* of the longer string — the right tool for
-- "does this short typed prefix look like part of a longer historical
-- entry." The ILIKE leg is a safety net for very short structured codes
-- (e.g. "FDC", a literal prefix convention in real data) where trigram
-- math alone is too noisy to be reliable. Also added `remark` to both
-- RPCs' output so the "上次怎麼處理" history view can show what was
-- recorded in Remark alongside the notes for the same historical day.
--
-- Threshold is applied as an explicit `word_similarity(...) >= 0.4`
-- predicate rather than the <% operator + a function-level
-- `SET pg_trgm.word_similarity_threshold` — Supabase's SQL editor role
-- doesn't have permission to set that GUC even scoped to one function
-- ("permission denied to set parameter"). The explicit form can't use the
-- GIN trigram index the way <% could, so this query sequential-scans
-- passdown_entries per search — fine at this table's actual size (tens of
-- thousands of rows, a handful of concurrent users), revisit only if the
-- table grows by orders of magnitude.

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

-- Fuzzy search over normalized text, grouped so near-duplicates that only
-- differ by numbering/punctuation/case collapse into one suggestion (with
-- how many times it's actually occurred) instead of cluttering the list
-- with what's functionally the same entry repeated. Ranked with
-- same-tool_id matches first (a recurring issue on the same machine is far
-- more likely to be the same root cause), then similarity, then recency.
--
-- Match predicate: word_similarity() instead of plain similarity()/% — see
-- the v3 note above. word_similarity(a, b) measures how well `a` matches
-- some extent of `b`, so argument order matters: the short typed query goes
-- first, the long stored text second, or you're back to being penalized by
-- the query's own short length. 0.4 is a starting point looser than the
-- 0.6 prose-tuned default pg_trgm normally uses — nudge it below if it's
-- over/under-triggering against real data.
--
-- The v1/v2 function had a different RETURNS TABLE shape (no
-- occurrence_count, no remark), and Postgres won't let CREATE OR REPLACE
-- change that — drop it first.
drop function if exists passdown_search_similar_problems(text, text, integer);

create or replace function passdown_search_similar_problems(
  search_text text,
  p_tool_id text default null,
  p_limit int default 6
) returns table (
  id bigint,
  problem_statement text,
  remark text,
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
      e.remark,
      e.entry_date,
      e.tool_id,
      e.module,
      passdown_normalize_problem(e.problem_statement) as norm,
      word_similarity(passdown_normalize_problem(search_text), passdown_normalize_problem(e.problem_statement)) as sim
    from passdown_entries e
    where e.problem_statement is not null
      and (
        word_similarity(passdown_normalize_problem(search_text), passdown_normalize_problem(e.problem_statement)) >= 0.4
        or passdown_normalize_problem(e.problem_statement) ilike ('%' || passdown_normalize_problem(search_text) || '%')
      )
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
  select id, problem_statement, remark, cnt::int as occurrence_count, entry_date, tool_id, module, sim as similarity
  from ranked
  where rn = 1
  order by (tool_id = p_tool_id) desc, similarity desc, entry_date desc
  limit p_limit;
$$;

-- Every entry for one tool+module whose problem text normalizes the same as
-- the given text — used to build the "上次怎麼處理" history timeline so it
-- picks up the whole episode even across numbering/formatting variations,
-- not just rows with byte-identical problem_statement. Includes remark so
-- the history view can show it alongside that day's notes.
drop function if exists passdown_entries_by_normalized_problem(text, text, text);

create or replace function passdown_entries_by_normalized_problem(
  p_tool_id text,
  p_module text,
  p_problem_statement text
) returns table (
  id bigint,
  entry_date date,
  remark text
) language sql stable as $$
  select id, entry_date, remark
  from passdown_entries
  where tool_id = p_tool_id
    and module = p_module
    and passdown_normalize_problem(problem_statement) = passdown_normalize_problem(p_problem_statement)
  order by entry_date asc;
$$;
