-- One-time cleanup of the two explicitly identified test rows. The admin
-- reseed operation below is safe to repeat and preserves later activity.
do $$
declare
  membership uuid;
  test_ids uuid[] := array[
    'ed7dfd62-3c29-4ca5-bc4f-eb6dd995c457',
    'e87450fd-0434-4fc5-8f3e-4d45e30cbcf2'
  ]::uuid[];
  removed integer;
begin
  select id into strict membership from public.memberships where contract_number = '4135905';
  lock table public.benefit_transactions in access exclusive mode;
  if exists (
    select 1 from public.benefit_transactions
    where id = any(test_ids)
      and (membership_id <> membership or reservation_id is not null
        or effective_date not between date '2026-08-01' and date '2026-08-31')
  ) then
    raise exception 'The August test transaction scope does not match.';
  end if;
  alter table public.benefit_transactions disable trigger benefit_transactions_block_delete_trg;
  delete from public.benefit_transactions where membership_id = membership and id = any(test_ids);
  get diagnostics removed = row_count;
  alter table public.benefit_transactions enable trigger benefit_transactions_block_delete_trg;
  if removed > 0 then
    insert into public.audit_log(membership_id, entity_type, entity_id, action, new_data)
    values (membership, 'memberships', membership, 'contract_baseline_reset',
      jsonb_build_object('test_transactions_removed', removed,
        'reason', 'Owner-authorized August 2026 test cleanup after app data backup'));
  end if;
end;
$$;

create schema if not exists membership_private;
revoke all on schema membership_private from public, anon, authenticated;
grant usage on schema membership_private to authenticated;

create function membership_private.reseed_contract(p_membership uuid, p_confirmation text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  g public.benefit_grants;
begin
  if auth.uid() is not null and not public.user_is_membership_admin(p_membership) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;
  if p_confirmation is distinct from 'RESEED 4135905' or not exists (
    select 1 from public.memberships where id = p_membership and contract_number = '4135905'
  ) then
    raise exception 'Enter RESEED 4135905 to confirm.';
  end if;
  select * into strict g from public.benefit_grants
    where membership_id = p_membership and benefit_code = 'incentive_stays' for update;
  if g.original_quantity <> 4 then
    update public.benefit_grants set original_quantity = 4 where id = g.id;
  end if;
  update public.benefit_grant_details
  set contract_quantity_text = '4 Incentive Stays. The prior app allocation of 6 was corrected to match the contract. Two release March 29, 2029 and two release March 29, 2031.'
  where benefit_grant_id = g.id and contract_quantity_text is distinct from
    '4 Incentive Stays. The prior app allocation of 6 was corrected to match the contract. Two release March 29, 2029 and two release March 29, 2031.';
  update public.benefit_detail_items
  set statement = 'Verify the contract copy. Four Incentive Stays are tracked after correcting the prior app allocation of six.'
  where benefit_grant_id = g.id and section = 'confirmation_questions'
    and statement like 'The contract table appears to list four%';
  insert into public.audit_log(membership_id, actor_id, entity_type, entity_id, action, new_data)
  values (p_membership, auth.uid(), 'benefit_grants', g.id, 'contract_baseline_reseed',
    jsonb_build_object('incentive_stays', 4, 'prior_grant_quantity', g.original_quantity,
      'release_schedule', jsonb_build_object('2029-03-29', 2, '2031-03-29', 2),
      'reason', 'Owner-directed contract correction with source verification flag'));
end;
$$;
revoke execute on function membership_private.reseed_contract(uuid, text) from public, anon, authenticated;
select membership_private.reseed_contract(id, 'RESEED 4135905')
  from public.memberships where contract_number = '4135905';

create function membership_private.reseed_as_admin(p_membership uuid, p_confirmation text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null or not public.user_is_membership_admin(p_membership) then
    raise exception 'Membership administrator access is required.' using errcode = '42501';
  end if;
  perform membership_private.reseed_contract(p_membership, p_confirmation);
end;
$$;
revoke execute on function membership_private.reseed_as_admin(uuid, text) from public, anon;
grant execute on function membership_private.reseed_as_admin(uuid, text) to authenticated;

create function public.reseed_membership_contract(p_membership uuid, p_confirmation text)
returns void language sql security invoker set search_path = pg_catalog, public as $$
  select membership_private.reseed_as_admin(p_membership, p_confirmation);
$$;
revoke execute on function public.reseed_membership_contract(uuid, text) from public, anon;
grant execute on function public.reseed_membership_contract(uuid, text) to authenticated;
