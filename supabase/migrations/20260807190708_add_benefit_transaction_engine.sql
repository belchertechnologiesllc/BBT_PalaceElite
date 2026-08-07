-- Palace Elite: signed, append-only benefit transaction engine.
--
-- This migration extends the existing usage-only transaction table without
-- deleting or rewriting historical rows. Existing quantity_used rows are
-- backfilled to signed quantity_delta values so the current balance semantics
-- remain unchanged. New accounting events use explicit transaction types.
--
-- Shared and Golf eligibility continues to be enforced by
-- public.enforce_pool_eligibility(). Approved transaction payloads -- and now
-- draft/submitted payloads as well -- are immutable. Corrections and reversals
-- are represented by new linked rows rather than edits to the original event.

-- =============================================================================
-- 1. Transaction event type and signed ledger fields
-- =============================================================================

create type public.benefit_transaction_type as enum (
  'earn',
  'use',
  'adjustment',
  'transfer',
  'correction',
  'reversal',
  'import'
);

alter table public.benefit_transactions
  add column transaction_type public.benefit_transaction_type not null default 'use',
  add column quantity_delta numeric(12,2),
  add column effective_date date not null default current_date,
  add column source_reference text,
  add column related_transaction_id uuid,
  add column transaction_group_id uuid;

-- Preserve every existing usage transaction exactly: a positive quantity_used
-- becomes an equal negative signed delta.
update public.benefit_transactions
set quantity_delta = -quantity_used
where quantity_delta is null;

alter table public.benefit_transactions
  alter column quantity_delta set not null,
  alter column quantity_used drop not null,
  add constraint benefit_transactions_quantity_delta_nonzero_check
    check (quantity_delta <> 0),
  add constraint benefit_transactions_related_transaction_not_self_check
    check (related_transaction_id is null or related_transaction_id <> id),
  add constraint benefit_transactions_related_transaction_id_fkey
    foreign key (related_transaction_id)
    references public.benefit_transactions(id)
    on delete restrict;

comment on column public.benefit_transactions.transaction_type is
  'Accounting event type. Corrections and reversals are new linked events, never edits of the original accounting payload.';
comment on column public.benefit_transactions.quantity_delta is
  'Signed change to benefit inventory. Positive adds inventory; negative consumes inventory.';
comment on column public.benefit_transactions.quantity_used is
  'Compatibility field for use transactions. New accounting math is driven by quantity_delta.';
comment on column public.benefit_transactions.effective_date is
  'Business-effective date of the accounting event; may differ from created_at for historical imports.';
comment on column public.benefit_transactions.source_reference is
  'External or documentary source reference. Required for import transactions.';
comment on column public.benefit_transactions.related_transaction_id is
  'Original approved transaction referenced by a correction or reversal.';
comment on column public.benefit_transactions.transaction_group_id is
  'Atomic multi-leg event identifier, currently used for transfers and transfer reversals.';

create index benefit_transactions_membership_effective_date_idx
  on public.benefit_transactions (membership_id, effective_date desc, created_at desc);

create index benefit_transactions_related_transaction_id_idx
  on public.benefit_transactions (related_transaction_id)
  where related_transaction_id is not null;

create index benefit_transactions_transaction_group_id_idx
  on public.benefit_transactions (transaction_group_id)
  where transaction_group_id is not null;

create unique index benefit_transactions_one_active_reversal_idx
  on public.benefit_transactions (related_transaction_id)
  where transaction_type = 'reversal'
    and related_transaction_id is not null
    and voided_at is null;

-- =============================================================================
-- 2. Validate and normalize accounting payloads on INSERT
-- =============================================================================

