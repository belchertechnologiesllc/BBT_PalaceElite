begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

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

create temporary table transaction_engine_ids (
  key text primary key,
  value uuid not null
);

insert into transaction_engine_ids (key, value)
select 'membership', id
from public.memberships
where contract_number = '4135905';

insert into transaction_engine_ids (key, value)
select 'belcher_unit', id
from public.ownership_units
where membership_id = (select value from transaction_engine_ids where key = 'membership')
  and name = 'Belcher';

insert into transaction_engine_ids (key, value)
select 'belcher_sr_unit', id
from public.ownership_units
where membership_id = (select value from transaction_engine_ids where key = 'membership')
  and name = 'Belcher Sr.';

insert into transaction_engine_ids (key, value)
select 'tatro_unit', id
from public.ownership_units
where membership_id = (select value from transaction_engine_ids where key = 'membership')
  and name = 'Tatro';

insert into transaction_engine_ids (key, value)
select 'shared_grant', id
from public.benefit_grants
where membership_id = (select value from transaction_engine_ids where key = 'membership')
  and benefit_code = 'bpg_weeks';

insert into transaction_engine_ids (key, value)
select 'golf_grant', id
from public.benefit_grants
where membership_id = (select value from transaction_engine_ids where key = 'membership')
  and benefit_code = 'golf_rounds_50';

insert into transaction_engine_ids (key, value)
values ('admin_user', '00000000-0000-0000-0000-000000000031');

select ok(
  (select count(*) = 7 from transaction_engine_ids),
  'Required membership, ownership units, grants, and test user IDs are available'
);

select is(
  (
    select array_agg(e.enumlabel order by e.enumsortorder)::text
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'benefit_transaction_type'
  ),
  '{earn,use,adjustment,transfer,correction,reversal,import}',
  'Benefit transaction type enum contains the seven required event types'
);

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
values (
  (select value from transaction_engine_ids where key = 'admin_user'),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'transaction-engine-admin@example.invalid',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Transaction Engine Admin"}'::jsonb
);

insert into public.unit_users (ownership_unit_id, user_id, role)
values (
  (select value from transaction_engine_ids where key = 'belcher_unit'),
  (select value from transaction_engine_ids where key = 'admin_user'),
  'admin'
);

select ok(
  exists (
    select 1
    from public.profiles
    where id = (select value from transaction_engine_ids where key = 'admin_user')
  ),
  'Auth provisioning creates the transaction-engine test profile'
);

select set_config(
  'request.jwt.claim.sub',
  (select value::text from transaction_engine_ids where key = 'admin_user'),
  true
);

insert into public.benefit_transactions (
  membership_id,
  ownership_unit_id,
  benefit_grant_id,
  quantity_used,
  status,
  notes
)
values (
  (select value from transaction_engine_ids where key = 'membership'),
  (select value from transaction_engine_ids where key = 'belcher_unit'),
  (select value from transaction_engine_ids where key = 'shared_grant'),
  1,
  'submitted',
  'Legacy-shaped use transaction'
);

insert into transaction_engine_ids (key, value)
select 'use_transaction', id
from public.benefit_transactions
where notes = 'Legacy-shaped use transaction'
order by created_at desc
limit 1;

select ok(
  exists (
    select 1
    from public.benefit_transactions
    where id = (select value from transaction_engine_ids where key = 'use_transaction')
      and transaction_type = 'use'
      and quantity_used = 1
      and quantity_delta = -1
      and created_by = (select value from transaction_engine_ids where key = 'admin_user')
  ),
  'Legacy quantity_used inserts normalize to a signed use transaction and authenticated actor'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.benefit_transactions (
        membership_id, ownership_unit_id, benefit_grant_id,
        transaction_type, quantity_delta, status, notes
      ) values (%L, %L, %L, 'import', 1, 'submitted', 'Missing source')
    $sql$,
    (select value from transaction_engine_ids where key = 'membership'),
    (select value from transaction_engine_ids where key = 'belcher_unit'),
    (select value from transaction_engine_ids where key = 'shared_grant')
  )),
  'Import transactions require a source reference'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.benefit_transactions (
        membership_id, ownership_unit_id, benefit_grant_id,
        transaction_type, quantity_delta, status
      ) values (%L, %L, %L, 'earn', -1, 'submitted')
    $sql$,
    (select value from transaction_engine_ids where key = 'membership'),
    (select value from transaction_engine_ids where key = 'belcher_unit'),
    (select value from transaction_engine_ids where key = 'shared_grant')
  )),
  'Earn transactions cannot carry a negative delta'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.benefit_transactions (
        membership_id, ownership_unit_id, benefit_grant_id,
        transaction_type, quantity_delta, quantity_used, status, notes
      ) values (%L, %L, %L, 'adjustment', 1, 1, 'submitted', 'Invalid compatibility field')
    $sql$,
    (select value from transaction_engine_ids where key = 'membership'),
    (select value from transaction_engine_ids where key = 'belcher_unit'),
    (select value from transaction_engine_ids where key = 'shared_grant')
  )),
  'quantity_used is rejected for non-use transaction types'
);

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (select value from transaction_engine_ids where key = 'use_transaction')
  ),
  'Administrator can approve a submitted use transaction through the lifecycle function'
);

