begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

create temporary table reversal_business_date_test_ids (
  key text primary key,
  value uuid not null
);

insert into reversal_business_date_test_ids (key, value)
select 'membership', id
from public.memberships
where contract_number = '4135905';

insert into reversal_business_date_test_ids (key, value)
select 'belcher', id
from public.ownership_units
where membership_id = (select value from reversal_business_date_test_ids where key = 'membership')
  and name = 'Belcher';

insert into reversal_business_date_test_ids (key, value)
select 'bpg_weeks', id
from public.benefit_grants
where membership_id = (select value from reversal_business_date_test_ids where key = 'membership')
  and name = 'BPG Weeks';

select is(
  (select business_timezone from public.memberships where id = (select value from reversal_business_date_test_ids where key = 'membership')),
  'America/Chicago',
  'Membership has the canonical Central business timezone'
);

insert into auth.users(id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000061', 'reversal-admin@example.invalid', '{}'::jsonb);
insert into public.unit_users(ownership_unit_id, user_id, role)
select value, '00000000-0000-0000-0000-000000000061', 'admin'
from reversal_business_date_test_ids where key = 'belcher';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);

select is(
  (select ledger_delta from public.get_benefit_unit_balances_as_of(
    (select value from reversal_business_date_test_ids where key = 'membership'), date '2026-08-08'
  ) where benefit_name = 'Incentive Stays' and ownership_unit_name = 'Belcher'),
  0::numeric,
  'Removed August test transactions have no historical balance impact'
);

with created as (
  insert into public.benefit_transactions (
    membership_id,
    ownership_unit_id,
    benefit_grant_id,
    transaction_type,
    quantity_delta,
    quantity_used,
    effective_date,
    status,
    notes
  ) values (
    (select value from reversal_business_date_test_ids where key = 'membership'),
    (select value from reversal_business_date_test_ids where key = 'belcher'),
    (select value from reversal_business_date_test_ids where key = 'bpg_weeks'),
    'use',
    -1,
    1,
    timezone('America/Chicago', now())::date,
    'submitted',
    'reversal business-date pgTAP test'
  )
  returning id
)
insert into reversal_business_date_test_ids (key, value)
select 'test_use', id from created;

select public.approve_benefit_transaction(
  (select value from reversal_business_date_test_ids where key = 'test_use')
);

select public.create_benefit_reversal(
  (select value from reversal_business_date_test_ids where key = 'test_use'),
  'reversal business-date pgTAP test reversal',
  null
);

select is(
  (
    select effective_date
    from public.benefit_transactions
    where related_transaction_id = (select value from reversal_business_date_test_ids where key = 'test_use')
      and transaction_type = 'reversal'
  ),
  timezone('America/Chicago', now())::date,
  'New reversal effective_date uses the membership-local business date'
);

select ok(
  not exists (
    select 1 from public.benefit_transactions where id in (
      'ed7dfd62-3c29-4ca5-bc4f-eb6dd995c457', 'e87450fd-0434-4fc5-8f3e-4d45e30cbcf2'
    )
  ),
  'Both August test transaction IDs are absent from the ledger'
);

select ok(
  has_function_privilege('authenticated', 'public.create_benefit_reversal(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_benefit_reversal(uuid,text,text)', 'EXECUTE'),
  'Reversal RPC remains restricted to authenticated users'
);

select * from finish();
rollback;