create or replace function public.prepare_benefit_transaction_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_related public.benefit_transactions%rowtype;
begin
  -- Authenticated application callers cannot spoof actor identity or create an
  -- already-approved/voided event. Approval and voiding are lifecycle actions.
  if auth.uid() is not null then
    new.created_by := auth.uid();

    if new.status not in ('draft', 'submitted') then
      raise exception 'New benefit transactions must start as draft or submitted.'
        using errcode = '23514';
    end if;

    if new.transaction_type <> 'use'
       and not public.user_is_membership_admin(new.membership_id) then
      raise exception 'Only a membership administrator may create % transactions.', new.transaction_type
        using errcode = '42501';
    end if;
  end if;

  if new.status in ('draft', 'submitted')
     and (
       new.approved_by is not null
       or new.approved_at is not null
       or new.voided_by is not null
       or new.voided_at is not null
       or new.void_reason is not null
     ) then
    raise exception 'Draft or submitted benefit transactions cannot contain approval or void metadata.'
      using errcode = '23514';
  end if;

  -- Backward-compatible normalization for the original usage-only model.
  if new.transaction_type = 'use' then
    if new.quantity_delta is null and new.quantity_used is not null then
      new.quantity_delta := -new.quantity_used;
    elsif new.quantity_used is null and new.quantity_delta is not null then
      new.quantity_used := abs(new.quantity_delta);
    end if;

    if new.quantity_delta is null or new.quantity_delta >= 0 then
      raise exception 'Use transactions require a negative quantity_delta.'
        using errcode = '23514';
    end if;

    if new.quantity_used is null
       or new.quantity_used <= 0
       or new.quantity_delta <> -new.quantity_used then
      raise exception 'Use transactions require quantity_used to equal the absolute quantity_delta.'
        using errcode = '23514';
    end if;
  else
    if new.quantity_delta is null or new.quantity_delta = 0 then
      raise exception '% transactions require a non-zero quantity_delta.', new.transaction_type
        using errcode = '23514';
    end if;

    if new.quantity_used is not null then
      raise exception 'quantity_used is only valid for use transactions.'
        using errcode = '23514';
    end if;
  end if;

  if new.transaction_type = 'earn' and new.quantity_delta <= 0 then
    raise exception 'Earn transactions require a positive quantity_delta.'
      using errcode = '23514';
  end if;

  if new.transaction_type = 'import'
     and nullif(btrim(new.source_reference), '') is null then
    raise exception 'Import transactions require a source_reference.'
      using errcode = '23514';
  end if;

  if new.transaction_type in ('adjustment', 'correction', 'reversal')
     and nullif(btrim(new.notes), '') is null then
    raise exception '% transactions require a reason in notes.', new.transaction_type
      using errcode = '23514';
  end if;

  if new.transaction_type in ('correction', 'reversal') then
    if new.related_transaction_id is null then
      raise exception '% transactions require related_transaction_id.', new.transaction_type
        using errcode = '23514';
    end if;

    select *
      into v_related
    from public.benefit_transactions
    where id = new.related_transaction_id;

    if not found then
      raise exception 'Related benefit transaction % was not found.', new.related_transaction_id
        using errcode = '23503';
    end if;

    if v_related.status <> 'approved' or v_related.voided_at is not null then
      raise exception 'Corrections and reversals must reference an approved, non-voided transaction.'
        using errcode = '23514';
    end if;

    if new.membership_id <> v_related.membership_id
       or new.ownership_unit_id <> v_related.ownership_unit_id
       or new.benefit_grant_id <> v_related.benefit_grant_id
       or new.reservation_id is distinct from v_related.reservation_id then
      raise exception 'Correction/reversal scope must match the related transaction.'
        using errcode = '23514';
    end if;

    if new.transaction_type = 'correction'
       and v_related.transaction_type = 'transfer' then
      raise exception 'Transfer corrections must be handled by reversing the transfer and creating a replacement transfer.'
        using errcode = '23514';
    end if;

    if new.transaction_type = 'reversal' then
      if v_related.transaction_type = 'reversal' then
        raise exception 'A reversal cannot directly reverse another reversal.'
          using errcode = '23514';
      end if;

      if new.quantity_delta <> -v_related.quantity_delta then
        raise exception 'A reversal quantity_delta must exactly negate the related transaction.'
          using errcode = '23514';
      end if;
    end if;
  elsif new.related_transaction_id is not null then
    raise exception 'related_transaction_id is only valid for correction or reversal transactions.'
      using errcode = '23514';
  end if;

  if new.transaction_type = 'transfer' then
    if new.transaction_group_id is null then
      raise exception 'Transfer transactions require transaction_group_id.'
        using errcode = '23514';
    end if;
  elsif new.transaction_group_id is not null
        and new.transaction_type <> 'reversal' then
    raise exception 'transaction_group_id is only valid for transfer or grouped reversal transactions.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.prepare_benefit_transaction_insert() from public;

create trigger prepare_benefit_transaction_insert_trg
before insert on public.benefit_transactions
for each row
execute function public.prepare_benefit_transaction_insert();

