begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

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

select * from finish();

rollback;