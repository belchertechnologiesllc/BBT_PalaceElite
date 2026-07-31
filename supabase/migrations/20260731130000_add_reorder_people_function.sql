-- Step 2 of "Order members within ownership units"
-- (see docs/proposals/order-members-within-ownership-units.md).
--
-- Adds the atomic reorder function. public.people already has a full
-- UPDATE policy/grant for authenticated ("membership admins can update
-- people" in 20260728203144_add_people.sql), so this function is not
-- closing an authorization gap the way the ownership_units UPDATE
-- migration did -- its purpose is atomicity (the whole sequence commits
-- or none of it does, surviving a client network failure mid-request)
-- and stronger validation than per-row updates could enforce on their
-- own (rejecting missing, duplicated, cross-unit, inactive, or archived
-- ids as a single check, rather than trusting the caller's array).

create or replace function public.reorder_people_within_ownership_unit(
  p_ownership_unit_id uuid,
  p_person_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_supplied_count integer;
  v_distinct_supplied_count integer;
  v_expected_ids uuid[];
begin
  if p_ownership_unit_id is null then
    raise exception 'p_ownership_unit_id is required';
  end if;

  v_supplied_count := coalesce(array_length(p_person_ids, 1), 0);

  if v_supplied_count = 0 then
    raise exception 'p_person_ids must contain at least one person id';
  end if;

  select count(distinct id)
    into v_distinct_supplied_count
  from unnest(p_person_ids) as id;

  if v_distinct_supplied_count <> v_supplied_count then
    raise exception 'p_person_ids contains duplicate person ids'
      using errcode = 'check_violation';
  end if;

  -- The unit must exist and not be archived; archived units are out of
  -- scope for this first Ownership Administration increment.
  select ou.membership_id
    into v_membership_id
  from public.ownership_units ou
  where ou.id = p_ownership_unit_id
    and ou.archived_at is null;

  if v_membership_id is null then
    raise exception 'Ownership unit % was not found or is archived', p_ownership_unit_id
      using errcode = 'foreign_key_violation';
  end if;

  if not public.user_is_membership_admin(v_membership_id) then
    raise exception 'Membership administrator access is required'
      using errcode = 'insufficient_privilege';
  end if;

  -- p_person_ids must be exactly the set of active, non-archived people
  -- currently assigned to this unit -- no fewer (a partial reorder would
  -- leave stragglers with stale positions), no more, and nothing
  -- inactive, archived, or from a different unit/membership.
  select array_agg(p.id)
    into v_expected_ids
  from public.people p
  where p.ownership_unit_id = p_ownership_unit_id
    and p.membership_id = v_membership_id
    and p.archived_at is null
    and p.is_active = true;

  if v_expected_ids is null then
    v_expected_ids := array[]::uuid[];
  end if;

  if (
    select array_agg(id order by id) from unnest(p_person_ids) as id
  ) is distinct from (
    select array_agg(id order by id) from unnest(v_expected_ids) as id
  ) then
    raise exception
      'p_person_ids must contain exactly the active people currently assigned to ownership unit % -- no missing, extra, inactive, archived, or cross-unit ids',
      p_ownership_unit_id
      using errcode = 'check_violation';
  end if;

  update public.people as p
  set display_order = ord.position - 1
  from unnest(p_person_ids) with ordinality as ord(person_id, position)
  where p.id = ord.person_id;
end;
$$;

revoke execute
on function public.reorder_people_within_ownership_unit(uuid, uuid[])
from public;

grant execute
on function public.reorder_people_within_ownership_unit(uuid, uuid[])
to authenticated;
