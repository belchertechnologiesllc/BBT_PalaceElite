-- Palace Elite: operational dashboard and reporting API.
--
-- These functions are SECURITY INVOKER by design. They inherit the existing
-- table/view RLS policies instead of bypassing them:
--   * membership users can read membership-scoped operational data
--   * public.audit_log remains admin-only through its existing RLS policy
-- No report/export path gets broader database access than the signed-in user.

create or replace function public.get_operational_dashboard_snapshot(
  p_membership_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_membership jsonb;
  v_summary jsonb;
  v_benefits jsonb;
  v_ownership jsonb;
  v_recent_activity jsonb;
  v_expirations jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.user_has_membership_access(p_membership_id) then
    raise exception 'Membership access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', m.id,
    'name', m.name,
    'purchase_price', m.purchase_price,
    'start_date', m.start_date,
    'expiration_date', m.expiration_date
  )
  into v_membership
  from public.memberships m
  where m.id = p_membership_id
    and m.archived_at is null;

  if v_membership is null then
    raise exception 'Membership % was not found or is archived.', p_membership_id
      using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'active_members', (
      select count(*)
      from public.people p
      where p.membership_id = p_membership_id
        and p.is_active
        and p.archived_at is null
    ),
    'active_ownership_units', (
      select count(*)
      from public.ownership_units ou
      where ou.membership_id = p_membership_id
        and ou.archived_at is null
    ),
    'open_reservations', (
      select count(*)
      from public.reservations r
      where r.membership_id = p_membership_id
        and r.voided_at is null
    ),
    'pending_approvals', (
      select count(*)
      from public.benefit_transactions t
      where t.membership_id = p_membership_id
        and t.status in ('draft', 'submitted')
    ),
    'approved_transactions_30d', (
      select count(*)
      from public.benefit_transactions t
      where t.membership_id = p_membership_id
        and t.status = 'approved'
        and t.approved_at >= now() - interval '30 days'
    ),
    'unreconciled_benefits', (
      select count(*)
      from public.benefit_reconciliation r
      where r.membership_id = p_membership_id
        and not r.is_reconciled
    ),
    'future_expirations', (
      select count(*)
      from public.benefit_balances b
      where b.membership_id = p_membership_id
        and b.archived_at is null
        and b.expiration_date is not null
        and b.expiration_date >= current_date
    )
  ) into v_summary;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'pool', b.pool,
        'quantity_kind', b.quantity_kind,
        'original_quantity', b.original_quantity,
        'remaining_quantity', b.remaining_quantity,
        'expiration_date', b.expiration_date
      )
      order by b.pool, b.name
    ),
    '[]'::jsonb
  )
  into v_benefits
  from public.benefit_balances b
  where b.membership_id = p_membership_id
    and b.archived_at is null;

  with member_counts as (
    select
      p.ownership_unit_id,
      count(*) filter (where p.is_active and p.archived_at is null) as active_member_count
    from public.people p
    where p.membership_id = p_membership_id
    group by p.ownership_unit_id
  ),
  shared_activity as (
    select
      t.ownership_unit_id,
      count(*) filter (where t.status = 'approved') as approved_activity_count
    from public.benefit_transactions t
    join public.benefit_grants g on g.id = t.benefit_grant_id
    where t.membership_id = p_membership_id
      and g.pool = 'shared'
    group by t.ownership_unit_id
  ),
  golf_positions as (
    select
      ub.ownership_unit_id,
      coalesce(sum(ub.remaining_quantity) filter (where ub.pool = 'golf' and ub.quantity_kind = 'rounds'), 0::numeric) as rounds_position,
      coalesce(sum(ub.remaining_quantity) filter (where ub.pool = 'golf' and ub.quantity_kind = 'nights'), 0::numeric) as nights_position
    from public.benefit_unit_balances ub
    where ub.membership_id = p_membership_id
    group by ub.ownership_unit_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ou.id,
        'name', ou.name,
        'members_description', ou.members_description,
        'ownership_percentage', ou.ownership_percentage,
        'participates_in_shared_pool', ou.participates_in_shared_pool,
        'participates_in_golf_pool', ou.participates_in_golf_pool,
        'active_member_count', coalesce(mc.active_member_count, 0),
        'shared_activity_count', coalesce(sa.approved_activity_count, 0),
        'golf_rounds_position', case when ou.participates_in_golf_pool then coalesce(gp.rounds_position, 0) else null end,
        'golf_nights_position', case when ou.participates_in_golf_pool then coalesce(gp.nights_position, 0) else null end
      )
      order by ou.name
    ),
    '[]'::jsonb
  )
  into v_ownership
  from public.ownership_units ou
  left join member_counts mc on mc.ownership_unit_id = ou.id
  left join shared_activity sa on sa.ownership_unit_id = ou.id
  left join golf_positions gp on gp.ownership_unit_id = ou.id
  where ou.membership_id = p_membership_id
    and ou.archived_at is null;

  select coalesce(
    jsonb_agg(activity.row_data order by activity.created_at desc, activity.id desc),
    '[]'::jsonb
  )
  into v_recent_activity
  from (
    select
      t.id,
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'effective_date', t.effective_date,
        'created_at', t.created_at,
        'transaction_type', t.transaction_type,
        'status', t.status,
        'quantity_delta', t.quantity_delta,
        'notes', t.notes,
        'source_reference', t.source_reference,
        'ownership_unit_name', ou.name,
        'benefit_name', g.name,
        'pool', g.pool,
        'quantity_kind', g.quantity_kind
      ) as row_data
    from public.benefit_transactions t
    join public.ownership_units ou on ou.id = t.ownership_unit_id
    join public.benefit_grants g on g.id = t.benefit_grant_id
    where t.membership_id = p_membership_id
    order by t.created_at desc, t.id desc
    limit 8
  ) activity;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'benefit_grant_id', b.id,
        'benefit_name', b.name,
        'pool', b.pool,
        'quantity_kind', b.quantity_kind,
        'remaining_quantity', b.remaining_quantity,
        'expiration_date', b.expiration_date,
        'days_remaining', b.expiration_date - current_date
      )
      order by b.expiration_date, b.name
    ),
    '[]'::jsonb
  )
  into v_expirations
  from public.benefit_balances b
  where b.membership_id = p_membership_id
    and b.archived_at is null
    and b.expiration_date is not null
    and b.expiration_date >= current_date;

  return jsonb_build_object(
    'membership', v_membership,
    'summary', v_summary,
    'benefits', v_benefits,
    'ownership_positions', v_ownership,
    'recent_activity', v_recent_activity,
    'expirations', v_expirations,
    'generated_at', now()
  );
