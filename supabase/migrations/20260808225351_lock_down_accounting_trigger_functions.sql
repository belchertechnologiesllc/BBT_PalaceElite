-- Palace Elite: trigger-only accounting helpers must not be exposed as RPCs.
-- Supabase may grant function EXECUTE directly to API roles through default
-- privileges, so revoke the roles explicitly rather than relying on PUBLIC.

revoke execute on function public.sync_benefit_unit_allocations_from_grant()
  from public, anon, authenticated;

revoke execute on function public.sync_unused_grant_allocations_from_ownership()
  from public, anon, authenticated;
