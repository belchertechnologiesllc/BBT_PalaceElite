begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

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

create temporary table accounting_test_ids (
  key text primary key,
  value uuid not null
);

insert into accounting_test_ids (key, value)
select 'membership', id from public.memberships where contract_number = '4135905';

insert into accounting_test_ids (key, value)
select 'belcher', id from public.ownership_units
where membership_id = (select value from accounting_test_ids where key = 'membership') and name = 'Belcher';

insert into accounting_test_ids (key, value)
select 'belcher_sr', id from public.ownership_units
where membership_id = (select value from accounting_test_ids where key = 'membership') and name = 'Belcher Sr.';

insert into accounting_test_ids (key, value)
select 'tatro', id from public.ownership_units
where membership_id = (select value from accounting_test_ids where key = 'membership') and name = 'Tatro';

insert into accounting_test_ids (key, value)
select 'incentive', id from public.benefit_grants
where membership_id = (select value from accounting_test_ids where key = 'membership') and name = 'Incentive Stays';

insert into accounting_test_ids (key, value)
select 'golf_rounds', id from public.benefit_grants
where membership_id = (select value from accounting_test_ids where key = 'membership') and name = 'Golf Rounds at 50%';

insert into accounting_test_ids (key, value)
values ('admin_user', '00000000-0000-0000-0000-000000000041');

select ok(
  (select count(*) = 7 from accounting_test_ids),
  'Required membership, ownership units, grants, and admin test id are available'
);

select is(
  (
    select count(*)::integer
    from public.benefit_unit_allocations
    where membership_id = (select value from accounting_test_ids where key = 'membership')
  ),
  21,
  'Seven grants have a stable allocation row for each of the three ownership units'
);

select ok(
  (
    select abs(sum(allocation_percentage) - 100) < 0.000001
       and abs(sum(allocated_quantity) - 6) < 0.000001
    from public.benefit_unit_allocations
    where benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
  ),
  'Shared Incentive Stay allocation reconciles to 100 percent and six original stays'
);

select ok(
  exists (
    select 1
    from public.benefit_unit_allocations a
    where a.benefit_grant_id = (select value from accounting_test_ids where key = 'golf_rounds')
      and a.ownership_unit_id = (select value from accounting_test_ids where key = 'belcher')
      and a.allocation_percentage = 50
      and a.allocated_quantity = 10
  )
  and exists (
    select 1
    from public.benefit_unit_allocations a
    where a.benefit_grant_id = (select value from accounting_test_ids where key = 'golf_rounds')
      and a.ownership_unit_id = (select value from accounting_test_ids where key = 'belcher_sr')
      and a.allocation_percentage = 50
      and a.allocated_quantity = 10
  )
  and exists (
    select 1
    from public.benefit_unit_allocations a
    where a.benefit_grant_id = (select value from accounting_test_ids where key = 'golf_rounds')
      and a.ownership_unit_id = (select value from accounting_test_ids where key = 'tatro')
      and a.allocation_percentage = 0
      and a.allocated_quantity = 0
  ),
  'Golf allocation is 50/50 for Belcher and Belcher Sr. with zero Tatro allocation'
);

select ok(
  (
    select count(*) = 7 and bool_and(is_reconciled)
    from public.benefit_reconciliation
    where membership_id = (select value from accounting_test_ids where key = 'membership')
  ),
  'All seven benefits reconcile before ledger activity'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values (
  (select value from accounting_test_ids where key = 'admin_user'),
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'accounting-admin@example.invalid', '',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Accounting Admin"}'::jsonb
);

insert into public.unit_users (ownership_unit_id, user_id, role)
values (
  (select value from accounting_test_ids where key = 'belcher'),
  (select value from accounting_test_ids where key = 'admin_user'),
  'admin'
);

select set_config(
  'request.jwt.claim.sub',
  (select value::text from accounting_test_ids where key = 'admin_user'),
  true
);

select ok(
  (
    select jsonb_array_length(snapshot->'unit_balances') = 21
       and jsonb_array_length(snapshot->'reconciliation') = 7
    from (
      select public.get_benefit_accounting_snapshot(
        (select value from accounting_test_ids where key = 'membership'),
        current_date
      ) as snapshot
    ) s
  ),
  'Guarded accounting snapshot returns unit positions and reconciliation rows'
);

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
)
values (
  (select value from accounting_test_ids where key = 'membership'),
  (select value from accounting_test_ids where key = 'belcher'),
  (select value from accounting_test_ids where key = 'incentive'),
  'use', -1, 1, current_date, 'submitted',
  'Accounting unit-balance test use'
);

insert into accounting_test_ids (key, value)
select 'use_transaction', id
from public.benefit_transactions
where notes = 'Accounting unit-balance test use'
order by created_at desc
limit 1;

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (select value from accounting_test_ids where key = 'use_transaction')
  ),
  'Submitted shared use can be approved'
);

