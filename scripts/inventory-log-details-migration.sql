-- Adds part details to Active/Archive inventory reports and loan records.
-- Run in Supabase before deploying the application code that reads/writes
-- these fields. Existing records receive qty = 1 and NULL description/note.

alter table public.inv_logs
  add column if not exists description text,
  add column if not exists qty integer not null default 1,
  add column if not exists note text;

alter table public.inv_logs
  drop constraint if exists inv_logs_qty_positive_check;

alter table public.inv_logs
  add constraint inv_logs_qty_positive_check check (qty > 0);