begin;

create extension if not exists pgtap with schema extensions;

select plan(84);

-- =============================================================================
-- Test helper: return true when a SQL statement raises any exception.
-- =============================================================================

create or replace function pg_temp.statement_raises(p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return true;
end;
$$;

-- =============================================================================
-- Stable IDs used only inside this rolled-back test transaction.
-- =============================================================================

create temporary table test_ids (
  key text primary key,
  value uuid not null
);

insert into test_ids (key, value)
values
  ('admin_user',       '00000000-0000-0000-0000-000000000001'),
  ('contributor_user', '00000000-0000-0000-0000-000000000002'),
  ('viewer_user',      '00000000-0000-0000-0000-000000000003'),
  ('outsider_user',    '00000000-0000-0000-0000-000000000004');

-- =============================================================================
-- Create test Auth users.
--
-- The migration's auth.users trigger should create public.profiles rows.
-- =============================================================================

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values
(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'admin-test@example.invalid',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Test Admin"}'::jsonb
),
(
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'contributor-test@example.invalid',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Test Contributor"}'::jsonb
),
(
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'viewer-test@example.invalid',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Test Viewer"}'::jsonb
),
(
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'outsider-test@example.invalid',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Test Outsider"}'::jsonb
);

select is(
  (
    select count(*)::integer
    from public.profiles
    where id in (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004'
    )
  ),
  4,
  'Auth-user trigger creates four profile rows'
);

-- =============================================================================
-- Locate the migration's seeded membership, units, and benefit grants.
-- =============================================================================

insert into test_ids (key, value)
select 'membership', id
from public.memberships
where contract_number = '4135905';

insert into test_ids (key, value)
select 'belcher_unit', id
from public.ownership_units
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Belcher';

insert into test_ids (key, value)
select 'belcher_sr_unit', id
from public.ownership_units
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Belcher Sr.';

insert into test_ids (key, value)
select 'tatro_unit', id
from public.ownership_units
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Tatro';

insert into test_ids (key, value)
select 'shared_grant', id
from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and pool = 'shared'
order by created_at
limit 1;

insert into test_ids (key, value)
select 'golf_grant', id
from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and pool = 'golf'
order by created_at
limit 1;

-- Captured here, before any test below renames a grant (see "Referenced
-- grant still permits name changes"), so the STEP-4 semantic-code-identity
-- assertions can verify each approved code attached to the correct grant
-- without relying on the (deliberately mutable) name column at assertion
-- time.
insert into test_ids (key, value)
select 'code_bpg_weeks_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'BPG Weeks';

insert into test_ids (key, value)
select 'code_incentive_stays_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Incentive Stays';

insert into test_ids (key, value)
select 'code_imperial_grand_weeks_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Imperial Grand Weeks';

insert into test_ids (key, value)
select 'code_spa_resort_credit_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Spa Resort Credit';

insert into test_ids (key, value)
select 'code_universal_credit_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Universal Credit';

insert into test_ids (key, value)
select 'code_golf_rounds_50_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Golf Rounds at 50%';

insert into test_ids (key, value)
select 'code_unlimited_golf_bonus_nights_id', id from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and name = 'Unlimited Golf Bonus Nights';

select ok(
  (select count(*) = 7 from test_ids where key in (
    'membership',
    'belcher_unit',
    'belcher_sr_unit',
    'tatro_unit',
    'shared_grant',
    'golf_grant',
    'admin_user'
  )),
  'Required seeded membership, units, and grants exist'
);

-- =============================================================================
-- Assign application roles.
-- =============================================================================

insert into public.unit_users (ownership_unit_id, user_id, role)
values
(
  (select value from test_ids where key = 'belcher_unit'),
  (select value from test_ids where key = 'admin_user'),
  'admin'
),
(
  (select value from test_ids where key = 'belcher_unit'),
  (select value from test_ids where key = 'contributor_user'),
  'contributor'
),
(
  (select value from test_ids where key = 'belcher_unit'),
  (select value from test_ids where key = 'viewer_user'),
  'viewer'
);

-- =============================================================================
-- Reservation and shared-benefit transaction.
-- =============================================================================

insert into public.reservations (
  membership_id,
  ownership_unit_id,
  resort,
  check_in,
  check_out,
  created_by
)
values (
  (select value from test_ids where key = 'membership'),
  (select value from test_ids where key = 'belcher_unit'),
  'Test Resort',
  current_date + 30,
  current_date + 37,
  (select value from test_ids where key = 'contributor_user')
)
returning id;

insert into test_ids (key, value)
select 'reservation', id
from public.reservations
where resort = 'Test Resort'
order by created_at desc
limit 1;

insert into public.benefit_transactions (
  membership_id,
  ownership_unit_id,
  benefit_grant_id,
  reservation_id,
  quantity_used,
  status,
  notes,
  created_by
)
values (
  (select value from test_ids where key = 'membership'),
  (select value from test_ids where key = 'belcher_unit'),
  (select value from test_ids where key = 'shared_grant'),
  (select value from test_ids where key = 'reservation'),
  1,
  'draft',
  'Runtime-test draft',
  (select value from test_ids where key = 'contributor_user')
);

insert into test_ids (key, value)
select 'transaction', id
from public.benefit_transactions
where notes = 'Runtime-test draft'
order by created_at desc
limit 1;

select ok(
  exists (
    select 1
    from public.benefit_transactions
    where id = (select value from test_ids where key = 'transaction')
      and status = 'draft'
  ),
  'Draft transaction can be created'
);

-- =============================================================================
-- Golf-pool separation.
-- Tatro must be rejected; Belcher must be accepted.
-- =============================================================================

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.benefit_transactions (
        membership_id,
        ownership_unit_id,
        benefit_grant_id,
        quantity_used,
        status,
        notes
      )
      values (%L, %L, %L, 1, 'draft', 'Tatro golf rejection test')
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'tatro_unit'),
    (select value from test_ids where key = 'golf_grant')
  )),
  'Tatro cannot consume a golf-pool benefit'
);

