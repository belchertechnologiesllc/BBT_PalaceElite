begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

create temporary table reporting_test_ids (
  key text primary key,
  value uuid not null
);

insert into reporting_test_ids (key, value)
select 'membership', id from public.memberships where contract_number = '4135905';
insert into reporting_test_ids (key, value)
select 'belcher', id from public.ownership_units where membership_id = (select value from reporting_test_ids where key = 'membership') and name = 'Belcher';
insert into reporting_test_ids (key, value)
values ('viewer_user', '00000000-0000-0000-0000-000000000051'),
       ('admin_user', '00000000-0000-0000-0000-000000000052');

insert into auth.users(id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000052', 'report-admin@example.invalid', '{}'::jsonb);
insert into public.unit_users(ownership_unit_id, user_id, role)
select value, '00000000-0000-0000-0000-000000000052', 'admin'
from reporting_test_ids where key = 'belcher';

select ok((select count(*) = 4 from reporting_test_ids), 'Required dashboard/reporting test identifiers are available');

select set_config(
  'request.jwt.claim.sub',
  (select value::text from reporting_test_ids where key = 'admin_user'),
  true
);

with usage as (
  insert into public.benefit_transactions(membership_id, ownership_unit_id, benefit_grant_id,
    transaction_type, quantity_used, quantity_delta, status, effective_date)
  select g.membership_id, (select value from reporting_test_ids where key = 'belcher'),
    g.id, 'use', 1, -1, 'submitted', current_date
  from public.benefit_grants g
  where g.membership_id = (select value from reporting_test_ids where key = 'membership')
    and g.benefit_code = 'incentive_stays'
  returning id
)
insert into reporting_test_ids(key, value) select 'usage', id from usage;
select public.approve_benefit_transaction((select value from reporting_test_ids where key = 'usage'));

select ok(
  public.user_is_membership_admin((select value from reporting_test_ids where key = 'membership')),
  'Test session resolves to a membership administrator'
);

select is(
  jsonb_array_length(public.get_operational_dashboard_snapshot((select value from reporting_test_ids where key = 'membership'))->'benefits'),
  7,
  'Dashboard returns all seven active benefits'
);

select is(
  jsonb_array_length(public.get_operational_dashboard_snapshot((select value from reporting_test_ids where key = 'membership'))->'ownership_positions'),
  3,
  'Dashboard returns all three ownership positions'
);

select is(
  (public.get_operational_dashboard_snapshot((select value from reporting_test_ids where key = 'membership'))->'summary'->>'unreconciled_benefits')::integer,
  0,
  'Dashboard reports no reconciliation exceptions'
);

select ok(
  jsonb_array_length(public.get_operational_dashboard_snapshot((select value from reporting_test_ids where key = 'membership'))->'recent_activity') >= 1,
  'Dashboard includes the existing transaction ledger activity'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(public.get_operational_dashboard_snapshot((select value from reporting_test_ids where key = 'membership'))->'ownership_positions') row
    where row->>'name' = 'Tatro'
      and (row->>'participates_in_golf_pool')::boolean = false
      and row->'golf_rounds_position' = 'null'::jsonb
  ),
  'Dashboard keeps Tatro outside the Golf position'
);

select ok(
  (
    select (snapshot->>'is_admin')::boolean
       and jsonb_array_length(snapshot->'members') = (select count(*) from public.people where membership_id = (select value from reporting_test_ids where key = 'membership'))
       and jsonb_array_length(snapshot->'ownership') = 3
       and jsonb_array_length(snapshot->'benefit_usage') >= 1
       and jsonb_array_length(snapshot->'pool_activity') >= 1
       and jsonb_array_length(snapshot->'audit') >= 1
    from (
      select public.get_reporting_snapshot(
        (select value from reporting_test_ids where key = 'membership'),
        current_date - 90,
        current_date
      ) snapshot
    ) s
  ),
  'Admin reporting snapshot returns member, ownership, ledger, pool, and audit datasets'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_reporting_snapshot(
        (select value from reporting_test_ids where key = 'membership'),
        current_date - 90,
        current_date
      )->'benefit_usage'
    ) row
    where row->>'benefit_name' = 'Incentive Stays'
      and (row->>'quantity_delta')::numeric = -1
  ),
  'Benefit usage report includes the approved Incentive Stay use'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_reporting_snapshot(
        (select value from reporting_test_ids where key = 'membership'),
        current_date - 90,
        current_date
      )->'pool_activity'
    ) row
    where row->>'pool' = 'shared'
      and row->>'ownership_unit_name' = 'Belcher'
      and row->>'quantity_kind' = 'count'
      and (row->>'use_quantity')::numeric = 1
  ),
  'Pool activity report aggregates the approved Shared count usage for Belcher'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values (
  (select value from reporting_test_ids where key = 'viewer_user'),
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'report-viewer@example.invalid', '',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Report Viewer"}'::jsonb
);

insert into public.unit_users (ownership_unit_id, user_id, role)
values (
  (select value from reporting_test_ids where key = 'belcher'),
  (select value from reporting_test_ids where key = 'viewer_user'),
  'viewer'
);

select set_config('request.jwt.claim.sub', (select value::text from reporting_test_ids where key = 'viewer_user'), true);

select ok(
  not (public.get_reporting_snapshot((select value from reporting_test_ids where key = 'membership'), current_date - 90, current_date)->>'is_admin')::boolean,
  'Viewer reporting snapshot identifies non-admin access'
);

select is(
  jsonb_array_length(public.get_reporting_snapshot((select value from reporting_test_ids where key = 'membership'), current_date - 90, current_date)->'audit'),
  0,
  'Viewer reporting snapshot does not return audit history'
);

select throws_ok(
  format(
    'select public.get_reporting_snapshot(%L, current_date, current_date - 1)',
    (select value from reporting_test_ids where key = 'membership')
  ),
  '22007',
  'Report start date cannot be after end date.',
  'Reporting API rejects an inverted date range'
);

select ok(
  has_function_privilege('authenticated', 'public.get_operational_dashboard_snapshot(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_operational_dashboard_snapshot(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_reporting_snapshot(uuid,date,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_reporting_snapshot(uuid,date,date)', 'EXECUTE'),
  'Dashboard and reporting RPC execution is restricted to authenticated users'
);

select * from finish();
rollback;
