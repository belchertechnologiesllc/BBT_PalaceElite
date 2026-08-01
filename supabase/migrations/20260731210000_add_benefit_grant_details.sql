-- Structured benefit-detail domain: benefit_grant_details.
--
-- Optional one-to-one structured summary for a benefit_grants row. Created
-- lazily -- not required at grant-creation time, and unaffected by grant
-- archival. This table describes a benefit's meaning, not its accounting
-- semantics, so it is deliberately NOT protected by
-- enforce_benefit_grant_immutability_trg (added in
-- 20260731190000_protect_benefit_grant_accounting_fields.sql, unmodified by
-- this migration): structured content must remain correctable, and audited,
-- even after the parent grant has recorded transaction usage.

-- =============================================================================
-- 1. Array-range check helper
-- =============================================================================
--
-- Postgres CHECK constraints cannot contain subqueries, including a bare
-- `select ... from unnest(col)`. Wrapping the unnest in an IMMUTABLE SQL
-- function is the standard workaround for validating every element of an
-- array column in a CHECK constraint.
--
-- Null-element behavior: a null discount_percentages array is valid (no
-- discount data recorded), but a non-null array containing a null element
-- is treated as invalid data -- `v < p_min or v > p_max` evaluates to null
-- (not true) for a null element, which would otherwise let it silently pass
-- through `not exists(...)`. The explicit `v is null or ...` clause below
-- makes a null element fail the range check instead.

create or replace function public.numeric_array_within_range(
  p_values numeric[],
  p_min numeric,
  p_max numeric
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_values is null
    or not exists (
      select 1
      from unnest(p_values) as v
      where v is null or v < p_min or v > p_max
    );
$$;

revoke execute on function public.numeric_array_within_range(numeric[], numeric, numeric) from public;
grant execute on function public.numeric_array_within_range(numeric[], numeric, numeric) to authenticated;

-- =============================================================================
-- 2. Shared updated_at trigger function
-- =============================================================================
--
-- Neutral, table-agnostic name (unlike people's own set_people_updated_at,
-- which is left unmodified and untouched by this feature). Used by this
-- table and by benefit_detail_items (20260731220000).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public;

-- =============================================================================
-- 3. Table
-- =============================================================================

create table public.benefit_grant_details (
  id uuid primary key default gen_random_uuid(),
  benefit_grant_id uuid not null unique
    references public.benefit_grants(id) on delete restrict,
  plain_language_summary text,
  cost_model public.benefit_cost_model,
  stay_plan public.benefit_stay_plan,
  minimum_nights integer,
  maximum_nights integer,
  guests_included integer,
  discount_percentages numeric[],
  service_fee_required boolean,
  gold_season_only boolean,
  contract_quantity_text text,
  contract_expiration_text text,
  contract_source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_nights is null or minimum_nights >= 0),
  check (maximum_nights is null or maximum_nights >= 0),
  check (guests_included is null or guests_included >= 0),
  check (
    minimum_nights is null
    or maximum_nights is null
    or maximum_nights >= minimum_nights
  ),
  check (public.numeric_array_within_range(discount_percentages, 0, 100))
);

comment on table public.benefit_grant_details is
  'Optional structured summary of a benefit_grants row. Explanatory content, not accounting data -- never locked by enforce_benefit_grant_immutability_trg.';

-- =============================================================================
-- 4. Triggers
-- =============================================================================

create trigger benefit_grant_details_audit_trg
  after insert or update on public.benefit_grant_details
  for each row execute function public.log_audit_event();

create trigger benefit_grant_details_block_delete_trg
  before delete on public.benefit_grant_details
  for each row execute function public.block_hard_delete();

create trigger benefit_grant_details_set_updated_at_trg
  before update on public.benefit_grant_details
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 5. Row level security
-- =============================================================================

alter table public.benefit_grant_details enable row level security;

create policy "membership users can read benefit details"
on public.benefit_grant_details for select
to authenticated
using (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_grant_details.benefit_grant_id
      and public.user_has_membership_access(g.membership_id)
  )
);

create policy "admins can insert benefit details"
on public.benefit_grant_details for insert
to authenticated
with check (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_grant_details.benefit_grant_id
      and public.user_is_membership_admin(g.membership_id)
  )
);

create policy "admins can update benefit details"
on public.benefit_grant_details for update
to authenticated
using (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_grant_details.benefit_grant_id
      and public.user_is_membership_admin(g.membership_id)
  )
)
with check (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_grant_details.benefit_grant_id
      and public.user_is_membership_admin(g.membership_id)
  )
);

grant select, insert, update on public.benefit_grant_details to authenticated;

-- No DELETE grant is provided. The hard-delete trigger also protects against
-- privileged direct SQL deletion.
