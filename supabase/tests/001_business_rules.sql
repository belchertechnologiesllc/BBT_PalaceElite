begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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

select * from finish();

rollback;