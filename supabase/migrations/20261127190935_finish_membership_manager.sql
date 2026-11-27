alter table public.reservations
  add column status text not null default 'confirmed'
    check (status in ('tentative', 'confirmed', 'completed', 'cancelled')),
  add column adults integer not null default 0 check (adults >= 0),
  add column minors integer not null default 0 check (minors >= 0),
  add column rate_type text,
  add column total_cost numeric(12,2) check (total_cost >= 0),
  add column amount_per_room numeric(12,2) check (amount_per_room >= 0),
  add column notes text,
  add column benefit_grant_id uuid,
  add column benefit_quantity numeric(12,2) check (benefit_quantity > 0),
  add foreign key (membership_id, benefit_grant_id)
    references public.benefit_grants(membership_id, id),
  add check ((benefit_grant_id is null) = (benefit_quantity is null));

update public.reservations set status = 'cancelled' where voided_at is not null;

create policy "Admins can create reservations" on public.reservations
  for insert to authenticated with check (public.user_is_membership_admin(membership_id));

create function public.save_reservation(p_data jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  r public.reservations;
  previous public.reservations;
  g public.benefit_grants;
  t public.benefit_transactions;
  new_transaction uuid;
  posting_date date;
begin
  r := jsonb_populate_record(null::public.reservations, p_data);
  if not public.user_is_membership_admin(r.membership_id) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;
  if nullif(btrim(r.resort), '') is null then
    raise exception 'Enter a resort name.';
  end if;
  if r.id is not null then
    select * into strict previous from public.reservations
      where id = r.id and membership_id = r.membership_id for update;
    if previous.ownership_unit_id <> r.ownership_unit_id and exists (
      select 1 from public.benefit_transactions where reservation_id = r.id
    ) then
      raise exception 'Ownership is locked after ledger activity. Cancel and create a new reservation to change units.';
    end if;
  end if;
  select least(r.check_in, timezone(m.business_timezone, now())::date)
  into posting_date from public.memberships m where id = r.membership_id;
  if r.status in ('confirmed','completed') and r.benefit_grant_id is not null then
    select * into strict g from public.benefit_grants
      where id = r.benefit_grant_id and membership_id = r.membership_id and archived_at is null for update;
    if r.check_in < g.release_date or r.check_out - 1 > g.expiration_date then
      raise exception 'The stay falls outside the benefit availability dates.';
    end if;
    if exists (
      select 1 from public.benefit_grant_details
      where benefit_grant_id = g.id and gold_season_only
    ) and exists (
      select 1 from generate_series(r.check_in::timestamp, (r.check_out - 1)::timestamp, interval '1 day') d
      where to_char(d, 'MM-DD') >= '12-24' or to_char(d, 'MM-DD') = '01-01'
    ) then
      raise exception 'Gold Season excludes December 24 through January 1.';
    end if;
    if g.benefit_code = 'incentive_stays' and (
      select coalesce(sum(-x.quantity_delta), 0)
      from public.benefit_transactions x
      where x.benefit_grant_id = g.id and x.status = 'approved' and x.reservation_id is distinct from r.id
    ) + r.benefit_quantity > (case when r.check_in < date '2029-03-29' then 0
                                   when r.check_in < date '2031-03-29' then 2 else 4 end) then
      raise exception 'The requested Incentive Stay quantity has not been released for these dates.';
    end if;
  end if;
  r.id := coalesce(r.id, gen_random_uuid());
  insert into public.reservations (id, membership_id, ownership_unit_id, resort, check_in, check_out,
    room_type, confirmation_number, status, adults, minors, rate_type, total_cost, amount_per_room,
    notes, benefit_grant_id, benefit_quantity, created_by, voided_at, voided_by, void_reason)
  values (r.id, r.membership_id, r.ownership_unit_id, r.resort, r.check_in, r.check_out,
    r.room_type, r.confirmation_number, r.status, r.adults, r.minors, r.rate_type, r.total_cost,
    r.amount_per_room, r.notes, r.benefit_grant_id, r.benefit_quantity, auth.uid(),
    case when r.status = 'cancelled' then coalesce(previous.voided_at, now()) end,
    case when r.status = 'cancelled' then coalesce(previous.voided_by, auth.uid()) end,
    case when r.status = 'cancelled' then 'Cancelled in Membership Manager' end)
  on conflict (id) do update set
    ownership_unit_id = excluded.ownership_unit_id, resort = excluded.resort,
    check_in = excluded.check_in, check_out = excluded.check_out, room_type = excluded.room_type,
    confirmation_number = excluded.confirmation_number, status = excluded.status, adults = excluded.adults,
    minors = excluded.minors, rate_type = excluded.rate_type, total_cost = excluded.total_cost,
    amount_per_room = excluded.amount_per_room, notes = excluded.notes,
    benefit_grant_id = excluded.benefit_grant_id, benefit_quantity = excluded.benefit_quantity,
    voided_at = excluded.voided_at, voided_by = excluded.voided_by, void_reason = excluded.void_reason;

  for t in select x.* from public.benefit_transactions x
    where x.reservation_id = r.id and x.source_reference = 'reservation:' || r.id
      and x.status = 'approved' and x.transaction_type = 'use'
      and not exists (select 1 from public.benefit_transactions rev
        where rev.related_transaction_id = x.id and rev.transaction_type = 'reversal'
          and rev.status = 'approved')
  loop
    if g.id = t.benefit_grant_id and t.quantity_used = r.benefit_quantity
       and r.check_in = previous.check_in and t.economic_value = coalesce(r.total_cost, 0) then
      return r.id;
    end if;
    insert into public.benefit_transactions (membership_id, ownership_unit_id, benefit_grant_id,
      reservation_id, transaction_type, quantity_delta, effective_date, status, notes, source_reference, related_transaction_id)
    values (t.membership_id, t.ownership_unit_id, t.benefit_grant_id, r.id, 'reversal',
      -t.quantity_delta, t.effective_date, 'submitted', 'Reservation usage changed or cancelled', 'reservation-reversal', t.id)
    returning id into new_transaction;
    perform public.approve_benefit_transaction(new_transaction);
  end loop;
  if g.id is not null then
    insert into public.benefit_transactions (membership_id, ownership_unit_id, benefit_grant_id,
      reservation_id, transaction_type, quantity_used, quantity_delta, effective_date,
      economic_value, status, source_reference)
    values (r.membership_id, r.ownership_unit_id, r.benefit_grant_id, r.id, 'use',
      r.benefit_quantity, -r.benefit_quantity, posting_date, coalesce(r.total_cost, 0),
      'submitted', 'reservation:' || r.id)
    returning id into new_transaction;
    perform public.approve_benefit_transaction(new_transaction);
  end if;
  return r.id;
end;
$$;

revoke execute on function public.save_reservation(jsonb) from public, anon;
grant execute on function public.save_reservation(jsonb) to authenticated;

create table public.trip_plans (
  membership_id uuid primary key references public.memberships(id),
  plan jsonb not null check (jsonb_typeof(plan) = 'object')
);
alter table public.trip_plans enable row level security;
revoke all on public.trip_plans from anon, authenticated;
grant select, insert, update on public.trip_plans to authenticated;
create policy "Membership readers see trip plans" on public.trip_plans for select to authenticated
  using (public.user_has_membership_access(membership_id));
create policy "Membership admins save trip plans" on public.trip_plans for all to authenticated
  using (public.user_is_membership_admin(membership_id))
  with check (public.user_is_membership_admin(membership_id));

insert into public.trip_plans(membership_id, plan)
select id, '{
  "resort":"Moon Palace The Grand Cancun","check_in":"2027-12-26","check_out":"2028-01-02",
  "rate":"Preferential","benefit":"","quantity":0,"rooms":[
    {"party":"Room 1","unit":"","adults":2,"minors":3,"price":9961,"adultCharge":0,"minorCharge":0,"credits":0,"paid":0},
    {"party":"Room 2","unit":"","adults":2,"minors":3,"price":9961,"adultCharge":0,"minorCharge":0,"credits":0,"paid":0},
    {"party":"Room 3","unit":"","adults":2,"minors":0,"price":9961,"adultCharge":0,"minorCharge":0,"credits":0,"paid":0},
    {"party":"Room 4","unit":"","adults":2,"minors":0,"price":9961,"adultCharge":0,"minorCharge":0,"credits":0,"paid":0}
  ]}'::jsonb from public.memberships where contract_number = '4135905'