select lives_ok(
  format(
    $sql$
      insert into public.benefit_transactions (
        membership_id,
        ownership_unit_id,
        benefit_grant_id,
        quantity_used,
        status,
        notes
      )
      values (%L, %L, %L, 1, 'draft', 'Belcher golf acceptance test')
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'belcher_unit'),
    (select value from test_ids where key = 'golf_grant')
  ),
  'Belcher can consume a golf-pool benefit'
);

-- =============================================================================
-- Approval behavior.
-- =============================================================================

update public.benefit_transactions
set
  status = 'approved',
  approved_by = (select value from test_ids where key = 'admin_user'),
  approved_at = now()
where id = (select value from test_ids where key = 'transaction');

select is(
  (
    select status::text
    from public.benefit_transactions
    where id = (select value from test_ids where key = 'transaction')
  ),
  'approved',
  'Draft transaction can be approved'
);

select ok(
  exists (
    select 1
    from public.audit_log
    where entity_type = 'benefit_transactions'
      and entity_id = (select value from test_ids where key = 'transaction')
      and action = 'APPROVE'
  ),
  'Approval creates an APPROVE audit entry'
);

-- This should fail in a hardened accounting ledger.
-- Based on the current trigger list, it may currently succeed and fail this test.
select ok(
  pg_temp.statement_raises(format(
    $sql$
      update public.benefit_transactions
      set quantity_used = 2
      where id = %L
    $sql$,
    (select value from test_ids where key = 'transaction')
  )),
  'Approved transaction accounting fields are immutable'
);

-- =============================================================================
-- Voiding behavior.
-- =============================================================================

update public.benefit_transactions
set
  status = 'voided',
  voided_by = (select value from test_ids where key = 'admin_user'),
  voided_at = now(),
  void_reason = 'Runtime validation'
where id = (select value from test_ids where key = 'transaction');

select is(
  (
    select status::text
    from public.benefit_transactions
    where id = (select value from test_ids where key = 'transaction')
  ),
  'voided',
  'Approved transaction can be voided'
);

select ok(
  exists (
    select 1
    from public.audit_log
    where entity_type = 'benefit_transactions'
      and entity_id = (select value from test_ids where key = 'transaction')
      and action = 'VOID'
  ),
  'Voiding creates a VOID audit entry'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      update public.benefit_transactions
      set notes = 'This modification should be blocked'
      where id = %L
    $sql$,
    (select value from test_ids where key = 'transaction')
  )),
  'Voided transaction is immutable'
);

-- =============================================================================
-- Hard-delete and audit-log protections.
-- =============================================================================

select ok(
  pg_temp.statement_raises(format(
    'delete from public.benefit_transactions where id = %L',
    (select value from test_ids where key = 'transaction')
  )),
  'Hard delete of a benefit transaction is blocked'
);

select ok(
  pg_temp.statement_raises(format(
    'delete from public.reservations where id = %L',
    (select value from test_ids where key = 'reservation')
  )),
  'Hard delete of a reservation is blocked'
);

