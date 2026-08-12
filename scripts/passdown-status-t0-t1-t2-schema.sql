-- Adds T0/T1/T2 (tool-install stages) as real Status values in the Passdown
-- Tool, alongside the existing Up/Down/Monitor/Other. Run this once in the
-- Supabase SQL Editor — passdown_entries.status already exists with a CHECK
-- constraint limited to ('up','down','monitor','other'), which needs
-- widening before the app can write 't0'/'t1'/'t2'.
--
-- The constraint was created unnamed in scripts/passdown-schema.sql, so
-- Postgres auto-named it with its standard <table>_<column>_check pattern.
alter table passdown_entries drop constraint if exists passdown_entries_status_check;
alter table passdown_entries add constraint passdown_entries_status_check
  check (status in ('up', 'down', 'monitor', 't0', 't1', 't2', 'other'));