on conflict do nothing;

alter table public.benefit_grant_details
  add column verification_pending boolean not null default false;

update public.benefit_grant_details d set verification_pending = true
from public.benefit_grants g join public.memberships m on m.id = g.membership_id
where d.benefit_grant_id = g.id and g.benefit_code = 'incentive_stays'
  and m.contract_number = '4135905';

-- Validate the resulting unit positions after both legs of a transfer are
-- present. The grant lock serializes approvals on the same inventory.
create function public.check_unit_benefit_position()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  position numeric;
begin
  if new.status = 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    perform 1 from public.benefit_grants where id = new.benefit_grant_id for update;
    select coalesce((
      select a.allocated_quantity from public.benefit_unit_allocations a
      where a.benefit_grant_id = new.benefit_grant_id and a.ownership_unit_id = new.ownership_unit_id
    ), 0) + coalesce(sum(t.quantity_delta), 0) into position
    from public.benefit_transactions t
    where t.benefit_grant_id = new.benefit_grant_id and t.ownership_unit_id = new.ownership_unit_id
      and t.status = 'approved';
    if position < 0 then
      raise exception 'This transaction would overdraw the ownership-unit balance. Transfer an allocation to the unit first.'
        using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.check_unit_benefit_position() from public, anon;
create constraint trigger check_unit_benefit_position_trg
after insert or update on public.benefit_transactions
deferrable initially deferred for each row execute function public.check_unit_benefit_position();

