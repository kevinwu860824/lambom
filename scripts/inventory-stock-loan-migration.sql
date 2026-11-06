-- Adds loan tracking to on-hand Inventory stock records.
-- Run in Supabase before deploying the application code that reads/writes
-- these fields. Existing stock records default to not loaned.

alter table public.inv_stock
  add column if not exists is_loan boolean not null default false,
  add column if not exists borrower text;