select is(
  (
    select status::text
    from public.benefit_transactions
    where id = (select value from transaction_engine_ids where key = 'use_transaction')
  ),
  'approved',
  'Approval function moves the transaction to approved'
);

select is(
  (
    select remaining_quantity
    from public.benefit_balances
    where id = (select value from transaction_engine_ids where key = 'shared_grant')
  ),
  (
    select original_quantity - 1
    from public.benefit_grants
    where id = (select value from transaction_engine_ids where key = 'shared_grant')
  ),
  'Approved negative delta reduces the ledger-derived balance'
);

select ok(
  pg_temp.statement_raises(format(
    'update public.benefit_transactions set notes = ''Edited after insert'' where id = %L',
    (select value from transaction_engine_ids where key = 'use_transaction')
  )),
  'Accounting payload is immutable after insertion'
);

insert into public.benefit_transactions (
  membership_id,
  ownership_unit_id,
  benefit_grant_id,
  transaction_type,
  quantity_delta,
  status,
  notes,
  source_reference
)
values (
  (select value from transaction_engine_ids where key = 'membership'),
  (select value from transaction_engine_ids where key = 'belcher_unit'),
  (select value from transaction_engine_ids where key = 'shared_grant'),
  'earn',
  2,
  'submitted',
  'Earn test',
  'contract-test'
);

insert into transaction_engine_ids (key, value)
select 'earn_transaction', id
from public.benefit_transactions
where notes = 'Earn test'
order by created_at desc
limit 1;

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (select value from transaction_engine_ids where key = 'earn_transaction')
  ),
  'Administrator can approve a positive earn transaction'
);

select is(
  (
    select remaining_quantity
    from public.benefit_balances
    where id = (select value from transaction_engine_ids where key = 'shared_grant')
  ),
  (
    select original_quantity + 1
    from public.benefit_grants
    where id = (select value from transaction_engine_ids where key = 'shared_grant')
  ),
  'Signed ledger combines approved use and earn deltas'
);

insert into public.benefit_transactions (
  membership_id,
  ownership_unit_id,
  benefit_grant_id,
  transaction_type,
  quantity_delta,
  status,
  notes,
  related_transaction_id
)
values (
  (select value from transaction_engine_ids where key = 'membership'),
  (select value from transaction_engine_ids where key = 'belcher_unit'),
  (select value from transaction_engine_ids where key = 'shared_grant'),
  'correction',
  1,
  'submitted',
  'Correct the recorded use by one unit',
  (select value from transaction_engine_ids where key = 'use_transaction')
);

insert into transaction_engine_ids (key, value)
select 'correction_transaction', id
from public.benefit_transactions
where notes = 'Correct the recorded use by one unit'
order by created_at desc
limit 1;

select ok(
  exists (
    select 1
    from public.benefit_transactions
    where id = (select value from transaction_engine_ids where key = 'correction_transaction')
      and related_transaction_id = (select value from transaction_engine_ids where key = 'use_transaction')
      and transaction_type = 'correction'
  ),
  'Correction is a new transaction linked to the approved source event'
);

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (select value from transaction_engine_ids where key = 'correction_transaction')
  ),
  'Linked correction can be approved'
);

select lives_ok(
  format(
    'select public.create_benefit_reversal(%L, %L, %L)',
    (select value from transaction_engine_ids where key = 'correction_transaction'),
    'Reverse the correction test',
    'reversal-test'
  ),
  'Administrator can create a reversal without editing the original transaction'
);

