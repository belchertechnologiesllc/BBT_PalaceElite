-- Extend the two existing pool-eligibility guard functions so Shared
-- participation is enforced with the same rigor as Golf participation,
-- now that ownership_units.participates_in_shared_pool exists.
--
-- Membership-consistency review (documented per repository convention
-- rather than adding redundant checks):
--
--   public.benefit_transactions already carries two composite foreign keys
--   -- foreign key (membership_id, ownership_unit_id)
--       references public.ownership_units (membership_id, id)
--   -- foreign key (membership_id, benefit_grant_id)
--       references public.benefit_grants (membership_id, id)
--   (see 20260728033000_initial_schema.sql). Because these are ordinary
--   (non-deferrable) foreign keys, no benefit_transactions row can ever be
--   persisted whose ownership_unit_id or benefit_grant_id belongs to a
--   different membership than the transaction's own membership_id -- any
--   attempt is rejected by the constraint and the whole statement aborts.
--   public.enforce_pool_eligibility() therefore does not need its own
--   membership_id cross-check; the two lookups below (grant pool, unit
--   participation flags) are already guaranteed to be membership-consistent
--   by the time this trigger runs. No gap was found, so none is added here.
--
--   public.enforce_people_pool_eligibility() is a different case: people
--   are not tied to their ownership unit by a composite foreign key against
--   membership_id (public.people only has a composite foreign key
--   guaranteeing membership_id/ownership_unit_id consistency, same pattern
--   as above -- see 20260728203144_add_people.sql), and its existing
--   membership_id match in the WHERE clause (carried over unchanged below)
--   is already sufficient defense-in-depth that predates this migration;
--   it is preserved as-is, not added by this change.

create or replace function public.enforce_people_pool_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_unit_golf_eligible boolean;
  v_unit_shared_eligible boolean;
begin
  select ou.participates_in_golf_pool, ou.participates_in_shared_pool
    into v_unit_golf_eligible, v_unit_shared_eligible
  from public.ownership_units ou
  where ou.id = new.ownership_unit_id
    and ou.membership_id = new.membership_id;

  if not found then
    raise exception
      'Ownership unit % does not belong to membership %.',
      new.ownership_unit_id,
      new.membership_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.participates_in_golf_pool
     and coalesce(v_unit_golf_eligible, false) = false then
    raise exception
      'Person cannot participate in the golf pool because ownership unit % is not golf eligible.',
      new.ownership_unit_id
      using errcode = 'check_violation';
  end if;

  if new.participates_in_shared_pool
     and coalesce(v_unit_shared_eligible, false) = false then
    raise exception
      'Person cannot participate in the shared pool because ownership unit % is not shared-pool eligible.',
      new.ownership_unit_id
      using errcode = 'check_violation';
  end if;

  if new.archived_at is not null then
    new.is_active := false;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_people_pool_eligibility() from public;

-- public.enforce_pool_eligibility() is attached to public.benefit_transactions
-- via enforce_pool_eligibility_trg (created in 20260728033000_initial_schema.sql,
-- unchanged by this migration). CREATE OR REPLACE below preserves that
-- attachment automatically.

create or replace function public.enforce_pool_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_pool public.benefit_pool;
  v_unit_golf_eligible boolean;
  v_unit_shared_eligible boolean;
begin
  select pool into v_pool
  from public.benefit_grants
  where id = new.benefit_grant_id;

  select participates_in_golf_pool, participates_in_shared_pool
    into v_unit_golf_eligible, v_unit_shared_eligible
  from public.ownership_units
  where id = new.ownership_unit_id;

  if v_pool = 'golf' and coalesce(v_unit_golf_eligible, false) = false then
    raise exception 'Ownership unit % does not participate in the golf benefit pool', new.ownership_unit_id
      using errcode = 'check_violation';
  end if;

  if v_pool = 'shared' and coalesce(v_unit_shared_eligible, false) = false then
    raise exception 'Ownership unit % does not participate in the shared benefit pool', new.ownership_unit_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_pool_eligibility() from public;
