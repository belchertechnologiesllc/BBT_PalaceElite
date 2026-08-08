-- Palace Elite: ownership-unit accounting and ledger-derived reconciliation.
--
-- A grant's membership-level balance remains authoritative in
-- public.benefit_balances. This migration adds an allocation snapshot for each
-- ownership unit so the application can answer a second, separate question:
-- "whose accounting share is this?"
--
-- Allocation is an equity/accounting position, not a hard booking cap. A unit
-- may temporarily run below zero; transfers and corrective ledger entries are
-- the reconciliation mechanism. Pool eligibility is still enforced separately
-- by public.enforce_pool_eligibility().

-- =============================================================================
-- 1. Snapshot each grant's original allocation across ownership units
-- =============================================================================

create table public.benefit_unit_allocations (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete restrict,
  benefit_grant_id uuid not null references public.benefit_grants(id) on delete restrict,
  ownership_unit_id uuid not null references public.ownership_units(id) on delete restrict,
  allocation_percentage numeric(9,6) not null check (allocation_percentage >= 0 and allocation_percentage <= 100),
  allocated_quantity numeric(18,6) not null check (allocated_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (benefit_grant_id, ownership_unit_id),
  foreign key (membership_id, benefit_grant_id)
    references public.benefit_grants (membership_id, id) on delete restrict,
  foreign key (membership_id, ownership_unit_id)
    references public.ownership_units (membership_id, id) on delete restrict
);

comment on table public.benefit_unit_allocations is
  'Snapshot of each benefit grant original allocation by ownership unit. Once a grant has any transaction history, its allocation snapshot is immutable; later equity changes use benefit transactions/transfers instead of rewriting the baseline.';
comment on column public.benefit_unit_allocations.allocation_percentage is
  'Normalized share of this grant assigned to the ownership unit. Shared and Golf pools normalize independently across eligible units.';
comment on column public.benefit_unit_allocations.allocated_quantity is
  'Original grant quantity assigned to this ownership unit before ledger activity.';

create index benefit_unit_allocations_membership_idx
  on public.benefit_unit_allocations (membership_id, benefit_grant_id, ownership_unit_id);

alter table public.benefit_unit_allocations enable row level security;

create policy "membership users can read benefit unit allocations"
on public.benefit_unit_allocations
for select
to authenticated
using (public.user_has_membership_access(membership_id));

grant select on public.benefit_unit_allocations to authenticated;
revoke insert, update, delete on public.benefit_unit_allocations from authenticated, anon;

-- Preserve allocation history through the same audit machinery as the core
-- accounting tables. Client roles cannot write allocations directly.
create trigger benefit_unit_allocations_audit_trg
after insert or update on public.benefit_unit_allocations
for each row execute function public.log_audit_event();

create trigger benefit_unit_allocations_block_delete_trg
before delete on public.benefit_unit_allocations
for each row execute function public.block_hard_delete();

-- =============================================================================
-- 2. Allocation calculator
-- =============================================================================

create or replace function public.recalculate_benefit_unit_allocations(
  p_benefit_grant_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grant public.benefit_grants%rowtype;
  v_has_transactions boolean;
  v_has_allocations boolean;
  v_total_weight numeric;
begin
  select *
    into v_grant
  from public.benefit_grants
  where id = p_benefit_grant_id;

  if not found then
    raise exception 'Benefit grant % was not found.', p_benefit_grant_id
      using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.benefit_transactions
    where benefit_grant_id = p_benefit_grant_id
  ) into v_has_transactions;

  select exists (
    select 1 from public.benefit_unit_allocations
    where benefit_grant_id = p_benefit_grant_id
  ) into v_has_allocations;

  -- First-time population is allowed even for a grant that already has ledger
  -- history (needed when this migration seeds existing grants). After the
  -- snapshot exists, any transaction history freezes it permanently.
  if v_has_transactions and v_has_allocations then
    raise exception 'Benefit grant % has transaction history; its ownership-unit allocation snapshot is immutable.', p_benefit_grant_id
      using errcode = 'P0001';
  end if;

  select coalesce(sum(ou.ownership_percentage), 0)
    into v_total_weight
  from public.ownership_units ou
  where ou.membership_id = v_grant.membership_id
    and ou.archived_at is null
    and case
      when v_grant.pool = 'shared' then ou.participates_in_shared_pool
      when v_grant.pool = 'golf' then ou.participates_in_golf_pool
      else false
    end;

  if v_total_weight <= 0 then
    raise exception 'Benefit grant % has no eligible ownership units in the % pool.', p_benefit_grant_id, v_grant.pool
      using errcode = '23514';
  end if;

  -- Store one row for every unit in the membership, including 0-allocation
  -- rows for units outside this pool. This makes the Shared/Golf separation
  -- explicit and keeps the row shape stable if an unused grant is reconfigured.
  with calculated as (
    select
      ou.id as ownership_unit_id,
      case
        when ou.archived_at is null
         and case
           when v_grant.pool = 'shared' then ou.participates_in_shared_pool
           when v_grant.pool = 'golf' then ou.participates_in_golf_pool
           else false
         end
        then round((ou.ownership_percentage / v_total_weight) * 100, 6)
        else 0::numeric
      end as allocation_percentage,
      case
        when ou.archived_at is null
         and case
           when v_grant.pool = 'shared' then ou.participates_in_shared_pool
           when v_grant.pool = 'golf' then ou.participates_in_golf_pool
           else false
         end
        then round(v_grant.original_quantity * (ou.ownership_percentage / v_total_weight), 6)
        else 0::numeric
      end as allocated_quantity
    from public.ownership_units ou
    where ou.membership_id = v_grant.membership_id
  ),
  residual_target as (
    select c.ownership_unit_id
    from calculated c
    join public.ownership_units ou on ou.id = c.ownership_unit_id
    where c.allocation_percentage > 0
    order by ou.ownership_percentage desc, ou.id
    limit 1
  ),
  totals as (
    select
      coalesce(sum(c.allocation_percentage), 0) as percentage_total,
      coalesce(sum(c.allocated_quantity), 0) as quantity_total
    from calculated c
  ),
  final_values as (
    select
      c.ownership_unit_id,
      case
        when c.ownership_unit_id = (select ownership_unit_id from residual_target)
        then c.allocation_percentage + (100 - t.percentage_total)
        else c.allocation_percentage
      end as allocation_percentage,
      case
        when c.ownership_unit_id = (select ownership_unit_id from residual_target)
        then c.allocated_quantity + (v_grant.original_quantity - t.quantity_total)
        else c.allocated_quantity
      end as allocated_quantity
    from calculated c
    cross join totals t
  )
  insert into public.benefit_unit_allocations (
    membership_id,
    benefit_grant_id,
    ownership_unit_id,
    allocation_percentage,
    allocated_quantity
  )
  select
    v_grant.membership_id,
    v_grant.id,
    f.ownership_unit_id,
    f.allocation_percentage,
    f.allocated_quantity
  from final_values f
  on conflict (benefit_grant_id, ownership_unit_id)
  do update set
    allocation_percentage = excluded.allocation_percentage,
    allocated_quantity = excluded.allocated_quantity,
    updated_at = now();
end;
$$;

revoke execute on function public.recalculate_benefit_unit_allocations(uuid) from public, anon, authenticated;

-- New or still-unused grants follow the current ownership configuration. Once
-- a grant has any transaction row, the existing grant-immutability trigger
-- blocks accounting-field changes and the allocation snapshot remains frozen.
create or replace function public.sync_benefit_unit_allocations_from_grant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recalculate_benefit_unit_allocations(new.id);
  return new;
end;
$$;

revoke execute on function public.sync_benefit_unit_allocations_from_grant() from public;

create trigger sync_benefit_unit_allocations_from_grant_trg
after insert or update of membership_id, pool, original_quantity
on public.benefit_grants
for each row execute function public.sync_benefit_unit_allocations_from_grant();

-- Ownership changes only recalculate grants that have never entered the
-- ledger. Existing transaction history freezes the grant's baseline allocation
-- so later ownership edits cannot rewrite past equity positions.
create or replace function public.sync_unused_grant_allocations_from_ownership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grant_id uuid;
begin
  for v_grant_id in
    select g.id
    from public.benefit_grants g
    where g.membership_id = new.membership_id
      and not exists (
        select 1
        from public.benefit_transactions t
        where t.benefit_grant_id = g.id
      )
  loop
    perform public.recalculate_benefit_unit_allocations(v_grant_id);
  end loop;

  return new;
end;
$$;

revoke execute on function public.sync_unused_grant_allocations_from_ownership() from public;

create trigger sync_unused_grant_allocations_from_ownership_trg
after insert or update of ownership_percentage, participates_in_shared_pool,
  participates_in_golf_pool, archived_at
on public.ownership_units
for each row execute function public.sync_unused_grant_allocations_from_ownership();

-- Seed every existing benefit grant. The first-time rule above allows the one
-- currently-used Incentive Stays grant to receive its baseline snapshot without
-- changing its transaction history.
do $$
declare
  v_grant_id uuid;
begin
  for v_grant_id in select id from public.benefit_grants order by id
  loop
    perform public.recalculate_benefit_unit_allocations(v_grant_id);
  end loop;
end;
$$;

-- =============================================================================
-- 3. Current unit-level balances derived from allocation + approved ledger
-- =============================================================================

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
group by a.id, g.id, ou.id;

revoke all on public.benefit_unit_balances from anon;
grant select on public.benefit_unit_balances to authenticated;

-- =============================================================================
-- 4. Reconciliation: membership balance must equal the sum of unit positions
-- =============================================================================

create or replace view public.benefit_reconciliation
with (security_invoker = true)
as
select
  b.id as benefit_grant_id,
  b.membership_id,
  b.name as benefit_name,
  b.pool,
  b.quantity_kind,
  b.original_quantity,
  b.remaining_quantity as grant_remaining_quantity,
  coalesce(sum(ub.allocated_quantity), 0::numeric) as unit_allocated_quantity,
  coalesce(sum(ub.remaining_quantity), 0::numeric) as unit_remaining_quantity,
  b.original_quantity - coalesce(sum(ub.allocated_quantity), 0::numeric) as original_reconciliation_difference,
  b.remaining_quantity - coalesce(sum(ub.remaining_quantity), 0::numeric) as remaining_reconciliation_difference,
  abs(b.original_quantity - coalesce(sum(ub.allocated_quantity), 0::numeric)) < 0.000001
    and abs(b.remaining_quantity - coalesce(sum(ub.remaining_quantity), 0::numeric)) < 0.000001
    as is_reconciled
from public.benefit_balances b
left join public.benefit_unit_balances ub
  on ub.benefit_grant_id = b.id
group by
  b.id,
  b.membership_id,
  b.name,
  b.pool,
  b.quantity_kind,
  b.original_quantity,
  b.remaining_quantity;

revoke all on public.benefit_reconciliation from anon;
grant select on public.benefit_reconciliation to authenticated;

-- =============================================================================
-- 5. Historical unit balances as of a business date
-- =============================================================================

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
    and public.user_has_membership_access(p_membership_id)
  group by a.id, g.id, ou.id
  order by g.pool, g.name, ou.name;
$$;

revoke execute on function public.get_benefit_unit_balances_as_of(uuid, date) from public, anon;
grant execute on function public.get_benefit_unit_balances_as_of(uuid, date) to authenticated;

comment on function public.get_benefit_unit_balances_as_of(uuid, date) is
  'Reconstructs ownership-unit benefit positions as of a business date using effective_date plus approval/void lifecycle dates. Allocation baseline is frozen once ledger activity exists.';