end;
$$;

revoke execute on function public.get_operational_dashboard_snapshot(uuid)
  from public, anon;
grant execute on function public.get_operational_dashboard_snapshot(uuid)
  to authenticated;

comment on function public.get_operational_dashboard_snapshot(uuid) is
  'Returns the live operational dashboard: membership summary, benefit balances, ownership positions, recent transaction activity, expirations, and reconciliation exceptions.';

create or replace function public.get_reporting_snapshot(
  p_membership_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_is_admin boolean;
  v_members jsonb;
  v_ownership jsonb;
  v_benefit_usage jsonb;
  v_pool_activity jsonb;
  v_audit jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.user_has_membership_access(p_membership_id) then
    raise exception 'Membership access is required.' using errcode = '42501';
  end if;

  if v_from > v_to then
    raise exception 'Report start date cannot be after end date.' using errcode = '22007';
  end if;

  v_is_admin := public.user_is_membership_admin(p_membership_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'preferred_name', p.preferred_name,
        'relationship_to_primary', p.relationship_to_primary,
        'person_role', p.person_role,
        'date_of_birth', p.date_of_birth,
        'ownership_unit_name', ou.name,
        'participates_in_shared_pool', p.participates_in_shared_pool,
        'participates_in_golf_pool', p.participates_in_golf_pool,
        'is_active', p.is_active,
        'archived_at', p.archived_at
      )
      order by ou.name, p.display_order, p.last_name, p.first_name
    ),
    '[]'::jsonb
  )
  into v_members
  from public.people p
  join public.ownership_units ou on ou.id = p.ownership_unit_id
  where p.membership_id = p_membership_id;

  with member_rollup as (
    select
      p.ownership_unit_id,
      count(*) filter (where p.is_active and p.archived_at is null) as active_member_count,
      string_agg(
        trim(coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name),
        ', '
        order by p.display_order, p.last_name, p.first_name
      ) filter (where p.is_active and p.archived_at is null) as active_members
    from public.people p
    where p.membership_id = p_membership_id
    group by p.ownership_unit_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ou.id,
        'name', ou.name,
        'members_description', ou.members_description,
        'ownership_percentage', ou.ownership_percentage,
        'participates_in_shared_pool', ou.participates_in_shared_pool,
        'participates_in_golf_pool', ou.participates_in_golf_pool,
        'active_member_count', coalesce(mr.active_member_count, 0),
        'active_members', coalesce(mr.active_members, ''),
        'archived_at', ou.archived_at
      )
      order by ou.name
    ),
    '[]'::jsonb
  )
  into v_ownership
  from public.ownership_units ou
  left join member_rollup mr on mr.ownership_unit_id = ou.id
  where ou.membership_id = p_membership_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'effective_date', t.effective_date,
        'transaction_type', t.transaction_type,
        'status', t.status,
        'ownership_unit_name', ou.name,
        'benefit_name', g.name,
        'pool', g.pool,
        'quantity_kind', g.quantity_kind,
        'quantity_delta', t.quantity_delta,
        'face_value', t.face_value,
        'economic_value', t.economic_value,
        'notes', t.notes,
        'source_reference', t.source_reference,
        'related_transaction_id', t.related_transaction_id,
        'transaction_group_id', t.transaction_group_id,
        'approved_at', t.approved_at,
        'voided_at', t.voided_at
      )
      order by t.effective_date desc, t.created_at desc, t.id desc
    ),
    '[]'::jsonb
  )
  into v_benefit_usage
  from public.benefit_transactions t
  join public.ownership_units ou on ou.id = t.ownership_unit_id
  join public.benefit_grants g on g.id = t.benefit_grant_id
  where t.membership_id = p_membership_id
    and t.effective_date between v_from and v_to
    and t.transaction_type <> 'transfer';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pool', activity.pool,
        'ownership_unit_name', activity.ownership_unit_name,
        'quantity_kind', activity.quantity_kind,
        'transaction_count', activity.transaction_count,
        'net_quantity_delta', activity.net_quantity_delta,
        'use_quantity', activity.use_quantity,
        'economic_value_recorded', activity.economic_value_recorded
      )
      order by activity.pool, activity.ownership_unit_name, activity.quantity_kind
    ),
    '[]'::jsonb
  )
  into v_pool_activity
  from (
    select
      g.pool,
      ou.name as ownership_unit_name,
      g.quantity_kind,
      count(*) as transaction_count,
      coalesce(sum(t.quantity_delta), 0::numeric) as net_quantity_delta,
      coalesce(sum(t.quantity_used) filter (where t.transaction_type = 'use'), 0::numeric) as use_quantity,
      coalesce(sum(t.economic_value) filter (where t.transaction_type = 'use'), 0::numeric) as economic_value_recorded
    from public.benefit_transactions t
    join public.ownership_units ou on ou.id = t.ownership_unit_id
    join public.benefit_grants g on g.id = t.benefit_grant_id
    where t.membership_id = p_membership_id
      and t.effective_date between v_from and v_to
      and t.status = 'approved'
    group by g.pool, ou.id, ou.name, g.quantity_kind
  ) activity;

  if v_is_admin then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'created_at', a.created_at,
          'actor_id', a.actor_id,
          'actor_name', trim(coalesce(nullif(p.preferred_name, ''), p.first_name, '') || ' ' || coalesce(p.last_name, '')),
          'action', a.action,
          'entity_type', a.entity_type,
          'entity_id', a.entity_id,
          'previous_data', a.previous_data,
          'new_data', a.new_data
        )
        order by a.created_at desc, a.id desc
      ),
      '[]'::jsonb
    )
    into v_audit
    from public.audit_log a
    left join public.people p
      on p.profile_id = a.actor_id
     and p.membership_id = a.membership_id
    where a.membership_id = p_membership_id
      and a.created_at >= v_from::timestamptz
      and a.created_at < (v_to + 1)::timestamptz;
  else
    v_audit := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'from_date', v_from,
    'to_date', v_to,
    'is_admin', v_is_admin,
    'members', v_members,
    'ownership', v_ownership,
    'benefit_usage', v_benefit_usage,
    'pool_activity', v_pool_activity,
    'audit', v_audit,
    'generated_at', now()
  );
end;
$$;

revoke execute on function public.get_reporting_snapshot(uuid, date, date)
  from public, anon;
grant execute on function public.get_reporting_snapshot(uuid, date, date)
  to authenticated;

comment on function public.get_reporting_snapshot(uuid, date, date) is
  'Returns member, ownership, benefit-ledger, pool-activity, and admin-only audit report datasets for a membership and inclusive business-date range.';
