-- Palace Elite: use membership-local business dates for reversals and historical accounting.
--
-- Supabase/Postgres runs in UTC. A reversal created after 7 PM Central could
-- therefore receive tomorrow's `current_date`, while the user still considers
-- the activity part of the current business day. This migration gives each
-- membership a canonical IANA timezone, uses it for new reversal dates, and
-- evaluates approval/void timestamps in that same timezone for historical
-- accounting snapshots.

alter table public.memberships
  add column if not exists business_timezone text;

update public.memberships
set business_timezone = 'America/Chicago'
where business_timezone is null;

alter table public.memberships
  alter column business_timezone set default 'America/Chicago',
  alter column business_timezone set not null;

comment on column public.memberships.business_timezone is
  'Canonical IANA timezone used to derive membership business dates from timestamps.';

create or replace function public.get_benefit_unit_balances_as_of(
  p_membership_id uuid,
  p_as_of date
)
returns table(
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
  join public.memberships m on m.id = a.membership_id
  left join public.benefit_transactions t
    on t.benefit_grant_id = a.benefit_grant_id
   and t.ownership_unit_id = a.ownership_unit_id
   and t.effective_date <= p_as_of
   and t.approved_at is not null
   and timezone(m.business_timezone, t.approved_at)::date <= p_as_of
   and (
     t.voided_at is null
     or timezone(m.business_timezone, t.voided_at)::date > p_as_of
   )
  where a.membership_id = p_membership_id
    and g.archived_at is null
    and public.user_has_membership_access(p_membership_id)
  group by a.id, g.id, ou.id, m.id
  order by g.pool, g.name, ou.name;
$$;

comment on function public.get_benefit_unit_balances_as_of(uuid, date) is
  'Returns ownership-unit benefit positions as of a membership-local business date using append-only approved ledger activity.';

create or replace function public.create_benefit_reversal(
  p_transaction_id uuid,
  p_reason text,
  p_source_reference text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source public.benefit_transactions%rowtype;
  v_leg public.benefit_transactions%rowtype;
  v_user uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_reversal_group uuid;
  v_business_timezone text;
  v_business_date date;
begin
  if v_user is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'A reversal reason is required.' using errcode = '23514';
  end if;

  select *
    into v_source
  from public.benefit_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Benefit transaction % was not found.', p_transaction_id
      using errcode = 'P0002';
  end if;

  if not public.user_is_membership_admin(v_source.membership_id) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;

  select m.business_timezone
    into v_business_timezone
  from public.memberships m
  where m.id = v_source.membership_id;

  if v_business_timezone is null then
    raise exception 'Membership business timezone is not configured.' using errcode = '23514';
  end if;

  v_business_date := timezone(v_business_timezone, now())::date;

  if v_source.status <> 'approved' or v_source.voided_at is not null then
    raise exception 'Only an approved, non-voided transaction can be reversed.'
      using errcode = '23514';
  end if;

  if v_source.transaction_type = 'reversal' then
    raise exception 'A reversal cannot directly reverse another reversal.'
      using errcode = '23514';
  end if;

  if v_source.transaction_type = 'transfer' then
    if v_source.transaction_group_id is null then
      raise exception 'Transfer transaction % is missing its transaction group.', p_transaction_id
        using errcode = '23514';
    end if;

    v_reversal_group := gen_random_uuid();

    for v_leg in
      select *
      from public.benefit_transactions
      where transaction_group_id = v_source.transaction_group_id
      order by id
      for update
    loop
      if v_leg.status <> 'approved' or v_leg.voided_at is not null then
        raise exception 'Every transfer leg must be approved and non-voided before reversal.'
          using errcode = '23514';
      end if;

      insert into public.benefit_transactions (
        membership_id,
        ownership_unit_id,
        benefit_grant_id,
        reservation_id,
        transaction_type,
        quantity_delta,
        effective_date,
        face_value,
        economic_value,
        status,
        notes,
        source_reference,
        related_transaction_id,
        transaction_group_id,
        created_by
      ) values (
        v_leg.membership_id,
        v_leg.ownership_unit_id,
        v_leg.benefit_grant_id,
        v_leg.reservation_id,
        'reversal',
        -v_leg.quantity_delta,
        v_business_date,
        v_leg.face_value,
        v_leg.economic_value,
        'submitted',
        v_reason,
        nullif(btrim(p_source_reference), ''),
        v_leg.id,
        v_reversal_group,
        v_user
      );
    end loop;
  else
    insert into public.benefit_transactions (
      membership_id,
      ownership_unit_id,
      benefit_grant_id,
      reservation_id,
      transaction_type,
      quantity_delta,
      effective_date,
      face_value,
      economic_value,
      status,
      notes,
      source_reference,
      related_transaction_id,
      created_by
    ) values (
      v_source.membership_id,
      v_source.ownership_unit_id,
      v_source.benefit_grant_id,
      v_source.reservation_id,
      'reversal',
      -v_source.quantity_delta,
      v_business_date,
      v_source.face_value,
      v_source.economic_value,
      'submitted',
      v_reason,
      nullif(btrim(p_source_reference), ''),
      v_source.id,
      v_user
    );
  end if;
end;
$$;

revoke execute on function public.create_benefit_reversal(uuid, text, text)
  from public, anon;
grant execute on function public.create_benefit_reversal(uuid, text, text)
  to authenticated;

comment on function public.create_benefit_reversal(uuid, text, text) is
  'Creates an append-only reversal using the membership business timezone for effective_date.';

-- Repair pre-fix reversal rows whose effective_date was generated from UTC
-- `current_date`. The update is narrowly limited to reversals where the stored
-- date exactly equals the UTC creation date and differs from the membership's
-- local creation date. The normal audit trigger remains enabled, so every
-- repaired row gets a before/after audit event. Only the immutability guard is
-- suspended for this one-time metadata repair.
alter table public.benefit_transactions
  disable trigger enforce_transaction_immutability_trg;

update public.benefit_transactions t
set effective_date = timezone(m.business_timezone, t.created_at)::date
from public.memberships m
where m.id = t.membership_id
  and t.transaction_type = 'reversal'
  and t.effective_date = t.created_at::date
  and t.effective_date <> timezone(m.business_timezone, t.created_at)::date;

alter table public.benefit_transactions
  enable trigger enforce_transaction_immutability_trg;
