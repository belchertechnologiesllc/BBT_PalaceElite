begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

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

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from public.unit_users where role = 'admin' and revoked_at is null limit 1),
  true
);

select ok(
  exists (
    select 1
    from public.get_benefit_unit_balances_as_of(
      (select value from reversal_business_date_test_ids where key = 'membership'),
      '2026-08-07'
    )
    where benefit_name = 'Incentive Stays'
      and ownership_unit_name = 'Belcher'
      and ledger_delta = -1
  ),
  'Historical accounting still shows the original Aug 7 Incentive Stay use'
);

select ok(
  exists (
    select 1
    from public.get_benefit_unit_balances_as_of(
      (select value from reversal_business_date_test_ids where key = 'membership'),
      '2026-08-08'
    )
    where benefit_name = 'Incentive Stays'
      and ownership_unit_name = 'Belcher'
      and ledger_delta = 0
      and remaining_quantity = allocated_quantity
  ),
  'Historical accounting includes the approved reversal on the Aug 8 business date'
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
  exists (
    select 1
    from public.benefit_transactions
    where transaction_type = 'reversal'
      and notes = 'This was a test transaction'
      and effective_date = '2026-08-09'
  ),
  'Existing append-only reversal row remains physically unchanged'
);

select ok(
  has_function_privilege('authenticated', 'public.create_benefit_reversal(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_benefit_reversal(uuid,text,text)', 'EXECUTE'),
  'Reversal RPC remains restricted to authenticated users'
);

select * from finish();
rollback;
