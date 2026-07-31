-- Step 1 of "Order members within ownership units"
-- (see docs/proposals/order-members-within-ownership-units.md).
--
-- Adds a persisted, per-person display-order column so an admin can
-- control card order within an ownership unit. This migration only adds
-- the column; the atomic reorder function and its authorization checks
-- are a separate, later migration (step 2 of the proposal).
--
-- No trigger changes are required: people_audit_trg already logs the
-- complete row via to_jsonb(old)/to_jsonb(new) in public.log_audit_event(),
-- so display_order changes are captured automatically once the atomic
-- reorder function starts writing to it. people_set_updated_at_trg and
-- people_pool_eligibility_trg are likewise column-agnostic and require no
-- changes.

alter table public.people
  add column display_order integer not null default 0;

alter table public.people
  add constraint people_display_order_check
  check (display_order >= 0);

comment on column public.people.display_order is
  'Admin-controlled display order of a person''s card within their ownership unit. Ties broken by last_name, then first_name (see getActivePeople()). Not yet writable by any client path pending the atomic reorder function.';
