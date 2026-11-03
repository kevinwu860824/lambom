-- Adds active-group ownership to inventory reports and stock records.
-- Run this before deploying the application code that filters by group_id.
-- Existing records are assigned only when their group can be inferred
-- uniquely; unresolved rows remain NULL and are listed at the end.

alter table public.inv_logs
  add column if not exists group_id bigint references public.groups(id) on delete set null;

alter table public.inv_stock
  add column if not exists group_id bigint references public.groups(id) on delete set null;

with candidate_groups as (
  select distinct l.id, gm.group_id
  from public.inv_logs l
  join public.group_machines gm on gm.machine_name = l.machine_name
  where l.machine_name <> ''
    and (
      l.reporter_employee_id is null
      or not exists (
        select 1
        from public.group_members member_row
        where member_row.employee_id = l.reporter_employee_id
      )
      or exists (
        select 1
        from public.group_members member_row
        where member_row.employee_id = l.reporter_employee_id
          and member_row.group_id = gm.group_id
      )
    )

  union

  select distinct l.id, member_row.group_id
  from public.inv_logs l
  join public.group_members member_row on member_row.employee_id = l.reporter_employee_id
  where l.machine_name = ''
), uniquely_resolved as (
  select id, min(group_id) as group_id
  from candidate_groups
  group by id
  having count(distinct group_id) = 1
)
update public.inv_logs l
set group_id = resolved.group_id
from uniquely_resolved resolved
where l.id = resolved.id
  and l.group_id is null;

with uniquely_owned_machines as (
  select machine_name, min(group_id) as group_id
  from public.group_machines
  where machine_name <> ''
  group by machine_name
  having count(distinct group_id) = 1
)
update public.inv_stock stock
set group_id = owned.group_id
from uniquely_owned_machines owned
where stock.machine_name = owned.machine_name
  and stock.group_id is null;

alter table public.inv_stock
  drop constraint if exists inv_stock_part_no_machine_name_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inv_stock'::regclass
      and conname = 'inv_stock_group_part_machine_key'
  ) then
    alter table public.inv_stock
      add constraint inv_stock_group_part_machine_key
      unique (group_id, part_no, machine_name);
  end if;
end;
$$;

create index if not exists inv_logs_group_created_at_idx
  on public.inv_logs (group_id, created_at desc);

create index if not exists inv_stock_group_part_no_idx
  on public.inv_stock (group_id, part_no);

select 'inv_logs' as table_name, id as record_id, machine_name, reporter_employee_id, group_id
from public.inv_logs
where group_id is null
union all
select 'inv_stock' as table_name, id as record_id, machine_name, null::text as reporter_employee_id, group_id
from public.inv_stock
where group_id is null
order by table_name, record_id;