-- =============================================================================
-- 3. Make the accounting payload append-only; only lifecycle metadata changes
-- =============================================================================

create or replace function public.enforce_transaction_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Once inserted, the accounting event itself never changes. A mistake is
  -- cancelled/voided and replaced; an approved mistake is corrected/reversed
  -- with a new linked transaction.
  if new.membership_id is distinct from old.membership_id
     or new.ownership_unit_id is distinct from old.ownership_unit_id
     or new.benefit_grant_id is distinct from old.benefit_grant_id
     or new.reservation_id is distinct from old.reservation_id
     or new.transaction_type is distinct from old.transaction_type
     or new.quantity_delta is distinct from old.quantity_delta
     or new.quantity_used is distinct from old.quantity_used
     or new.effective_date is distinct from old.effective_date
     or new.face_value is distinct from old.face_value
     or new.economic_value is distinct from old.economic_value
     or new.notes is distinct from old.notes
     or new.source_reference is distinct from old.source_reference
     or new.related_transaction_id is distinct from old.related_transaction_id
     or new.transaction_group_id is distinct from old.transaction_group_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Benefit transaction % accounting payload is immutable; void/cancel it and create a replacement event.', old.id
      using errcode = 'P0001';
  end if;

  if old.status = 'voided' then
    raise exception 'Voided benefit transaction % is immutable.', old.id
      using errcode = 'P0001';
  end if;

  if old.status = 'approved' and new.status <> 'voided' then
    raise exception 'Approved benefit transaction % may only transition to voided.', old.id
      using errcode = 'P0001';
  end if;

  if new.status = 'approved' then
    if old.status not in ('draft', 'submitted') then
      raise exception 'Benefit transaction % cannot transition from % to approved.', old.id, old.status
        using errcode = 'P0001';
    end if;

    if new.approved_by is null or new.approved_at is null then
      raise exception 'Approving benefit transaction % requires approved_by and approved_at.', old.id
        using errcode = 'P0001';
    end if;

    if auth.uid() is not null and new.approved_by <> auth.uid() then
      raise exception 'approved_by must be the authenticated administrator.'
        using errcode = '42501';
    end if;

    if new.voided_by is not null
       or new.voided_at is not null
       or new.void_reason is not null then
      raise exception 'Approval cannot include void metadata.'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if new.status = 'voided' then
    if old.status not in ('draft', 'submitted', 'approved') then
      raise exception 'Benefit transaction % cannot transition from % to voided.', old.id, old.status
        using errcode = 'P0001';
    end if;

    if new.voided_by is null
       or new.voided_at is null
       or nullif(btrim(new.void_reason), '') is null then
      raise exception 'Voiding/cancelling benefit transaction % requires voided_by, voided_at, and a non-empty void_reason.', old.id
        using errcode = 'P0001';
    end if;

    if auth.uid() is not null and new.voided_by <> auth.uid() then
      raise exception 'voided_by must be the authenticated administrator.'
        using errcode = '42501';
    end if;

    if old.status in ('draft', 'submitted')
       and (new.approved_by is not null or new.approved_at is not null) then
      raise exception 'Cancelling an unapproved transaction cannot add approval metadata.'
        using errcode = 'P0001';
    end if;

    if old.status = 'approved'
       and exists (
         select 1
         from public.benefit_transactions child
         where child.related_transaction_id = old.id
           and child.voided_at is null
       ) then
      raise exception 'Approved transaction % has an active correction/reversal and cannot be voided directly.', old.id
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if new.status not in ('draft', 'submitted') then
    raise exception 'Unsupported transaction status transition for benefit transaction %.', old.id
      using errcode = 'P0001';
  end if;

  if new.approved_by is not null
     or new.approved_at is not null
     or new.voided_by is not null
     or new.voided_at is not null
     or new.void_reason is not null then
    raise exception 'Draft or submitted benefit transaction % cannot contain approval or void metadata.', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_transaction_immutability() from public;

-- The trigger already exists from 20260728185815 and keeps its name/order;
-- CREATE OR REPLACE above updates its implementation in place.

-- =============================================================================
-- 4. Prevent benefit inventory from becoming negative on approval/void
-- =============================================================================

create or replace function public.enforce_benefit_transaction_balance()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_original numeric(12,2);
  v_other_delta numeric(12,2);
  v_result numeric(12,2);
