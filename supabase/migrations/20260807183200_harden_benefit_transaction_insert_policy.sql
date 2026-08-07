-- Palace Elite: transaction INSERT authorization.
--
-- Membership administrators must be able to record activity for any eligible
-- ownership unit in their membership. Contributors remain restricted to the
-- ownership unit for which they hold contributor access. The transaction
-- validation trigger separately restricts accounting-sensitive event types
-- (earn/adjustment/transfer/correction/reversal/import) to administrators.

 drop policy if exists "contributors can create benefit transactions"
 on public.benefit_transactions;

create policy "authorized users can create benefit transactions"
on public.benefit_transactions
for insert
to authenticated
with check (
  public.user_has_membership_access(membership_id)
  and (
    public.user_is_membership_admin(membership_id)
    or exists (
      select 1
      from public.unit_users uu
      where uu.user_id = auth.uid()
        and uu.revoked_at is null
        and uu.ownership_unit_id = benefit_transactions.ownership_unit_id
        and uu.role = 'contributor'
    )
  )
);
