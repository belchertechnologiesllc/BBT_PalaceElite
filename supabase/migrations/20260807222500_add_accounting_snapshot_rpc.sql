-- Palace Elite: guarded accounting snapshot API.
--
-- React consumes accounting through this RPC/service boundary rather than
-- reading the new views directly. The same function supports both today's
-- position and historical as-of reconstruction.

create or replace function public.get_benefit_accounting_snapshot(
  p_membership_id uuid,
  p_as_of date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_unit_balances jsonb;
  v_reconciliation jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.user_has_membership_access(p_membership_id) then
    raise exception 'Membership access is required.' using errcode = '42501';
  end if;

  with unit_rows as (
    select *
    from public.get_benefit_unit_balances_as_of(p_membership_id, v_as_of)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'benefit_grant_id', u.benefit_grant_id,
        'benefit_name', u.benefit_name,
        'pool', u.pool,
        'quantity_kind', u.quantity_kind,
        'ownership_unit_id', u.ownership_unit_id,
        'ownership_unit_name', u.ownership_unit_name,
        'allocation_percentage', u.allocation_percentage,
        'allocated_quantity', u.allocated_quantity,
        'ledger_delta', u.ledger_delta,
        'remaining_quantity', u.remaining_quantity
      )
      order by u.pool, u.benefit_name, u.ownership_unit_name
    ),
    '[]'::jsonb
  )
  into v_unit_balances
  from unit_rows u;

  with qualifying_transactions as (
    select t.*
    from public.benefit_transactions t
    where t.membership_id = p_membership_id
      and t.effective_date <= v_as_of
      and t.approved_at is not null
      and t.approved_at::date <= v_as_of
      and (t.voided_at is null or t.voided_at::date > v_as_of)
  ),
  grant_balances as (
    select
      g.id as benefit_grant_id,
      g.name as benefit_name,
      g.pool,
      g.quantity_kind,
      g.original_quantity,
      g.original_quantity + coalesce(sum(t.quantity_delta), 0::numeric)
        as grant_remaining_quantity
    from public.benefit_grants g
    left join qualifying_transactions t on t.benefit_grant_id = g.id
    where g.membership_id = p_membership_id
      and g.archived_at is null
    group by g.id
  ),
  unit_totals as (
    select
      a.benefit_grant_id,
      coalesce(sum(a.allocated_quantity), 0::numeric) as unit_allocated_quantity,
      coalesce(sum(u.remaining_quantity), 0::numeric) as unit_remaining_quantity
    from public.benefit_unit_allocations a
    left join public.get_benefit_unit_balances_as_of(p_membership_id, v_as_of) u
      on u.benefit_grant_id = a.benefit_grant_id
     and u.ownership_unit_id = a.ownership_unit_id
    where a.membership_id = p_membership_id
    group by a.benefit_grant_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'benefit_grant_id', g.benefit_grant_id,
        'benefit_name', g.benefit_name,
        'pool', g.pool,
        'quantity_kind', g.quantity_kind,
        'original_quantity', g.original_quantity,
        'grant_remaining_quantity', g.grant_remaining_quantity,
        'unit_allocated_quantity', coalesce(u.unit_allocated_quantity, 0),
        'unit_remaining_quantity', coalesce(u.unit_remaining_quantity, 0),
        'original_reconciliation_difference',
          g.original_quantity - coalesce(u.unit_allocated_quantity, 0),
        'remaining_reconciliation_difference',
          g.grant_remaining_quantity - coalesce(u.unit_remaining_quantity, 0),
        'is_reconciled',
          abs(g.original_quantity - coalesce(u.unit_allocated_quantity, 0)) < 0.000001
          and abs(g.grant_remaining_quantity - coalesce(u.unit_remaining_quantity, 0)) < 0.000001
      )
      order by g.pool, g.benefit_name
    ),
    '[]'::jsonb
  )
  into v_reconciliation
  from grant_balances g
  left join unit_totals u on u.benefit_grant_id = g.benefit_grant_id;

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'as_of', v_as_of,
    'unit_balances', v_unit_balances,
    'reconciliation', v_reconciliation
  );
end;
$$;

revoke execute on function public.get_benefit_accounting_snapshot(uuid, date)
  from public, anon;
grant execute on function public.get_benefit_accounting_snapshot(uuid, date)
  to authenticated;

comment on function public.get_benefit_accounting_snapshot(uuid, date) is
  'Returns unit-level allocation positions and grant-vs-unit reconciliation as of a business date. Shared and Golf pools remain independent through the frozen grant allocation snapshot.';