begin
  -- Transfers (and grouped reversals of transfers) are double-entry events
  -- whose final grant-level delta is zero. Unit-level allocation constraints
  -- belong to the Accounting milestone; this trigger protects grant inventory.
  if new.transaction_type = 'transfer'
     or (new.transaction_type = 'reversal' and new.transaction_group_id is not null) then
    return new;
  end if;

  if (tg_op = 'INSERT' and new.status = 'approved')
     or (
       tg_op = 'UPDATE'
       and old.status <> 'approved'
       and new.status = 'approved'
     ) then
    select original_quantity
      into v_original
    from public.benefit_grants
    where id = new.benefit_grant_id
    for update;

    select coalesce(sum(t.quantity_delta), 0)
      into v_other_delta
    from public.benefit_transactions t
    where t.benefit_grant_id = new.benefit_grant_id
      and t.status = 'approved'
      and t.id <> new.id;

    v_result := v_original + v_other_delta + new.quantity_delta;

    if v_result < 0 then
      raise exception 'Approving benefit transaction % would overdraw benefit inventory (result: %).', new.id, v_result
        using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE'
        and old.status = 'approved'
        and new.status = 'voided'
        and old.quantity_delta > 0 then
    select original_quantity
      into v_original
    from public.benefit_grants
    where id = old.benefit_grant_id
    for update;

    select coalesce(sum(t.quantity_delta), 0)
      into v_other_delta
    from public.benefit_transactions t
    where t.benefit_grant_id = old.benefit_grant_id
      and t.status = 'approved'
      and t.id <> old.id;

    v_result := v_original + v_other_delta;

    if v_result < 0 then
      raise exception 'Voiding benefit transaction % would overdraw benefit inventory (result: %). Reverse dependent usage first.', old.id, v_result
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_benefit_transaction_balance() from public;

create trigger enforce_benefit_transaction_balance_trg
before insert or update on public.benefit_transactions
for each row
execute function public.enforce_benefit_transaction_balance();

-- =============================================================================
-- 5. Double-entry group integrity for transfers and transfer reversals
-- =============================================================================

create or replace function public.validate_benefit_transaction_group()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_memberships integer;
  v_grants integer;
  v_units integer;
  v_statuses integer;
  v_types integer;
  v_delta numeric(12,2);
begin
  if new.transaction_group_id is null then
    return null;
  end if;

  select
    count(*)::integer,
    count(distinct membership_id)::integer,
    count(distinct benefit_grant_id)::integer,
    count(distinct ownership_unit_id)::integer,
    count(distinct status)::integer,
    count(distinct transaction_type)::integer,
    coalesce(sum(quantity_delta), 0)
  into
    v_count,
    v_memberships,
    v_grants,
    v_units,
    v_statuses,
    v_types,
    v_delta
  from public.benefit_transactions
  where transaction_group_id = new.transaction_group_id;

  if v_count <> 2
     or v_memberships <> 1
     or v_grants <> 1
     or v_units <> 2
     or v_statuses <> 1
     or v_types <> 1
     or v_delta <> 0 then
    raise exception 'Transaction group % must contain exactly two same-status, same-benefit legs across two units whose signed deltas net to zero.', new.transaction_group_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.benefit_transactions t
    where t.transaction_group_id = new.transaction_group_id
      and t.transaction_type in ('transfer', 'reversal')
  ) then
    raise exception 'Transaction group % must represent a transfer or grouped reversal.', new.transaction_group_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function public.validate_benefit_transaction_group() from public;

create constraint trigger validate_benefit_transaction_group_trg
after insert or update on public.benefit_transactions
deferrable initially deferred
for each row
execute function public.validate_benefit_transaction_group();

-- =============================================================================
-- 6. Rebuild ledger-derived balance view using signed deltas
-- =============================================================================

create or replace view public.benefit_balances
with (security_invoker = true)
as
select
  g.id,
  g.membership_id,
  g.name,
  g.pool,
  g.quantity_kind,
  g.original_quantity,
  g.original_quantity
    + coalesce(
        sum(t.quantity_delta) filter (where t.status = 'approved'),
        0::numeric
      ) as remaining_quantity,
  g.release_date,
  g.expiration_date,
  g.restrictions,
  g.archived_at
from public.benefit_grants g
left join public.benefit_transactions t
  on t.benefit_grant_id = g.id
group by g.id;

