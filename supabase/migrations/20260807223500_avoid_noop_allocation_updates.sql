-- Palace Elite: avoid no-op allocation updates/audit noise when an unused
-- grant is recalculated after ownership configuration changes.

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
    updated_at = now()
  where benefit_unit_allocations.allocation_percentage is distinct from excluded.allocation_percentage
     or benefit_unit_allocations.allocated_quantity is distinct from excluded.allocated_quantity;
end;
$$;

revoke execute on function public.recalculate_benefit_unit_allocations(uuid)
  from public, anon, authenticated;