insert into transaction_engine_ids (key, value)
select 'reversal_transaction', id
from public.benefit_transactions
where related_transaction_id = (select value from transaction_engine_ids where key = 'correction_transaction')
  and transaction_type = 'reversal'
order by created_at desc
limit 1;

select ok(
  exists (
    select 1
    from public.benefit_transactions reversal
    join public.benefit_transactions original
      on original.id = reversal.related_transaction_id
    where reversal.id = (select value from transaction_engine_ids where key = 'reversal_transaction')
      and reversal.quantity_delta = -original.quantity_delta
      and reversal.status = 'submitted'
  ),
  'Reversal is linked, submitted, and exactly negates the source delta'
);

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (select value from transaction_engine_ids where key = 'reversal_transaction')
  ),
  'Reversal can be approved through the normal lifecycle'
);

select ok(
  pg_temp.statement_raises(format(
    'select public.create_benefit_reversal(%L, %L, null)',
    (select value from transaction_engine_ids where key = 'correction_transaction'),
    'Duplicate reversal should fail'
  )),
  'Only one active reversal may reference an original transaction'
);

insert into transaction_engine_ids (key, value)
select
  'transfer_group',
  public.create_benefit_transfer(
    (select value from transaction_engine_ids where key = 'membership'),
    (select value from transaction_engine_ids where key = 'shared_grant'),
    (select value from transaction_engine_ids where key = 'belcher_unit'),
    (select value from transaction_engine_ids where key = 'tatro_unit'),
    2,
    current_date,
    'Shared transfer integrity test',
    'transfer-test'
  );

select ok(
  (
    select count(*) = 2
      and count(distinct ownership_unit_id) = 2
      and sum(quantity_delta) = 0
      and count(distinct status) = 1
    from public.benefit_transactions
    where transaction_group_id = (select value from transaction_engine_ids where key = 'transfer_group')
  ),
  'Transfer function creates an atomic two-leg zero-sum group across two ownership units'
);

insert into transaction_engine_ids (key, value)
select 'transfer_leg', id
from public.benefit_transactions
where transaction_group_id = (select value from transaction_engine_ids where key = 'transfer_group')
order by quantity_delta
limit 1;

select lives_ok(
  format(
    'select public.approve_benefit_transaction(%L)',
    (select value from transaction_engine_ids where key = 'transfer_leg')
  ),
  'Approving one transfer leg approves the entire transaction group atomically'
);

select ok(
  (
    select count(*) = 2 and count(*) filter (where status = 'approved') = 2
    from public.benefit_transactions
    where transaction_group_id = (select value from transaction_engine_ids where key = 'transfer_group')
  ),
  'Both transfer legs share the approved lifecycle state'
);

select ok(
  pg_temp.statement_raises(format(
    $sql$
      select public.create_benefit_transfer(%L, %L, %L, %L, 1, current_date, 'Invalid golf transfer', 'golf-transfer-test')
    $sql$,
    (select value from transaction_engine_ids where key = 'membership'),
    (select value from transaction_engine_ids where key = 'golf_grant'),
    (select value from transaction_engine_ids where key = 'belcher_unit'),
    (select value from transaction_engine_ids where key = 'tatro_unit')
  )),
  'Golf transfer cannot move into the Tatro ownership unit'
);

set constraints validate_benefit_transaction_group_trg immediate;

select ok(
  pg_temp.statement_raises(format(
    $sql$
      insert into public.benefit_transactions (
        membership_id, ownership_unit_id, benefit_grant_id,
        transaction_type, quantity_delta, transaction_group_id,
        status, notes
      ) values (%L, %L, %L, 'transfer', -1, %L, 'submitted', 'Unpaired transfer')
    $sql$,
    (select value from transaction_engine_ids where key = 'membership'),
    (select value from transaction_engine_ids where key = 'belcher_unit'),
    (select value from transaction_engine_ids where key = 'shared_grant'),
    gen_random_uuid()
  )),
  'Deferred group constraint rejects an unpaired transfer when evaluated'
);

set constraints validate_benefit_transaction_group_trg deferred;

select ok(
  has_function_privilege('authenticated', 'public.approve_benefit_transaction(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_benefit_transfer(uuid,uuid,uuid,uuid,numeric,date,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_benefit_reversal(uuid,text,text)', 'EXECUTE'),
  'Authenticated users can call the guarded transaction RPCs; each function performs its own authorization check'
);

select * from finish();
rollback;
