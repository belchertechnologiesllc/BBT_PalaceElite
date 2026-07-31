-- Allow membership administrators to edit ownership units.
--
-- public.ownership_units currently has only a SELECT policy and a SELECT
-- grant (see 20260728033000_initial_schema.sql), so UPDATE is blocked
-- outright regardless of what the application sends. This migration adds
-- the missing UPDATE policy and grant, reusing the same
-- public.user_is_membership_admin() authorization pattern already applied
-- to public.people ("membership admins can update people" in
-- 20260728203144_add_people.sql). No other privilege is granted: INSERT
-- and DELETE remain unavailable to authenticated, and the existing
-- ownership_units_block_delete_trg / ownership_units_audit_trg triggers are
-- untouched, so edits continue to be audited and hard deletes remain
-- blocked.

create policy "membership admins can update units"
on public.ownership_units
for update
to authenticated
using (
  public.user_is_membership_admin(membership_id)
)
with check (
  public.user_is_membership_admin(membership_id)
);

grant update
on public.ownership_units
to authenticated;

-- No INSERT or DELETE grant is provided. The hard-delete trigger also
-- protects against privileged direct SQL deletion.
