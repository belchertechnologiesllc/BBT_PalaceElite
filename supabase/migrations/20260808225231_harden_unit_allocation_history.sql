-- Palace Elite: harden benefit-unit allocation history.

create or replace function public.enforce_benefit_unit_allocation_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_has_transactions boolean;
begin
  if new.id is distinct from old.id
     or new.membership_id is distinct from old.membership_id
     or new.benefit_grant_id is distinct from old.benefit_grant_id
     or new.ownership_unit_id is distinct from old.ownership_unit_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Benefit unit allocation identity and created_at are immutable.'
      using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.benefit_transactions t
    where t.benefit_grant_id = old.benefit_grant_id
  ) into v_has_transactions;

  if v_has_transactions
     and (
       new.allocation_percentage is distinct from old.allocation_percentage
       or new.allocated_quantity is distinct from old.allocated_quantity
     ) then
    raise exception 'Benefit grant % has transaction history; its ownership-unit allocation snapshot is immutable.', old.benefit_grant_id
      using errcode = 'P0001';
  end if;

  if new.allocation_percentage is distinct from old.allocation_percentage
     or new.allocated_quantity is distinct from old.allocated_quantity then
    new.updated_at := now();
  elsif new.updated_at is distinct from old.updated_at then
    raise exception 'updated_at may only change with allocation values.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_benefit_unit_allocation_immutability() from public;

create trigger enforce_benefit_unit_allocation_immutability_trg
before update on public.benefit_unit_allocations
for each row execute function public.enforce_benefit_unit_allocation_immutability();

-- Active accounting snapshots omit archived grants. The allocation rows remain
-- preserved for audit/history; this only changes the active read surface.
create or replace view public.benefit_unit_balances
with (security_invoker = true)
as
select
  a.id as allocation_id,
  a.membership_id,
  a.benefit_grant_id,
  g.name as benefit_name,
  g.pool,
  g.quantity_kind,
  a.ownership_unit_id,
  ou.name as ownership_unit_name,
  ou.archived_at as ownership_unit_archived_at,
  a.allocation_percentage,
  a.allocated_quantity,
  coalesce(
    sum(t.quantity_delta) filter (where t.status = 'approved'),
    0::numeric
  ) as approved_ledger_delta,
  a.allocated_quantity + coalesce(
    sum(t.quantity_delta) filter (where t.status = 'approved'),
    0::numeric
  ) as remaining_quantity
from public.benefit_unit_allocations a
join public.benefit_grants g on g.id = a.benefit_grant_id
join public.ownership_units ou on ou.id = a.ownership_unit_id
left join public.benefit_transactions t
  on t.benefit_grant_id = a.benefit_grant_id
 and t.ownership_unit_id = a.ownership_unit_id
where g.archived_at is null
group by a.id, g.id, ou.id;

revoke all on public.benefit_unit_balances from anon;
grant select on public.benefit_unit_balances to authenticated;

create or replace function public.get_benefit_unit_balances_as_of(
  p_membership_id uuid,
  p_as_of date
)
returns table (
  benefit_grant_id uuid,
  benefit_name text,
  pool public.benefit_pool,
  quantity_kind public.quantity_kind,
  ownership_unit_id uuid,
  ownership_unit_name text,
  allocation_percentage numeric,
  allocated_quantity numeric,
  ledger_delta numeric,
  remaining_quantity numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    a.benefit_grant_id,
    g.name,
    g.pool,
    g.quantity_kind,
    a.ownership_unit_id,
    ou.name,
    a.allocation_percentage,
    a.allocated_quantity,
    coalesce(sum(t.quantity_delta), 0::numeric) as ledger_delta,
    a.allocated_quantity + coalesce(sum(t.quantity_delta), 0::numeric) as remaining_quantity
  from public.benefit_unit_allocations a
  join public.benefit_grants g on g.id = a.benefit_grant_id
  join public.ownership_units ou on ou.id = a.ownership_unit_id
  left join public.benefit_transactions t
    on t.benefit_grant_id = a.benefit_grant_id
   and t.ownership_unit_id = a.ownership_unit_id
   and t.effective_date <= p_as_of
   and t.approved_at is not null
   and t.approved_at::date <= p_as_of
   and (t.voided_at is null or t.voided_at::date > p_as_of)
  where a.membership_id = p_membership_id
    and g.archived_at is null
    and public.user_has_membership_access(p_membership_id)
  group by a.id, g.id, ou.id
  order by g.pool, g.name, ou.name;
$$;

revoke execute on function public.get_benefit_unit_balances_as_of(uuid, date) from public, anon;
grant execute on function public.get_benefit_unit_balances_as_of(uuid, date) to authenticated;
