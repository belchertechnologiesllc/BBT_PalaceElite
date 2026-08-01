-- Stable, machine-readable benefit identification: benefit_grants.benefit_code.
--
-- The merged Add Benefit workflow (src/services/benefitsService.ts,
-- createBenefitGrant) does not supply benefit_code, so this column cannot be
-- NOT NULL without a default -- doing so would break that already-shipped
-- workflow. A database-generated default keeps every future custom benefit
-- working without any UI/service change, while the seven known grants in the
-- one seeded membership are immediately overridden with their approved
-- semantic codes below.
--
-- The default is evaluated once per row at INSERT time only (a plain column
-- DEFAULT, not a trigger), so a value is stable after insertion and never
-- recalculated on UPDATE.

alter table public.benefit_grants
  add column benefit_code text
  default ('custom_' || replace(gen_random_uuid()::text, '-', ''));

comment on column public.benefit_grants.benefit_code is
  'Stable, machine-readable identifier. Unique per membership, not globally (see benefit_grants_membership_id_benefit_code_key). Custom benefits receive a generated custom_<uuid> value; the seven known launch benefits use approved semantic codes (see the membership-scoped backfill below). Never derive this from the mutable name column at runtime.';

-- =============================================================================
-- Membership-scoped semantic backfill
-- =============================================================================
--
-- Matches by (membership_id, name), not by name alone: a future membership
-- could legitimately contain grants with the same display names (e.g. its
-- own "BPG Weeks"), and this backfill must never touch those. A
-- migration-local DO block (rather than a permanent function) performs the
-- match-and-verify logic, since its only purpose is this one-time backfill --
-- nothing at runtime needs to call it again, so nothing permanent should
-- remain in the schema for it.
--
-- `select ... into strict` is used to locate the target membership: it
-- raises NO_DATA_FOUND if zero memberships qualify and TOO_MANY_ROWS if more
-- than one does, which are caught below and re-raised with clearer
-- messages. A qualifying membership must have exactly 7 grants whose name is
-- one of the 7 expected names, with exactly 7 distinct names among them --
-- this simultaneously rejects a membership missing one of the expected
-- names (count(*) < 7) and a membership with a duplicate of one of the
-- expected names (count(*) > count(distinct name), so count(*) <> 7 unless
-- some other expected name is also missing, which would itself already
-- disqualify it since only exactly 7 total rows are matched here).
--
-- After the backfill, the exact-count verification query below re-checks
-- that precisely 7 rows in the target membership now carry one of the 7
-- approved codes, before the column is finalized as NOT NULL + unique.

do $$
declare
  v_membership_id uuid;
  v_final_count integer;
  v_expected_names constant text[] := array[
    'BPG Weeks',
    'Incentive Stays',
    'Imperial Grand Weeks',
    'Spa Resort Credit',
    'Universal Credit',
    'Golf Rounds at 50%',
    'Unlimited Golf Bonus Nights'
  ];
begin
  begin
    select g.membership_id
    into strict v_membership_id
    from public.benefit_grants g
    where g.name = any(v_expected_names)
    group by g.membership_id
    having count(*) = 7
      and count(distinct g.name) = 7;
  exception
    when no_data_found then
      raise exception
        'benefit_code backfill: no membership was found with exactly the seven expected benefit grant names (no duplicates, none missing). Aborting; no benefit_code value was changed.'
        using errcode = 'P0001';
    when too_many_rows then
      raise exception
        'benefit_code backfill: more than one membership matched all seven expected benefit grant names; expected exactly one target membership. Aborting; no benefit_code value was changed.'
        using errcode = 'P0001';
  end;

  update public.benefit_grants
    set benefit_code = 'bpg_weeks'
    where membership_id = v_membership_id and name = 'BPG Weeks';
  update public.benefit_grants
    set benefit_code = 'incentive_stays'
    where membership_id = v_membership_id and name = 'Incentive Stays';
  update public.benefit_grants
    set benefit_code = 'imperial_grand_weeks'
    where membership_id = v_membership_id and name = 'Imperial Grand Weeks';
  update public.benefit_grants
    set benefit_code = 'spa_resort_credit'
    where membership_id = v_membership_id and name = 'Spa Resort Credit';
  update public.benefit_grants
    set benefit_code = 'universal_credit'
    where membership_id = v_membership_id and name = 'Universal Credit';
  update public.benefit_grants
    set benefit_code = 'golf_rounds_50'
    where membership_id = v_membership_id and name = 'Golf Rounds at 50%';
  update public.benefit_grants
    set benefit_code = 'unlimited_golf_bonus_nights'
    where membership_id = v_membership_id and name = 'Unlimited Golf Bonus Nights';

  select count(*)
  into v_final_count
  from public.benefit_grants
  where membership_id = v_membership_id
    and benefit_code in (
      'bpg_weeks', 'incentive_stays', 'imperial_grand_weeks',
      'spa_resort_credit', 'universal_credit', 'golf_rounds_50',
      'unlimited_golf_bonus_nights'
    );

  if v_final_count <> 7 then
    raise exception
      'benefit_code backfill: expected exactly 7 rows to carry an approved semantic benefit_code in membership %, found %. Aborting.',
      v_membership_id, v_final_count
      using errcode = 'P0001';
  end if;
end;
$$;

-- =============================================================================
-- Finalize the column
-- =============================================================================

alter table public.benefit_grants
  alter column benefit_code set not null;

alter table public.benefit_grants
  add constraint benefit_grants_membership_id_benefit_code_key
  unique (membership_id, benefit_code);
