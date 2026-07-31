# REPORT LABEL: BENEFIT-DETAILS / STEP-2 / PRODUCT-AND-DOMAIN-DECISIONS

## Branch and Repository State

- Working tree was clean before any action in this step.
- `git checkout main` succeeded.
- `git pull --ff-only origin main` fast-forwarded local `main` from `256e993` to `e4303d3` (the merge of PR #25, the Ownership-page cleanup), 2 commits, no conflicts, no divergent history.
- `git checkout -b feature/structured-benefit-details` created cleanly off the updated `main`.
- Latest migration on `main` as of this step: `20260731190000_protect_benefit_grant_accounting_fields.sql`. No `benefit_code` column, and no `benefit_cost_model` / `benefit_stay_plan` / `benefit_detail_source_type` / `benefit_detail_section` enum names exist anywhere in the migration history — confirmed via direct grep, not assumed. All four proposed new enum names and the `benefit_code` column name are collision-free.

## Review of Step 1 Findings

**Still valid (technical/schema facts, unaffected by the contract review):**
- `benefit_grants`' existing columns, triggers (`benefit_grants_audit_trg`, `benefit_grants_block_delete_trg`, `enforce_benefit_grant_immutability_trg`), and RLS policies, exactly as documented in Step 1.
- `reservations` has no `benefit_grant_id` column and cannot reference a grant — still true, unchanged by this step's schema inspection.
- The recommendation to reuse `SlideOver` rather than introduce a modal primitive.
- The recommendation to reuse the existing column-agnostic `log_audit_event()` and `block_hard_delete()` triggers unmodified.
- The recommendation that `benefit_detail_items` reference `benefit_grant_id` directly rather than through `benefit_grant_details` — now confirmed as the approved decision (Section 5), not just a Step 1 preference.
- The observation that no contract document exists inside this repository — still true of the repository itself; superseded only in the sense that the product owner has now supplied the missing facts *externally*, which this step records as approved decisions rather than repository-derived facts.

**Superseded by product-owner decisions (Step 1's `confirm_before_use` classifications no longer apply where a decision below provides the answer):**
- Step 1 flagged the "Spa Resort Credit" vs. "Spa Resort Credit Pack" naming as an unresolved discrepancy requiring confirmation. **Resolved**: keep the existing grant name; record "Spa Resort Credit Pack" as contract terminology in structured content only (Decision 8).
- Step 1 flagged "Unlimited" vs. `original_quantity = 8` as a visible, unexplained contradiction. **Resolved**: not a contradiction — eight qualifying bonus nights, each night unlimited golf for two people sharing a room (Decision 9). Step 1's proposed "confirmation_questions" item stating the two numbers "contradict" must not be used; only the narrower operational questions below survive (exact tee-time/arrival-departure/cart/caddie rules).
- Step 1 left `discount_percentages` entirely `null`/`confirm_before_use` for every benefit, including Golf Rounds at 50%, reasoning the percentage was only in the name, not a verified structured fact. **Partially superseded**: Decision 4 confirms the 50% is contract-stated for Golf Rounds specifically and may be recorded as `[50]`. This does not extend to any other benefit's cost description.
- Step 1's proposed `cost_model`/`stay_plan` as free-text is superseded by Decision 3/4: both become closed Postgres enums with the exact value sets specified below.
- Step 1 treated the seeded `original_quantity = 6` for Incentive Stays as simply a fact with no counter-evidence. **Now qualified, not overturned**: the accounting value of 6 remains authoritative and unchanged in this feature, but Step 1 had no way to know a contract-table discrepancy (six vs. four) existed at all — this step records that discrepancy explicitly as unresolved (Decision 10), which is new information, not a correction to Step 1.
- Step 1 treated Universal Credit's `null` restrictions and Golf Rounds' `null` expiration_date as ambiguous with no way to resolve which interpretation was correct. **Golf Rounds partially resolved**: Decision 11 supplies the exact non-committal wording to use, without inventing a date. **Universal Credit not resolved by a specific stated fact**, but Decision 12 directs sourcing structured content from the reviewed contract with confirmation questions retained — this step does not have the literal reviewed-contract text for Universal Credit and is not being given specific facts for it beyond "populate from the reviewed contract" without the content itself being supplied here, so its detailed content mapping remains open pending the actual content being supplied (see Technical Contradictions or Open Questions).

## Final Relationship Model

- `benefit_grants` unchanged as the membership-specific allocation/accounting record.
- `benefit_grant_details`: 0-or-1 per grant, `benefit_grant_id uuid not null unique references benefit_grants(id) on delete restrict`. Created lazily — never required at grant-creation time, never auto-created by a trigger.
- `benefit_detail_items`: 0-to-many per grant, `benefit_grant_id uuid not null references benefit_grants(id) on delete restrict` (references the grant directly, not the details row — approved in Decision 5, matching Step 1's recommendation).
- Both child tables use `on delete restrict`, consistent with every existing foreign key in this schema (no `cascade` anywhere in this domain).
- Detail content survives grant archival unconditionally — archiving a grant sets `archived_at`/`archived_reason` on `benefit_grants` only; nothing in either child table is touched, and no trigger removes or hides it.

## Final Stable Benefit Identification

- `benefit_grants.benefit_code text`, nullable during backfill, intended to become `not null` once backfilled for all rows (existing seven plus any future rows).
- Uniqueness: `unique (membership_id, benefit_code)` — **not** globally unique. This repository's schema has exactly one seeded membership today, but nothing in the schema enforces that permanently (no check, no trigger, no comment asserting single-membership-forever), so a global unique constraint would encode an assumption the schema itself doesn't actually guarantee. Membership-scoped uniqueness is the correct, minimal constraint.
- The one-time backfill migration identifies the seven existing rows by exact `(membership_id, name)` match only, inside that single migration file, and must `raise exception` if the matched-row count is not exactly 7 — mirroring the existing fail-loud pattern already used in `bootstrap_administrator()` (raises if the expected "Belcher" unit isn't found rather than proceeding with a partial/guessed result).
- After backfill, no service, seed migration, or UI code may match a benefit by `name` — only by `benefit_code`.

Approved codes (recorded verbatim, not re-derived): `bpg_weeks`, `incentive_stays`, `imperial_grand_weeks`, `spa_resort_credit`, `universal_credit`, `golf_rounds_50`, `unlimited_golf_bonus_nights`.

## Final Typed Attribute Model

```sql
create table public.benefit_grant_details (
  id uuid primary key default gen_random_uuid(),
  benefit_grant_id uuid not null unique
    references public.benefit_grants(id) on delete restrict,
  plain_language_summary text,
  cost_model public.benefit_cost_model,
  stay_plan public.benefit_stay_plan,
  minimum_nights integer check (minimum_nights >= 0),
  maximum_nights integer check (maximum_nights >= 0),
  guests_included integer check (guests_included >= 0),
  discount_percentages numeric[],
  service_fee_required boolean,
  gold_season_only boolean,
  contract_quantity_text text,
  contract_expiration_text text,
  contract_source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    minimum_nights is null
    or maximum_nights is null
    or maximum_nights >= minimum_nights
  )
);
```

All fields nullable except `id`/`benefit_grant_id`/`created_at`/`updated_at`, per Decision 3 ("use nullable fields where an attribute does not apply or is not confirmed"). `discount_percentages numeric[]` holds only contractually-stated percentages (e.g. `'{50}'` for Golf Rounds); it is never populated from an informal interpretation.

## Final Enum Definitions

```sql
create type public.benefit_cost_model as enum (
  'complimentary', 'discounted', 'credit', 'mixed'
);

create type public.benefit_stay_plan as enum (
  'all_inclusive', 'european_plan', 'property_dependent', 'not_applicable'
);

create type public.benefit_detail_source_type as enum (
  'contract', 'operational', 'inference', 'confirm_before_use'
);

create type public.benefit_detail_section as enum (
  'included', 'excluded', 'eligible_properties', 'season_rules',
  'occupancy_rules', 'fees_and_costs', 'redemption_steps',
  'confirmation_questions', 'operational_notes'
);
```

`benefit_detail_section`'s declaration order is deliberately the same order given in the approved decisions — this lets a plain `order by section` produce the intended reading order for free (Postgres enums sort by declaration ordinal, not alphabetically), the same technique already used for `benefit_pool` (`'shared'` before `'golf'`) in the merged Issue #10 work.

## Detail Item Ordering Model

```sql
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

create index benefit_detail_items_grant_section_order_idx
  on public.benefit_detail_items (benefit_grant_id, section, display_order);
```

Deterministic ordering rule for reads: `order by section, display_order, id` — `section` sorts by enum declaration order (see above), `display_order` breaks ties within a section, `id` is the final stable fallback for two items sharing the same `display_order` (a real possibility since Decision 5 explicitly does not require `display_order` to be unique). No uniqueness constraint is added on `(benefit_grant_id, section, display_order)`, per Decision 5's explicit preference for an index over a constraint — this also avoids a reorder operation transiently colliding mid-update, which a unique constraint would reject.

## Archival and Immutability Decisions

- Detail content is unaffected by `benefit_grants.archived_at`/`archived_reason` — no trigger, check, or query filters it based on grant archival status.
- `enforce_benefit_grant_immutability_trg` is **not** extended to either new table (Decision 7). Structured detail content remains editable and correctable at any time, including after a grant has recorded transaction usage, because it describes the benefit's meaning rather than its accounting semantics — the same distinction already drawn in Step 1 between `pool`/`quantity_kind`/`original_quantity`/dates (locked once referenced) versus `name`/`restrictions` (always editable) on `benefit_grants` itself. This does not touch or weaken the existing trigger's protection of `benefit_transactions` history in any way — that remains fully immutable and unaffected.

## RLS Design

Both tables are RLS-scoped through `benefit_grants.membership_id` via an `exists` subquery — neither table gets its own `membership_id` column (Decision 13 explicitly rules this out).

```sql
-- benefit_grant_details
create policy "membership users can read benefit details"
on public.benefit_grant_details for select to authenticated
using (exists (
  select 1 from public.benefit_grants g
  where g.id = benefit_grant_details.benefit_grant_id
    and public.user_has_membership_access(g.membership_id)
));

create policy "admins can insert benefit details"
on public.benefit_grant_details for insert to authenticated
with check (exists (
  select 1 from public.benefit_grants g
  where g.id = benefit_grant_details.benefit_grant_id
    and public.user_is_membership_admin(g.membership_id)
));

create policy "admins can update benefit details"
on public.benefit_grant_details for update to authenticated
using (exists (
  select 1 from public.benefit_grants g
  where g.id = benefit_grant_details.benefit_grant_id
    and public.user_is_membership_admin(g.membership_id)
))
with check (exists (
  select 1 from public.benefit_grants g
  where g.id = benefit_grant_details.benefit_grant_id
    and public.user_is_membership_admin(g.membership_id)
));

grant select, insert, update on public.benefit_grant_details to authenticated;
-- no delete grant

-- benefit_detail_items: identical three-policy shape, joined on
-- benefit_detail_items.benefit_grant_id instead.
```

INSERT/UPDATE policies are included in the schema now (Decision 6 permits this for future administration) even though the initial UI ships read-only — no write path is exposed anywhere in the application this step or Step 3/4/5 unless a later step explicitly adds one. No DELETE policy or grant on either table, matching every other table in this schema.

## Audit and Delete Protection

Both new tables get the same three-part treatment as every other table:

```sql
create trigger benefit_grant_details_audit_trg
  after insert or update on public.benefit_grant_details
  for each row execute function public.log_audit_event();
create trigger benefit_grant_details_block_delete_trg
  before delete on public.benefit_grant_details
  for each row execute function public.block_hard_delete();
create trigger benefit_grant_details_set_updated_at_trg
  before update on public.benefit_grant_details
  for each row execute function public.set_people_updated_at();
-- (reusing the existing generic updated_at-setter function by name,
-- since its body is table-agnostic — `new.updated_at := now()` — not
-- specific to `people` despite its name)

create trigger benefit_detail_items_audit_trg
  after insert or update on public.benefit_detail_items
  for each row execute function public.log_audit_event();
create trigger benefit_detail_items_block_delete_trg
  before delete on public.benefit_detail_items
  for each row execute function public.block_hard_delete();
create trigger benefit_detail_items_set_updated_at_trg
  before update on public.benefit_detail_items
  for each row execute function public.set_people_updated_at();
```

No changes to `log_audit_event()`, `block_hard_delete()`, or any existing audit history — all three functions are reused exactly as they already exist, and `log_audit_event()` is already column/table-agnostic via `to_jsonb`.

## Read-Only Initial UI Scope

(Design record only — no UI code is written in this step.) Benefit cards on `BenefitsPage.tsx` become clickable, keyboard-accessible controls that open a new read-only `SlideOver` showing grouped-by-`section`, sorted-by-`display_order` detail items, each visibly labeled with user-facing wording for its `source_type` ("From the contract" / "Operational information" / "Interpretation" / "Confirm before use"). The existing "Edit benefit" button remains a separate control; clicking it must not also trigger the read-only detail SlideOver (event handling must stop propagation or the two controls must not be nested in a way that both fire). Shared and Golf sections remain visually separate, matching the existing catalog layout. No React component gains a Supabase import — a new read method on the service layer is the only new data-access path.

## Contract Content Strategy

`contract_source_reference` is a short human-readable pointer (e.g. a section, table, or exhibit label) — never the contract text itself. No PDF, scanned contract, or verbatim contract excerpt is stored in the repository, a migration, or the application bundle. Seed content uses concise paraphrases and short factual statements, not extended quotation, keeping confidential contract material out of a public application bundle and out of git history.

## Resolved Naming and Quantity Questions

- **Spa Resort Credit naming**: `benefit_grants.name` stays exactly `"Spa Resort Credit"` — no migration renames it. `benefit_code` is `spa_resort_credit`. The contract's "Spa Resort Credit Pack" phrasing is recorded only as structured content (e.g. a `plain_language_summary` or an `included`-section item noting the contract's terminology), never as a schema rename.
- **Unlimited Golf Bonus Nights interpretation**: not a contradiction. `original_quantity` stays `8`, `quantity_kind` stays `nights`, the name is unchanged. Interpretation: eight qualifying bonus nights, each with unlimited golf for two people sharing a room, subject to operational availability and course rules. No "these numbers conflict" item is included; only narrower operational confirmation questions (exact tee-time rules, arrival/departure-day handling, cart, caddie, and other operational specifics) are retained as `confirm_before_use`.
- **Incentive Stay quantity discrepancy**: `benefit_grants.original_quantity` stays `6` — no accounting correction in this feature. `contract_quantity_text` represents the contract table's figure (four) separately from the accounting quantity. A visible `confirmation_questions` item states plainly that the application allocation (six) and the reviewed contract table (four) differ and require reconciliation — worded as an open discrepancy, not as a resolved correction in either direction. Any future change to the accounting `original_quantity` is explicitly out of scope here and must be its own separately reviewed data-correction task.
- **Golf Rounds expiration**: `benefit_grants.expiration_date` stays `null` — unchanged, no invented date. `contract_expiration_text` is set to: "No separate expiration is listed; use remains subject to the affiliation's validity and current program rules." No "never expires" wording anywhere.
- **Universal Credit restrictions**: the existing empty `restrictions` column is not treated as proof that no restrictions exist. Structured content is to be populated from the reviewed contract's actual content — but that specific content (what the contract says about Universal Credit beyond "populate from the reviewed contract") was not supplied in this step's decision list, so the exact `benefit_detail_items` rows for Universal Credit cannot be finalized yet; confirmation questions regarding redemption procedure, combinability, partial use, and property-specific availability are retained as directed. See Technical Contradictions or Open Questions.

## Proposed Step 3 Migration Sequence

Latest existing migration confirmed this step: `20260731190000_protect_benefit_grant_accounting_fields.sql`. Proposed filenames below are collision-free against the full current `supabase/migrations/` listing (verified via direct `ls`, not assumed) and are sequenced same-day, immediately following the existing series:

1. `20260731200000_add_benefit_detail_enums.sql` — creates `benefit_cost_model`, `benefit_stay_plan`, `benefit_detail_source_type`, `benefit_detail_section`. No table changes. Must run first since both following tables reference these types.
2. `20260731210000_add_benefit_grant_details.sql` — creates `benefit_grant_details` (full column/check list above), RLS policies, grants, audit/delete/updated-at triggers. Depends on (1).
3. `20260731220000_add_benefit_detail_items.sql` — creates `benefit_detail_items` (full column list above, index not unique constraint), RLS policies, grants, audit/delete/updated-at triggers. Depends on (1); independent of (2) except for logical grouping.
4. `20260731230000_add_benefit_grants_code.sql` — adds `benefit_grants.benefit_code text` (nullable), no constraint yet. Independent of (1)-(3); could technically run first, sequenced after for narrative clarity (identification before content).
5. `20260731240000_backfill_benefit_grants_code.sql` — one-time `update` statements matching the seven existing rows by exact `(membership_id, name)`, followed by `alter table ... add constraint ... check (benefit_code is not null)` (or `alter column benefit_code set not null`) and `unique (membership_id, benefit_code)`, with an explicit `raise exception` guard if the matched-row count is not exactly 7 before the `not null` constraint is applied. Depends on (4).
6. `20260731250000_seed_benefit_detail_content.sql` — inserts `benefit_grant_details`/`benefit_detail_items` rows for the seven benefits, keyed by `benefit_code` (never `name`). Depends on (2), (3), (5).

This sequence is a **proposal for Step 3**, not created in this step — no migration file exists yet.

## Proposed pgTAP Coverage

Extending `supabase/tests/001_business_rules.sql` (or a new numbered file matching the existing convention):

1. All four new enums exist with exactly the approved value sets, in the approved declaration order (assert via `enum_range` or `pg_enum` ordinal check for `benefit_detail_section` specifically, since its ordering is load-bearing for the default sort).
2. `benefit_grant_details.benefit_grant_id` uniqueness enforced (second insert for the same grant raises).
3. `benefit_grant_details`'s `maximum_nights >= minimum_nights` check raises when violated, and permits `null` on either side.
4. RLS: a non-member cannot `select` from either table; a member without admin role can `select` but not `insert`/`update`; a membership admin can `insert` and `update`.
5. Hard delete blocked on both tables (mirrors the existing `pg_temp.statement_raises` pattern).
6. Audit: a successful insert/update on each table produces a `log_audit_event()`-written `audit_log` row with the correct `entity_type`.
7. `updated_at` changes on `update`, unchanged on plain re-read.
8. `benefit_code` backfill: after the backfill migration, all seven existing rows have the exact approved codes; `unique (membership_id, benefit_code)` rejects a duplicate code within the same membership.
9. `benefit_code` backfill fail-loud guard: simulate a name mismatch (e.g. temporarily rename a seeded grant before the backfill logic runs, inside a rolled-back test transaction) and assert the migration's guard condition would raise — this may be better expressed as a direct assertion on the guard's `select count(*)` logic rather than re-running the actual migration inside a test transaction, since the migration itself is not re-runnable idempotently by design.
10. Ordering: insert several `benefit_detail_items` rows with mixed sections/`display_order` values and assert a plain `order by section, display_order, id` query returns them in the expected reading order.
11. Archival: archiving a `benefit_grants` row (setting `archived_at`/`archived_reason`) does not alter or remove any associated `benefit_grant_details`/`benefit_detail_items` rows.
12. Confirm `enforce_benefit_grant_immutability_trg` is unaffected — a referenced grant's protected accounting fields still reject changes exactly as before; a `benefit_grant_details` update on the same grant still succeeds regardless of the grant's usage status (proves the immutability boundary decision holds).

## Expected Files for Step 3

- New: the six migration files listed above.
- New: pgTAP additions to `supabase/tests/001_business_rules.sql` (or a new `supabase/tests/00N_benefit_details.sql`).
- New/updated: `supabase/MIGRATION_VERIFICATION.md` (new numbered sections, matching existing convention).
- Updated: `src/lib/database.types.ts` — regenerated via the Supabase CLI only, after migrations are applied locally, never hand-edited (explicitly out of scope for Step 2, listed here only as a Step 3 expectation).
- Not expected to change in Step 3: any service (`benefitsService.ts` or a new `benefitDetailsService.ts`) or UI file — those are Step 4/5 per the Step 1 sequencing, unless Step 3's own scope prompt narrows further.

## Technical Contradictions or Open Questions

Only genuine unresolved engineering questions are listed here — no product decision above is reopened without a concrete technical basis.

1. **Universal Credit's actual reviewed-contract content was not supplied in this step.** Decision 12 directs populating structured content "from the reviewed contract," but the specific facts (what the contract says about Universal Credit's redemption procedure, combinability, partial use, property availability) were not included in this step's decision list, unlike every other benefit which has at least one concrete supplied fact. This is not a contradiction to resolve technically — it's a content gap that will block writing a complete, honest `benefit_grant_items` seed row for this specific benefit in Step 3's seeding migration until the actual content is supplied, the same way Step 1 could not populate fields the repository didn't contain.
2. **`set_people_updated_at()` reuse by name.** Its body (`new.updated_at := now(); return new;`) is genuinely table-agnostic despite its `people`-specific name — reusing it avoids defining two near-identical new functions, but a reviewer may reasonably prefer a neutrally-named shared function (e.g. renaming or adding `public.set_updated_at()`) instead of attaching a `people`-named function to unrelated tables. This is a real implementation-detail choice for Step 3, not a blocker.
3. **The pgTAP backfill fail-loud guard (coverage item 9) is awkward to test as a true migration re-run**, since Postgres migrations in this repo are not designed to be replayed against already-migrated data. The test plan above proposes asserting the guard's underlying count-check logic directly rather than literally re-executing a failed migration — worth confirming this satisfies the spirit of "test the safeguard" before Step 3 writes it.

## Recommended BENEFIT-DETAILS / STEP-3 Prompt Scope

Schema-only: the six migrations above, applied and pgTAP-verified against the local Docker Supabase instance only (no hosted access), `supabase/MIGRATION_VERIFICATION.md` updated, `database.types.ts` regenerated via CLI. No service or UI code, matching the same phased pattern used throughout Issue #10 (schema → service → UI as separate, separately-reviewed steps). Universal Credit's `benefit_detail_items` seed rows should either be deferred to a follow-up seeding correction once its contract content is supplied, or Step 3's prompt should explicitly supply that missing content alongside the other six benefits' already-approved facts.

## Git Commit and Push Result

- **Commit SHA**: `5db2ffb256ccf2fdcdc95b6ee52d15904d44fa7e` (note: a commit's hash is a function of its own content, so a file committed inside that same commit cannot contain its own final hash with perfect self-consistency — this value was captured from the immediately-preceding commit of identical content and amended in; verify against `git log -1` on this branch if exactness matters)
- **Commit message**: `Add benefit details Step 2 decision report`
- **Files committed**: `docs/claude-reports/BENEFIT-DETAILS-STEP-2.md` only.
- **Remote branch**: `feature/structured-benefit-details`, pushed with upstream tracking set (`-u origin feature/structured-benefit-details`).
- **Final git status**: working tree clean, branch up to date with its new remote tracking branch, no other files staged, modified, or untracked.

## Confidence Assessment

High (0.9–1.0): all schema/migration-sequence facts (latest migration name, absence of naming collisions, existing trigger/function reuse validity) — directly verified this step via `ls`/`grep`, not recalled. The relationship model, RLS shape, and audit/delete-protection design are mechanical, low-risk applications of this repository's own established, unmodified patterns.
Medium (0.75–0.85): the exact migration file boundaries (six files is a reasonable grouping, not the only valid one) and the `set_people_updated_at()` reuse-by-name choice (flagged explicitly as a real, cheap-to-change implementation decision for Step 3).
Explicitly incomplete, not merely uncertain: Universal Credit's specific structured content — this step was not given the underlying reviewed-contract facts for that one benefit, and Step 3 cannot honestly seed it without either that content or an explicit decision to defer it.

No schema was created, no SQL was executed, no service or UI code was written, and no file other than this report was modified, per this step's restrictions.
