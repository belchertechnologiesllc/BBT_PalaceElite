-- Add explicit Shared-pool eligibility to ownership_units, symmetric with the
-- existing participates_in_golf_pool column.
--
-- Palace Elite's three ownership units (Belcher, Belcher Sr., Tatro) all
-- participate in the Shared pool today. The column default (true) already
-- matches that authoritative state for every existing row, so no per-row
-- backfill by name or other identifier is performed here -- the DEFAULT
-- clause backfills all existing rows in the same statement that adds the
-- column, with no risk of misidentifying a unit.
--
-- participates_in_golf_pool is untouched by this migration.

alter table public.ownership_units
  add column participates_in_shared_pool boolean not null default true;

comment on column public.ownership_units.participates_in_shared_pool is
  'Shared-pool participation, explicit and symmetric with participates_in_golf_pool. Every Palace Elite ownership unit currently participates in the Shared pool.';