revoke all on public.benefit_balances from anon;
grant select on public.benefit_balances to authenticated;

-- =============================================================================
-- 7. Authenticated lifecycle and atomic accounting functions
-- =============================================================================

create or replace function public.approve_benefit_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_transaction public.benefit_transactions%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select *
    into v_transaction
  from public.benefit_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Benefit transaction % was not found.', p_transaction_id
      using errcode = 'P0002';
  end if;

  if not public.user_is_membership_admin(v_transaction.membership_id) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;

  if v_transaction.status not in ('draft', 'submitted') then
    raise exception 'Benefit transaction % is not awaiting approval.', p_transaction_id
      using errcode = 'P0001';
  end if;

  if v_transaction.transaction_group_id is not null then
    update public.benefit_transactions
    set status = 'approved', approved_by = v_user, approved_at = now()
    where transaction_group_id = v_transaction.transaction_group_id;
  else
    update public.benefit_transactions
    set status = 'approved', approved_by = v_user, approved_at = now()
    where id = p_transaction_id;
  end if;
end;
$$;

revoke execute on function public.approve_benefit_transaction(uuid) from public, anon;
grant execute on function public.approve_benefit_transaction(uuid) to authenticated;

create or replace function public.void_benefit_transaction(
  p_transaction_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_transaction public.benefit_transactions%rowtype;
  v_user uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_user is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'A void/cancellation reason is required.' using errcode = '23514';
  end if;

  select *
    into v_transaction
  from public.benefit_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Benefit transaction % was not found.', p_transaction_id
      using errcode = 'P0002';
  end if;

  if not public.user_is_membership_admin(v_transaction.membership_id) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;

  if v_transaction.status = 'voided' then
    raise exception 'Benefit transaction % is already voided.', p_transaction_id
      using errcode = 'P0001';
  end if;

  if v_transaction.transaction_group_id is not null then
    update public.benefit_transactions
    set
      status = 'voided',
      voided_by = v_user,
      voided_at = now(),
      void_reason = v_reason
    where transaction_group_id = v_transaction.transaction_group_id;
  else
    update public.benefit_transactions
    set
      status = 'voided',
      voided_by = v_user,
      voided_at = now(),
      void_reason = v_reason
    where id = p_transaction_id;
  end if;
end;
$$;

revoke execute on function public.void_benefit_transaction(uuid, text) from public, anon;
grant execute on function public.void_benefit_transaction(uuid, text) to authenticated;

create or replace function public.create_benefit_transfer(
  p_membership_id uuid,
  p_benefit_grant_id uuid,
  p_from_ownership_unit_id uuid,
  p_to_ownership_unit_id uuid,
  p_quantity numeric,
  p_effective_date date default current_date,
  p_notes text default null,
  p_source_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_group_id uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.user_is_membership_admin(p_membership_id) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;

  if p_from_ownership_unit_id = p_to_ownership_unit_id then
    raise exception 'Transfer source and destination ownership units must be different.'
      using errcode = '23514';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Transfer quantity must be greater than zero.' using errcode = '23514';
  end if;

  insert into public.benefit_transactions (
    membership_id,
    ownership_unit_id,
    benefit_grant_id,
    transaction_type,
    quantity_delta,
    effective_date,
    status,
    notes,
    source_reference,
    transaction_group_id,
    created_by
  )
  values
  (
    p_membership_id,
    p_from_ownership_unit_id,
    p_benefit_grant_id,
    'transfer',
    -p_quantity,
    coalesce(p_effective_date, current_date),
    'submitted',
    p_notes,
    nullif(btrim(p_source_reference), ''),
    v_group_id,
    v_user
  ),
  (
    p_membership_id,
    p_to_ownership_unit_id,
    p_benefit_grant_id,
    'transfer',
    p_quantity,
    coalesce(p_effective_date, current_date),
    'submitted',
    p_notes,
    nullif(btrim(p_source_reference), ''),
    v_group_id,
    v_user
  );

  return v_group_id;
end;
$$;

revoke execute on function public.create_benefit_transfer(uuid, uuid, uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function public.create_benefit_transfer(uuid, uuid, uuid, uuid, numeric, date, text, text) to authenticated;

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
        current_date,
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
      current_date,
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

revoke execute on function public.create_benefit_reversal(uuid, text, text) from public, anon;
grant execute on function public.create_benefit_reversal(uuid, text, text) to authenticated;
