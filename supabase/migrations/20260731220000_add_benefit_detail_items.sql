-- Structured benefit-detail domain: benefit_detail_items.
--
-- Zero-to-many repeatable structured statements for a benefit_grants row.
-- References benefit_grant_id directly (not benefit_grant_details.id) so
-- items can exist independently of whether a structured summary row has
-- been authored yet. Like benefit_grant_details, this table is explanatory
-- content, not accounting data, and is deliberately NOT protected by
-- enforce_benefit_grant_immutability_trg.

create table public.benefit_detail_items (
  id uuid primary key default gen_random_uuid(),
  benefit_grant_id uuid not null
    references public.benefit_grants(id) on delete restrict,
  section public.benefit_detail_section not null,
  statement text not null
    check (nullif(btrim(statement), '') is not null),
  source_type public.benefit_detail_source_type not null,
  display_order integer not null default 0
    check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.benefit_detail_items is
  'Repeatable structured statements describing a benefit_grants row, grouped by section and ordered by display_order. No uniqueness constraint on display_order by design -- see 20260731220000 commit history for rationale (index-only, to avoid a reorder operation transiently colliding).';

-- Deterministic read ordering is `order by section, display_order, id`
-- (benefit_detail_section's declaration order makes plain `order by section`
-- yield the intended reading order -- see 20260731200000). This index
-- supports that ordering directly; no uniqueness constraint is added on
-- (benefit_grant_id, section, display_order) per design decision.
create index benefit_detail_items_grant_section_order_idx
  on public.benefit_detail_items (benefit_grant_id, section, display_order, id);

-- =============================================================================
-- Triggers
-- =============================================================================

create trigger benefit_detail_items_audit_trg
  after insert or update on public.benefit_detail_items
  for each row execute function public.log_audit_event();

create trigger benefit_detail_items_block_delete_trg
  before delete on public.benefit_detail_items
  for each row execute function public.block_hard_delete();

create trigger benefit_detail_items_set_updated_at_trg
  before update on public.benefit_detail_items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row level security
-- =============================================================================

alter table public.benefit_detail_items enable row level security;

create policy "membership users can read benefit detail items"
on public.benefit_detail_items for select
to authenticated
using (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_detail_items.benefit_grant_id
      and public.user_has_membership_access(g.membership_id)
  )
);

create policy "admins can insert benefit detail items"
on public.benefit_detail_items for insert
to authenticated
with check (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_detail_items.benefit_grant_id
      and public.user_is_membership_admin(g.membership_id)
  )
);

create policy "admins can update benefit detail items"
on public.benefit_detail_items for update
to authenticated
using (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_detail_items.benefit_grant_id
      and public.user_is_membership_admin(g.membership_id)
  )
)
with check (
  exists (
    select 1
    from public.benefit_grants g
    where g.id = benefit_detail_items.benefit_grant_id
      and public.user_is_membership_admin(g.membership_id)
  )
);

grant select, insert, update on public.benefit_detail_items to authenticated;

-- No DELETE grant is provided. The hard-delete trigger also protects against
-- privileged direct SQL deletion.