select ok(
  pg_temp.statement_raises(
    'update public.audit_log set action = ''TAMPERED'' where id = (select min(id) from public.audit_log)'
  ),
  'Audit-log UPDATE is blocked'
);

select ok(
  pg_temp.statement_raises(
    'delete from public.audit_log where id = (select min(id) from public.audit_log)'
  ),
  'Audit-log DELETE is blocked'
);

-- =============================================================================
-- Balance calculation.
--
-- The transaction was voided, so it must not reduce the remaining quantity.
-- =============================================================================

select is(
  (
    select remaining_quantity
    from public.benefit_balances
    where id = (select value from test_ids where key = 'shared_grant')
  ),
  (
    select original_quantity
    from public.benefit_grants
    where id = (select value from test_ids where key = 'shared_grant')
  ),
  'Voided transactions do not reduce benefit balances'
);

-- =============================================================================
-- Shared-pool eligibility (ISSUE-10 / STEP-3).
--
-- Golf-pool separation at the transaction level (Tatro rejected, Belcher
-- accepted, using shared_grant against belcher_unit and golf_grant against
-- belcher_unit) is already exercised above by the "Draft transaction can be
-- created", "Tatro cannot consume a golf-pool benefit", and "Belcher can
-- consume a golf-pool benefit" tests -- those three already demonstrate a
-- Shared transaction accepted for a Shared-eligible unit and a Golf
-- transaction accepted for a Golf-eligible unit / rejected for a
-- Golf-ineligible unit, so they are not duplicated here.
-- =============================================================================

select ok(
  (
    select bool_and(participates_in_shared_pool)
    from public.ownership_units
    where id in (
      (select value from test_ids where key = 'belcher_unit'),
      (select value from test_ids where key = 'belcher_sr_unit'),
      (select value from test_ids where key = 'tatro_unit')
    )
  ),
  'All existing ownership units receive participates_in_shared_pool = true'
);

insert into public.ownership_units (
  membership_id,
  name,
  members_description,
  ownership_percentage,
  participates_in_golf_pool,
  participates_in_shared_pool
)
values (
  (select value from test_ids where key = 'membership'),
  'Test Shared Ineligible Unit',
  'pgTAP fixture, rolled back',
  0.0001,
  false,
  false
)
returning id;

insert into test_ids (key, value)
select 'shared_ineligible_unit', id
from public.ownership_units
where name = 'Test Shared Ineligible Unit'
order by created_at desc
limit 1;

select ok(
  (select value from test_ids where key = 'shared_ineligible_unit') is not null,
  'Shared-ineligible test fixture unit was created'
);

select lives_ok(
  format(
    $sql$
      insert into public.people (
        membership_id, ownership_unit_id, first_name, last_name, participates_in_shared_pool
      )
      values (%L, %L, 'SharedOk', 'PgtapFixture', true)
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'belcher_unit')
  ),
  'A person may participate in Shared under a Shared-eligible unit'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.people (
        membership_id, ownership_unit_id, first_name, last_name, participates_in_shared_pool
      )
      values (%L, %L, 'SharedReject', 'PgtapFixture', true)
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'shared_ineligible_unit')
  )),
  'A person requesting Shared participation under a Shared-ineligible unit is rejected'
);

select lives_ok(
  format(
    $sql$
      insert into public.people (
        membership_id, ownership_unit_id, first_name, last_name,
        participates_in_shared_pool, participates_in_golf_pool
      )
      values (%L, %L, 'GolfOk', 'PgtapFixture', true, true)
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'belcher_unit')
  ),
  'A person may participate in Golf under a Golf-eligible unit'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.people (
        membership_id, ownership_unit_id, first_name, last_name,
        participates_in_shared_pool, participates_in_golf_pool
      )
      values (%L, %L, 'GolfReject', 'PgtapFixture', true, true)
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'tatro_unit')
  )),
  'A person requesting Golf participation under a Golf-ineligible unit is rejected'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.benefit_transactions (
        membership_id, ownership_unit_id, benefit_grant_id, quantity_used, status, notes
      )
      values (%L, %L, %L, 1, 'draft', 'Shared-ineligible unit rejection test')
    $sql$,
    (select value from test_ids where key = 'membership'),
    (select value from test_ids where key = 'shared_ineligible_unit'),
    (select value from test_ids where key = 'shared_grant')
  )),
  'A Shared transaction against a Shared-ineligible unit is rejected'
);