select ok(
  exists (
    select 1
    from public.benefit_unit_balances b
    where b.benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and b.ownership_unit_id = (select value from accounting_test_ids where key = 'belcher')
      and b.approved_ledger_delta = -1
      and abs(b.remaining_quantity - (b.allocated_quantity - 1)) < 0.000001
  ),
  'Belcher unit position decreases by the approved Incentive Stay use'
);

select ok(
  (
    select count(*) = 2 and bool_and(abs(approved_ledger_delta) < 0.000001)
    from public.benefit_unit_balances b
    where b.benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and b.ownership_unit_id in (
        (select value from accounting_test_ids where key = 'belcher_sr'),
        (select value from accounting_test_ids where key = 'tatro')
      )
  ),
  'Other Shared ownership units are unchanged by Belcher usage'
);

select ok(
  exists (
    select 1
    from public.benefit_reconciliation r
    where r.benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and r.grant_remaining_quantity = 5
      and abs(r.unit_remaining_quantity - 5) < 0.000001
      and r.is_reconciled
  ),
  'Grant-level five remaining stays reconcile to the sum of unit positions'
);

select ok(
  (
    select abs((row->>'ledger_delta')::numeric) < 0.000001
    from (
      select elem as row
      from jsonb_array_elements(
        public.get_benefit_accounting_snapshot(
          (select value from accounting_test_ids where key = 'membership'),
          current_date - 1
        )->'unit_balances'
      ) elem
      where elem->>'benefit_grant_id' = (select value::text from accounting_test_ids where key = 'incentive')
        and elem->>'ownership_unit_id' = (select value::text from accounting_test_ids where key = 'belcher')
    ) historical
  ),
  'Historical snapshot before approval excludes the later approved use'
);

select ok(
  (
    select (row->>'ledger_delta')::numeric = -1
    from (
      select elem as row
      from jsonb_array_elements(
        public.get_benefit_accounting_snapshot(
          (select value from accounting_test_ids where key = 'membership'),
          current_date
        )->'unit_balances'
      ) elem
      where elem->>'benefit_grant_id' = (select value::text from accounting_test_ids where key = 'incentive')
        and elem->>'ownership_unit_id' = (select value::text from accounting_test_ids where key = 'belcher')
    ) current_position
  ),
  'Current accounting snapshot includes the approved use'
);

select ok(
  pg_temp.statement_raises(format(
    'select public.recalculate_benefit_unit_allocations(%L)',
    (select value from accounting_test_ids where key = 'incentive')
  )),
  'Allocation baseline cannot be recalculated after grant transaction history exists'
);

create temporary table frozen_incentive_allocation as
select ownership_unit_id, allocation_percentage, allocated_quantity
from public.benefit_unit_allocations
where benefit_grant_id = (select value from accounting_test_ids where key = 'incentive');

update public.ownership_units
set ownership_percentage = 34
where id = (select value from accounting_test_ids where key = 'belcher');

select ok(
  not exists (
    select 1
    from public.benefit_unit_allocations current_allocation
    full join frozen_incentive_allocation frozen
      using (ownership_unit_id)
    where current_allocation.benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and (
        current_allocation.allocation_percentage is distinct from frozen.allocation_percentage
        or current_allocation.allocated_quantity is distinct from frozen.allocated_quantity
      )
  ),
  'Later ownership-percentage edits do not rewrite a used grant allocation baseline'
);

insert into accounting_test_ids (key, value)
select 'transfer_group', public.create_benefit_transfer(
  (select value from accounting_test_ids where key = 'membership'),
  (select value from accounting_test_ids where key = 'incentive'),
  (select value from accounting_test_ids where key = 'belcher'),
  (select value from accounting_test_ids where key = 'tatro'),
  0.5,
  current_date,
  'Accounting reconciliation transfer',
  'accounting-test'
);

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (
      select id
      from public.benefit_transactions
      where transaction_group_id = (select value from accounting_test_ids where key = 'transfer_group')
      order by id
      limit 1
    )
  ),
  'Shared allocation transfer can be approved atomically'
);

select ok(
  exists (
    select 1
    from public.benefit_unit_balances
    where benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and ownership_unit_id = (select value from accounting_test_ids where key = 'belcher')
      and approved_ledger_delta = -1.5
  )
  and exists (
    select 1
    from public.benefit_unit_balances
    where benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and ownership_unit_id = (select value from accounting_test_ids where key = 'tatro')
      and approved_ledger_delta = 0.5
  ),
  'Transfer shifts unit positions without rewriting the original allocation'
);

select ok(
  exists (
    select 1
    from public.benefit_reconciliation
    where benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      and grant_remaining_quantity = 5
      and abs(unit_remaining_quantity - 5) < 0.000001
      and is_reconciled
  ),
  'Zero-sum transfer leaves the grant total unchanged and reconciled'
);

select ok(
  pg_temp.statement_raises(format(
    'delete from public.benefit_unit_allocations where id = %L',
    (
      select id
      from public.benefit_unit_allocations
      where benefit_grant_id = (select value from accounting_test_ids where key = 'incentive')
      limit 1
    )
  )),
  'Allocation rows cannot be hard-deleted'
);

select * from finish();
rollback;