-- Keep report date boundaries aligned with membership-local accounting.
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
  v_timezone text;
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
  select business_timezone into strict v_timezone
  from public.memberships where id = p_membership_id;

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
        'effective_date', business.business_date,
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
      order by business.business_date desc, t.created_at desc, t.id desc
    ),
    '[]'::jsonb
  )
  into v_benefit_usage
  from public.benefit_transactions t
    cross join lateral (select case
      when t.transaction_type = 'reversal' and t.source_reference is distinct from 'reservation-reversal'
        then timezone(v_timezone, t.created_at)::date
      else t.effective_date end as business_date) business
  join public.ownership_units ou on ou.id = t.ownership_unit_id
  join public.benefit_grants g on g.id = t.benefit_grant_id
  where t.membership_id = p_membership_id
    and business.business_date between v_from and v_to
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
    cross join lateral (select case
      when t.transaction_type = 'reversal' and t.source_reference is distinct from 'reservation-reversal'
        then timezone(v_timezone, t.created_at)::date
      else t.effective_date end as business_date) business
    join public.ownership_units ou on ou.id = t.ownership_unit_id
    join public.benefit_grants g on g.id = t.benefit_grant_id
    where t.membership_id = p_membership_id
      and business.business_date between v_from and v_to
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
    left join lateral (
      select person.preferred_name, person.first_name, person.last_name
      from public.people person
      where person.profile_id = a.actor_id and person.membership_id = a.membership_id
      order by person.archived_at nulls first, person.id limit 1
    ) p on true
    where a.membership_id = p_membership_id
      and a.created_at >= (v_from::timestamp at time zone v_timezone)
      and a.created_at < ((v_to + 1)::timestamp at time zone v_timezone);
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