-- =============================================================================
-- Benefit-grant accounting-field immutability (ISSUE-10 / STEP-3).
--
-- shared_grant already has a referencing benefit_transactions row from the
-- "Draft transaction can be created" step above (voided, but every status
-- counts as a reference), so it is used directly as the "referenced grant"
-- fixture below.
--
-- A second, otherwise-unused membership row is created so the
-- membership_id-change test attempts an actual value change rather than
-- reassigning the same id (which the IS DISTINCT FROM guard would correctly
-- treat as a no-op and not reject).
-- =============================================================================

insert into public.memberships (
  name, contract_number, purchase_price, start_date, expiration_date
)
values (
  'pgTAP Fixture Membership',
  'PGTAP-FIXTURE-0001',
  1.00,
  current_date,
  current_date + 1
)
returning id;

insert into test_ids (key, value)
select 'other_membership', id
from public.memberships
where contract_number = 'PGTAP-FIXTURE-0001';

select ok(
  pg_temp.statement_raises(format(
    'update public.benefit_grants set membership_id = %L where id = %L',
    (select value from test_ids where key = 'other_membership'),
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects membership_id change'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$update public.benefit_grants set pool = 'golf' where id = %L$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects pool change'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$update public.benefit_grants set quantity_kind = 'count' where id = %L$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects quantity_kind change'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$update public.benefit_grants set original_quantity = original_quantity + 1 where id = %L$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects original_quantity change'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$update public.benefit_grants set release_date = current_date where id = %L$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects release_date change'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$update public.benefit_grants set expiration_date = current_date where id = %L$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects expiration_date change'
);

select ok(
  pg_temp.statement_raises(format(
    'update public.benefit_grants set created_at = now() where id = %L',
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant rejects created_at change'
);

select lives_ok(
  format(
    'update public.benefit_grants set name = %L where id = %L',
    'BPG Weeks (pgTAP renamed)',
    (select value from test_ids where key = 'shared_grant')
  ),
  'Referenced grant still permits name changes'
);

select lives_ok(
  format(
    'update public.benefit_grants set restrictions = %L where id = %L',
    'pgTAP updated restrictions text',
    (select value from test_ids where key = 'shared_grant')
  ),
  'Referenced grant still permits restrictions changes'
);

select lives_ok(
  format(
    $sql$
      update public.benefit_grants
      set archived_at = now(), archived_reason = 'pgTAP archival test'
      where id = %L
    $sql$,
    (select value from test_ids where key = 'shared_grant')
  ),
  'Referenced grant still permits archival fields to be set together'
);

select ok(
  exists (
    select 1
    from public.audit_log
    where entity_type = 'benefit_grants'
      and entity_id = (select value from test_ids where key = 'shared_grant')
      and action = 'UPDATE'
      and new_data ->> 'name' = 'BPG Weeks (pgTAP renamed)'
  ),
  'Successful allowed changes to a referenced grant generate audit_log entries'
);

insert into test_ids (key, value)
select 'unreferenced_grant', id
from public.benefit_grants
where membership_id = (select value from test_ids where key = 'membership')
  and id not in (
    select value from test_ids where key in ('shared_grant', 'golf_grant')
  )
  -- Also excludes Incentive Stays: its original_quantity is asserted
  -- against a known fixed value later in this suite (BENEFIT-DETAILS /
  -- STEP-3), so it must not be mutated by this unrelated fixture.
  and name <> 'Incentive Stays'
  and not exists (
    select 1
    from public.benefit_transactions bt
    where bt.benefit_grant_id = benefit_grants.id
  )
order by created_at
limit 1;

select ok(
  (select value from test_ids where key = 'unreferenced_grant') is not null,
  'Unreferenced test fixture grant was found among the seed data'
);

select lives_ok(
  format(
    'update public.benefit_grants set original_quantity = original_quantity + 1 where id = %L',
    (select value from test_ids where key = 'unreferenced_grant')
  ),
  'An unreferenced grant permits accounting-field changes'
);

-- =============================================================================
-- Structured benefit details (BENEFIT-DETAILS / STEP-3).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum definitions and declaration order.
-- ---------------------------------------------------------------------------

select set_eq(
  $$select unnest(enum_range(null::public.benefit_cost_model))::text$$,
  ARRAY['complimentary', 'discounted', 'credit', 'mixed'],
  'benefit_cost_model has the four approved values'
);

select set_eq(
  $$select unnest(enum_range(null::public.benefit_stay_plan))::text$$,
  ARRAY['all_inclusive', 'european_plan', 'property_dependent', 'not_applicable'],
  'benefit_stay_plan has the four approved values'
);

select set_eq(
  $$select unnest(enum_range(null::public.benefit_detail_source_type))::text$$,
  ARRAY['contract', 'operational', 'inference', 'confirm_before_use'],
  'benefit_detail_source_type has the four approved values'
);

select ok(
  (
    select array_agg(enumlabel::text order by enumsortorder)
    from pg_enum
    where enumtypid = 'public.benefit_detail_section'::regtype
  ) = ARRAY[
    'included', 'excluded', 'eligible_properties', 'season_rules',
    'occupancy_rules', 'fees_and_costs', 'redemption_steps',
    'confirmation_questions', 'operational_notes'
  ],
  'benefit_detail_section has the approved values in the load-bearing declaration order'
);

-- ---------------------------------------------------------------------------
-- Fixture: a custom benefit grant with no benefit_grant_details/
-- benefit_detail_items rows yet. Every seeded benefit already has a details
-- row, which would make the one-to-one unique constraint the accidental
-- cause of failure in the constraint tests below rather than the specific
-- constraint under test.
-- ---------------------------------------------------------------------------

insert into public.benefit_grants (
  membership_id, name, pool, quantity_kind, original_quantity
)
values (
  (select value from test_ids where key = 'membership'),
  'pgTAP Custom Benefit', 'shared', 'count', 1
);

insert into test_ids (key, value)
select 'fixture_grant', id
from public.benefit_grants
where name = 'pgTAP Custom Benefit'
order by created_at desc
limit 1;

-- 2. benefit_code default generation for a newly inserted custom benefit.
select ok(
  (
    select benefit_code
    from public.benefit_grants
    where id = (select value from test_ids where key = 'fixture_grant')
  ) like 'custom\_%',
  'A newly inserted custom benefit receives a generated custom_ code without the application supplying one'
);

-- 3. No null benefit_code values after backfill.
select ok(
  not exists (select 1 from public.benefit_grants where benefit_code is null),
  'No benefit_grants row has a null benefit_code'
);

-- 4a. Exactly one membership has all seven approved semantic codes.
select ok(
  (
    select count(*)
    from (
      select membership_id
      from public.benefit_grants
      where benefit_code in (
        'bpg_weeks', 'incentive_stays', 'imperial_grand_weeks',
        'spa_resort_credit', 'universal_credit', 'golf_rounds_50',
        'unlimited_golf_bonus_nights'
      )
      group by membership_id
      having count(*) = 7 and count(distinct benefit_code) = 7
    ) candidates
  ) = 1,
  'Exactly one membership has all seven approved semantic benefit_code values, each exactly once'
);

-- 4b. Each approved semantic code maps to the intended grant (identity, not
-- merely set membership). Uses the code_*_id values captured near the top
-- of this file, before the later "Referenced grant still permits name
-- changes" test renamed one of these rows -- so this check is immune to
-- that rename despite running after it.
select ok(
  (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_bpg_weeks_id')) = 'bpg_weeks'
  and (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_incentive_stays_id')) = 'incentive_stays'
  and (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_imperial_grand_weeks_id')) = 'imperial_grand_weeks'
  and (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_spa_resort_credit_id')) = 'spa_resort_credit'
  and (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_universal_credit_id')) = 'universal_credit'
  and (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_golf_rounds_50_id')) = 'golf_rounds_50'
  and (select benefit_code from public.benefit_grants where id = (select value from test_ids where key = 'code_unlimited_golf_bonus_nights_id')) = 'unlimited_golf_bonus_nights',
  'Each approved semantic code maps to the grant that originally held the corresponding contract name within the target membership'
);

-- 5. Membership-scoped uniqueness: duplicate code within the same membership.
select ok(
  pg_temp.statement_raises(
    $$update public.benefit_grants set benefit_code = 'bpg_weeks' where benefit_code = 'universal_credit'$$
  ),
  'Duplicate (membership_id, benefit_code) pairs within the same membership are rejected'
);

-- 5b. A second membership may reuse an approved semantic code, since
-- uniqueness is scoped to (membership_id, benefit_code), not global.
-- other_membership is the otherwise-unused fixture membership created
-- earlier in this file for the accounting-immutability tests.
select lives_ok(
  format(
    $sql$
      insert into public.benefit_grants (membership_id, name, pool, quantity_kind, original_quantity, benefit_code)
      values (%L, 'pgTAP Second Membership BPG Weeks', 'shared', 'count', 1, 'bpg_weeks')
    $sql$,
    (select value from test_ids where key = 'other_membership')
  ),
  'A second membership may reuse an approved semantic benefit_code because uniqueness is membership-scoped'
);

-- 5c. The one-time backfill helper function is not retained permanently.
select ok(
  to_regprocedure('public.validate_benefit_grant_semantic_names()') is null,
  'No permanent validate_benefit_grant_semantic_names function exists after the backfill migration'
);

-- 6. benefit_grant_details one-to-one constraint.
select ok(
  pg_temp.statement_raises(format(
    'insert into public.benefit_grant_details (benefit_grant_id) values (%L)',
    (select value from test_ids where key = 'shared_grant')
  )),
  'A second benefit_grant_details row for the same grant is rejected'
);

-- 7. Non-negative numeric checks.
select ok(
  pg_temp.statement_raises(format(
    'insert into public.benefit_grant_details (benefit_grant_id, minimum_nights) values (%L, -1)',
    (select value from test_ids where key = 'fixture_grant')
  )),
  'Negative minimum_nights is rejected'
);

select ok(
  pg_temp.statement_raises(format(
    'insert into public.benefit_grant_details (benefit_grant_id, maximum_nights) values (%L, -1)',
    (select value from test_ids where key = 'fixture_grant')
  )),
  'Negative maximum_nights is rejected'
);

select ok(
  pg_temp.statement_raises(format(
    'insert into public.benefit_grant_details (benefit_grant_id, guests_included) values (%L, -1)',
    (select value from test_ids where key = 'fixture_grant')
  )),
  'Negative guests_included is rejected'
);

-- 8. maximum_nights >= minimum_nights.
select ok(
  pg_temp.statement_raises(format(
    'insert into public.benefit_grant_details (benefit_grant_id, minimum_nights, maximum_nights) values (%L, 7, 3)',
    (select value from test_ids where key = 'fixture_grant')
  )),
  'maximum_nights less than minimum_nights is rejected'
);

-- 9. Discount percentage array values must all be between 0 and 100.
select ok(
  pg_temp.statement_raises(format(
    $sql$insert into public.benefit_grant_details (benefit_grant_id, discount_percentages) values (%L, array[50, 150]::numeric[])$sql$,
    (select value from test_ids where key = 'fixture_grant')
  )),
  'A discount_percentages array containing a value outside 0-100 is rejected'
);

select lives_ok(
  format(
    $sql$insert into public.benefit_grant_details (benefit_grant_id, discount_percentages) values (%L, array[0, 100]::numeric[])$sql$,
    (select value from test_ids where key = 'fixture_grant')
  ),
  'A discount_percentages array with boundary values 0 and 100 is accepted'
);

-- 9b. A non-null discount_percentages array containing a null element is
-- invalid (decided behavior for numeric_array_within_range -- see
-- 20260731200000/20260731210000).
select ok(
  pg_temp.statement_raises(format(
    $sql$insert into public.benefit_grant_details (benefit_grant_id, discount_percentages) values (%L, array[20, null]::numeric[])$sql$,
    (select value from test_ids where key = 'fixture_grant')
  )),
  'A discount_percentages array containing a null element is rejected'
);

-- 10. Nonblank detail-item statement check.
select ok(
  pg_temp.statement_raises(format(
    $sql$insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type) values (%L, 'included', '   ', 'contract')$sql$,
    (select value from test_ids where key = 'fixture_grant')
  )),
  'A blank (whitespace-only) detail item statement is rejected'
);

-- 11. Non-negative display_order check.
select ok(
  pg_temp.statement_raises(format(
    $sql$insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order) values (%L, 'included', 'Test statement', 'contract', -1)$sql$,
    (select value from test_ids where key = 'fixture_grant')
  )),
  'A negative display_order is rejected'
);

-- 16. No DELETE privilege (checked here since it needs no role switch).
select ok(
  not has_table_privilege('authenticated', 'public.benefit_grant_details', 'DELETE'),
  'authenticated has no DELETE privilege on benefit_grant_details'
);

select ok(
  not has_table_privilege('authenticated', 'public.benefit_detail_items', 'DELETE'),
  'authenticated has no DELETE privilege on benefit_detail_items'
);

-- ---------------------------------------------------------------------------
-- 12-15. RLS enforcement.
--
-- Every prior assertion in this suite runs as the postgres superuser, which
-- bypasses RLS entirely. This is the first block in this file that actually
-- switches to the `authenticated` role and sets a JWT `sub` claim, so these
-- policies are genuinely exercised rather than trivially passing.
--
-- test_ids is a temporary table created by (and owned by) the postgres
-- role earlier in this session; querying it from the authenticated role
-- below requires an explicit grant.
-- ---------------------------------------------------------------------------

grant select on test_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004'; -- outsider_user: no unit_users row at all

select ok(
  not exists (
    select 1 from public.benefit_grant_details
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ),
  'A user without membership access cannot read benefit_grant_details (RLS SELECT rejection)'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type) values (%L, 'included', 'Outsider insert attempt', 'contract')$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'A user without membership access cannot insert benefit_detail_items (RLS INSERT rejection)'
);

set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003'; -- viewer_user: membership access, not admin

select ok(
  exists (
    select 1 from public.benefit_grant_details
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ),
  'An authorized member can read benefit_grant_details (RLS SELECT allowed)'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type) values (%L, 'included', 'Viewer insert attempt', 'contract')$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'A non-admin member cannot insert benefit_detail_items (RLS INSERT rejection for non-admin)'
);

set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001'; -- admin_user

select lives_ok(
  format(
    $sql$insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type) values (%L, 'operational_notes', 'Admin-authored operational note', 'operational')$sql$,
    (select value from test_ids where key = 'shared_grant')
  ),
  'A membership administrator can insert benefit_detail_items (RLS INSERT allowed)'
);

select lives_ok(
  format(
    'update public.benefit_grant_details set plain_language_summary = %L where benefit_grant_id = %L',
    'Admin edit',
    (select value from test_ids where key = 'shared_grant')
  ),
  'A membership administrator can update benefit_grant_details (RLS UPDATE allowed)'
);

reset role;
reset "request.jwt.claim.sub";

-- 17. Hard-delete trigger rejection for details.
select ok(
  pg_temp.statement_raises(format(
    'delete from public.benefit_grant_details where benefit_grant_id = %L',
    (select value from test_ids where key = 'shared_grant')
  )),
  'Hard delete of a benefit_grant_details row is blocked'
);

-- 18. Hard-delete trigger rejection for items.
select ok(
  pg_temp.statement_raises(
    $$delete from public.benefit_detail_items where id = (select id from public.benefit_detail_items limit 1)$$
  ),
  'Hard delete of a benefit_detail_items row is blocked'
);

-- 19. Audit rows on detail insert/update.
select ok(
  exists (
    select 1
    from public.audit_log al
    join public.benefit_grant_details d on d.id = al.entity_id
    where al.entity_type = 'benefit_grant_details'
      and d.benefit_grant_id = (select value from test_ids where key = 'shared_grant')
      and al.action in ('INSERT', 'UPDATE')
  ),
  'benefit_grant_details insert/update produces an audit_log entry'
);

-- 20. Audit rows on item insert/update.
select ok(
  exists (
    select 1
    from public.audit_log al
    join public.benefit_detail_items i on i.id = al.entity_id
    where al.entity_type = 'benefit_detail_items'
      and i.statement = 'Admin-authored operational note'
      and al.action = 'INSERT'
  ),
  'benefit_detail_items insert produces an audit_log entry'
);

-- 21. updated_at changes on update.
select ok(
  (
    select updated_at
    from public.benefit_grant_details
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ) > (
    select created_at
    from public.benefit_grant_details
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ),
  'benefit_grant_details.updated_at changes after an update'
);

-- 23. Referenced-grant accounting immutability remains intact (regression
-- check: shared_grant already has recorded transaction usage from earlier
-- in this suite).
select ok(
  pg_temp.statement_raises(format(
    $sql$update public.benefit_grants set pool = 'golf' where id = %L$sql$,
    (select value from test_ids where key = 'shared_grant')
  )),
  'Referenced grant still rejects accounting-field changes after the benefit-detail feature was added'
);

-- 24. Detail content remains editable after the parent grant has
-- transaction usage (shared_grant has recorded usage; the admin UPDATE
-- above already succeeded against it).
select ok(
  (
    select plain_language_summary
    from public.benefit_grant_details
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ) = 'Admin edit',
  'benefit_grant_details remains editable even though the parent grant has recorded transaction usage'
);

-- 22. Archive of a benefit grant preserves detail rows.
update public.benefit_grants
set archived_at = now(), archived_reason = 'pgTAP archival preserves detail content test'
where id = (select value from test_ids where key = 'shared_grant');

select ok(
  exists (
    select 1 from public.benefit_grant_details
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ),
  'Archiving a benefit grant does not remove its benefit_grant_details row'
);

select ok(
  exists (
    select 1 from public.benefit_detail_items
    where benefit_grant_id = (select value from test_ids where key = 'shared_grant')
  ),
  'Archiving a benefit grant does not remove its benefit_detail_items rows'
);

-- 25. Deterministic section/display_order/id ordering. Uses golf_grant
-- (Golf Rounds at 50%), not shared_grant: shared_grant had an
-- 'operational_notes' item (ordinal 9) inserted during the RLS block
-- above, which would otherwise sort after 'confirmation_questions'
-- (ordinal 8) and invalidate the "last section" expectation below.
select ok(
  (
    select section
    from public.benefit_detail_items
    where benefit_grant_id = (select value from test_ids where key = 'golf_grant')
    order by section, display_order, id
    limit 1
  )::text = 'included',
  'Deterministic ordering by section/display_order/id yields "included" items first for Golf Rounds at 50%'
);

select ok(
  (
    select section
    from public.benefit_detail_items
    where benefit_grant_id = (select value from test_ids where key = 'golf_grant')
    order by section desc, display_order desc, id desc
    limit 1
  )::text = 'confirmation_questions',
  'Deterministic ordering by section/display_order/id yields "confirmation_questions" items last for Golf Rounds at 50%'
);

-- 26. Exactly seven seeded benefit_grant_details rows.
select ok(
  (
    select count(*)
    from public.benefit_grant_details
    where benefit_grant_id in (
      select id from public.benefit_grants
      where benefit_code in (
        'bpg_weeks', 'incentive_stays', 'imperial_grand_weeks',
        'spa_resort_credit', 'universal_credit', 'golf_rounds_50',
        'unlimited_golf_bonus_nights'
      )
    )
  ) = 7,
  'Exactly seven benefit_grant_details rows exist for the seven approved semantic benefits'
);

-- 27. Every semantic benefit has at least one detail item.
select ok(
  (
    select bool_and(item_count > 0)
    from (
      select g.benefit_code, count(i.id) as item_count
      from public.benefit_grants g
      left join public.benefit_detail_items i on i.benefit_grant_id = g.id
      where g.benefit_code in (
        'bpg_weeks', 'incentive_stays', 'imperial_grand_weeks',
        'spa_resort_credit', 'universal_credit', 'golf_rounds_50',
        'unlimited_golf_bonus_nights'
      )
      group by g.benefit_code
    ) counts
  ),
  'Every one of the seven approved semantic benefits has at least one benefit_detail_items row'
);

-- 28. Incentive Stays accounting quantity remains 6.
select is(
  (select original_quantity from public.benefit_grants where benefit_code = 'incentive_stays'),
  6::numeric(12,2),
  'Incentive Stays original_quantity remains 6 (no accounting correction performed by this feature)'
);

-- 29. Incentive Stays contract_quantity_text visibly records the
-- four-versus-six discrepancy.
select ok(
  (
    select contract_quantity_text
    from public.benefit_grant_details d
    join public.benefit_grants g on g.id = d.benefit_grant_id
    where g.benefit_code = 'incentive_stays'
  ) ilike '%4%'
  and (
    select contract_quantity_text
    from public.benefit_grant_details d
    join public.benefit_grants g on g.id = d.benefit_grant_id
    where g.benefit_code = 'incentive_stays'
  ) ilike '%6%',
  'Incentive Stays contract_quantity_text visibly references both the contract figure and the application figure'
);

-- 30. Golf Rounds at 50% expiration_date remains null.
select ok(
  (select expiration_date from public.benefit_grants where benefit_code = 'golf_rounds_50') is null,
  'Golf Rounds at 50% expiration_date remains null (no date invented by this feature)'
);

-- 31. Golf Rounds at 50% contract_expiration_text does not say "never
-- expires".
select ok(
  (
    select contract_expiration_text
    from public.benefit_grant_details d
    join public.benefit_grants g on g.id = d.benefit_grant_id
    where g.benefit_code = 'golf_rounds_50'
  ) not ilike '%never expires%',
  'Golf Rounds at 50% contract_expiration_text does not claim the benefit never expires'
);

-- 32. Spa Resort Credit grant name remains unchanged.
select is(
  (select name from public.benefit_grants where benefit_code = 'spa_resort_credit'),
  'Spa Resort Credit',
  'Spa Resort Credit grant name is unchanged by this feature'
);

-- 33. Unlimited Golf Bonus Nights original_quantity remains 8.
select is(
  (select original_quantity from public.benefit_grants where benefit_code = 'unlimited_golf_bonus_nights'),
  8::numeric(12,2),
  'Unlimited Golf Bonus Nights original_quantity remains 8'
);

select * from finish();

rollback;