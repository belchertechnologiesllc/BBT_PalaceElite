-- Protect benefit_grants accounting semantics once any benefit_transactions
-- row references the grant, and protect created_at unconditionally.
--
-- reservations does not reference benefit_grants at all (it has no
-- benefit_grant_id column -- see 20260728033000_initial_schema.sql), so it
-- cannot independently lock any benefit_grants field; only
-- public.benefit_transactions.benefit_grant_id is checked below. Every
-- transaction status (draft, submitted, approved, voided) counts as a
-- reference: even a draft or voided row is a real historical record whose
-- accounting meaning (what pool, unit, or quantity_kind it was recorded
-- against) must never be rewritten retroactively.
--
-- created_at is immutable on every update regardless of whether the grant
-- has been referenced, since it is never legitimately changed by any
-- workflow.
--
-- name, restrictions, archived_at, and archived_reason remain editable at
-- all times so administrative correction and archival stay possible; they
-- continue to be captured by the existing benefit_grants_audit_trg
-- (unchanged by this migration).

create or replace function public.enforce_benefit_grant_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_has_transactions boolean;
begin
  if new.created_at is distinct from old.created_at then
    raise exception
      'created_at on benefit grant % is immutable.',
      old.id
      using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.benefit_transactions
    where benefit_grant_id = old.id
  ) into v_has_transactions;

  if v_has_transactions
     and (
       new.membership_id     is distinct from old.membership_id
       or new.pool            is distinct from old.pool
       or new.quantity_kind   is distinct from old.quantity_kind
       or new.original_quantity is distinct from old.original_quantity
       or new.release_date    is distinct from old.release_date
       or new.expiration_date is distinct from old.expiration_date
     ) then
    raise exception
      'Benefit grant % has recorded transactions; membership_id, pool, quantity_kind, original_quantity, release_date, and expiration_date cannot be changed. Edit name, restrictions, or archival status instead.',
      old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_benefit_grant_immutability() from public;

create trigger enforce_benefit_grant_immutability_trg
before update on public.benefit_grants
for each row execute function public.enforce_benefit_grant_immutability();
