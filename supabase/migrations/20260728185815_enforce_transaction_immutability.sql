-- Enforce valid benefit transaction lifecycle rules.
--
-- Rules:
--   1. Draft and submitted transactions may be edited.
--   2. Draft or submitted transactions may be approved.
--   3. Approved transactions may only transition to voided.
--   4. Accounting fields cannot change while an approved transaction is voided.
--   5. Voided transactions are permanently immutable.
--   6. Approval and void metadata must accompany the corresponding status.

create or replace function public.enforce_transaction_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  ---------------------------------------------------------------------------
  -- Voided transactions are final.
  ---------------------------------------------------------------------------
  if old.status = 'voided' then
    raise exception
      'Voided benefit transaction % is immutable.',
      old.id
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Approved transactions may only be changed by transitioning to voided.
  ---------------------------------------------------------------------------
  if old.status = 'approved' then
    if new.status <> 'voided' then
      raise exception
        'Approved benefit transaction % may only transition to voided.',
        old.id
        using errcode = 'P0001';
    end if;

    -------------------------------------------------------------------------
    -- Preserve the original accounting record while voiding.
    -------------------------------------------------------------------------
    if new.membership_id is distinct from old.membership_id
       or new.ownership_unit_id is distinct from old.ownership_unit_id
       or new.benefit_grant_id is distinct from old.benefit_grant_id
       or new.reservation_id is distinct from old.reservation_id
       or new.quantity_used is distinct from old.quantity_used
       or new.face_value is distinct from old.face_value
       or new.economic_value is distinct from old.economic_value
       or new.notes is distinct from old.notes
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception
        'Accounting fields on approved benefit transaction % cannot be changed while voiding.',
        old.id
        using errcode = 'P0001';
    end if;

    if new.voided_by is null then
      raise exception
        'Voiding benefit transaction % requires voided_by.',
        old.id
        using errcode = 'P0001';
    end if;

    if new.voided_at is null then
      raise exception
        'Voiding benefit transaction % requires voided_at.',
        old.id
        using errcode = 'P0001';
    end if;

    if nullif(btrim(new.void_reason), '') is null then
      raise exception
        'Voiding benefit transaction % requires a non-empty void_reason.',
        old.id
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  ---------------------------------------------------------------------------
  -- Only draft or submitted transactions may become approved.
  ---------------------------------------------------------------------------
  if new.status = 'approved' then
    if old.status not in ('draft', 'submitted') then
      raise exception
        'Benefit transaction % cannot transition from % to approved.',
        old.id,
        old.status
        using errcode = 'P0001';
    end if;

    if new.approved_by is null then
      raise exception
        'Approving benefit transaction % requires approved_by.',
        old.id
        using errcode = 'P0001';
    end if;

    if new.approved_at is null then
      raise exception
        'Approving benefit transaction % requires approved_at.',
        old.id
        using errcode = 'P0001';
    end if;

    if new.voided_by is not null
       or new.voided_at is not null
       or new.void_reason is not null then
      raise exception
        'Approval of benefit transaction % cannot include void metadata.',
        old.id
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  ---------------------------------------------------------------------------
  -- Draft or submitted transactions cannot skip approval and go directly
  -- to voided.
  ---------------------------------------------------------------------------
  if new.status = 'voided' then
    raise exception
      'Benefit transaction % must be approved before it can be voided.',
      old.id
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Approval metadata cannot be added before approval.
  ---------------------------------------------------------------------------
  if new.status in ('draft', 'submitted')
     and (
       new.approved_by is not null
       or new.approved_at is not null
       or new.voided_by is not null
       or new.voided_at is not null
       or new.void_reason is not null
     ) then
    raise exception
      'Draft or submitted benefit transaction % cannot contain approval or void metadata.',
      old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute
on function public.enforce_transaction_immutability()
from public;

create trigger enforce_transaction_immutability_trg
before update on public.benefit_transactions
for each row
execute function public.enforce_transaction_immutability();