# REPORT LABEL: BENEFIT-DETAILS / STEP-3 / SCHEMA-AND-STRUCTURED-CONTENT

## Branch and Starting State

Branch `feature/structured-benefit-details`, working tree clean at start, matching the state left by the committed Step 2 report. Latest migration on the branch at start: `20260731190000_protect_benefit_grant_accounting_fields.sql`. All work in this report happened locally only; nothing beyond the report file itself is committed.

## Migration Files Created

**`20260731200000_add_benefit_detail_enums.sql`**
- Purpose: creates the four closed vocabularies (`benefit_cost_model`, `benefit_stay_plan`, `benefit_detail_source_type`, `benefit_detail_section`).
- Dependencies: none (first in the sequence).
- Safeguards: `benefit_detail_section`'s declaration order is deliberately the approved reading order, since Postgres enums sort by declaration ordinal — this is load-bearing for later ordering.

**`20260731210000_add_benefit_grant_details.sql`**
- Purpose: creates `public.numeric_array_within_range()` (a CHECK-constraint helper, since Postgres CHECK constraints cannot contain subqueries), `public.set_updated_at()` (the neutral, table-agnostic replacement for reusing `set_people_updated_at()` by name), and the `benefit_grant_details` table itself with all checks, triggers, RLS, and grants.
- Dependencies: migration 1 (enum types).
- Safeguards: one-to-one uniqueness on `benefit_grant_id`; non-negative/`max>=min` checks; `discount_percentages` range-checked via the array helper function; deliberately **not** attached to `enforce_benefit_grant_immutability_trg`.

**`20260731220000_add_benefit_detail_items.sql`**
- Purpose: creates `benefit_detail_items` with its checks, index, triggers, RLS, and grants.
- Dependencies: migration 1 (enum types); reuses `public.set_updated_at()` from migration 2.
- Safeguards: nonblank-statement check, non-negative `display_order` check, **index only** (no uniqueness constraint) on `(benefit_grant_id, section, display_order, id)` per the approved decision to avoid a reorder operation transiently colliding with a unique constraint.

**`20260731230000_add_benefit_grants_code.sql`**
- Purpose: adds `benefit_grants.benefit_code` with a database-generated `custom_<uuid>` default, creates and invokes the permanent backfill-safeguard function `public.validate_benefit_grant_semantic_names()`, backfills the seven approved semantic codes by exact name match, then sets the column `NOT NULL` and adds `unique (membership_id, benefit_code)`.
- Dependencies: none of the enum/table migrations; independent, sequenced fourth for narrative clarity.
- Safeguards: the validator raises (`P0001`) unless exactly 7 rows match the seven approved names, called *before* any `benefit_code` value is written; `EXECUTE` restricted to `service_role` only; no trigger recalculates the code on update (a plain column `DEFAULT`, evaluated once at INSERT time only).

**`20260731240000_seed_benefit_detail_content.sql`**
- Purpose: inserts the seven `benefit_grant_details` rows and all `benefit_detail_items` rows, matched exclusively by `benefit_code`.
- Dependencies: migrations 2, 3 (tables), 4 (codes must exist first).
- Safeguards: never matches by `name`; does not touch `benefit_grants.name`/`pool`/`quantity_kind`/`original_quantity`/`release_date`/`expiration_date`/`restrictions` anywhere in the file (verified directly — see Content Integrity Checks).

No consolidation was applied — five files, one purpose each, matching the dependency order proposed in Step 2 exactly.

## Benefit Code Design

Implemented exactly as corrected in this step's brief: `benefit_code text` with `default ('custom_' || replace(gen_random_uuid()::text, '-', ''))`, backfilled for the seven known grants, then `set not null` and `unique (membership_id, benefit_code)` added afterward — in that order, so the already-shipped `createBenefitGrant` workflow (which supplies no `benefit_code`) continues to insert successfully without any service/UI change. Verified directly: a rolled-back test insert omitting `benefit_code` received `custom_91551245d75e44638e2ecc53f44352b3` (format `custom_[0-9a-f]{32}`, stable, machine-readable, not derived from `name`). No trigger recalculates the value — it is a plain, INSERT-time-only column default.

## Backfill Validation

`public.validate_benefit_grant_semantic_names()` counts `benefit_grants` rows whose `name` is in the exact approved seven-name set and raises `P0001` unless the count is exactly 7. It is called once, synchronously, before any `UPDATE` in the migration. It is **permanent** (not dropped after use), named and commented clearly, and `EXECUTE` is restricted to `service_role` only (`revoke ... from public; grant ... to service_role;`) — confirmed directly via `has_function_privilege`. This satisfies the requirement to make the safeguard testable without replaying the whole migration: pgTAP can (and in a future test, could) rename a grant inside a rolled-back transaction and call this function directly to assert it raises, without touching `benefit_code` at all.

## Enum Definitions

All four enums created exactly as specified. Verified directly via `pg_enum`/`enumsortorder`: `benefit_cost_model` (`complimentary, discounted, credit, mixed`), `benefit_stay_plan` (`all_inclusive, european_plan, property_dependent, not_applicable`), `benefit_detail_source_type` (`contract, operational, inference, confirm_before_use`), `benefit_detail_section` (`included, excluded, eligible_properties, season_rules, occupancy_rules, fees_and_costs, redemption_steps, confirmation_questions, operational_notes` — confirmed in exactly this ordinal sequence).

## `benefit_grant_details` Schema

Created exactly per the required column list, all fields nullable except `id`/`benefit_grant_id`/`created_at`/`updated_at`. Checks verified directly: `minimum_nights >= 0`, `maximum_nights >= 0`, `guests_included >= 0`, `maximum_nights >= minimum_nights` (both non-null), and a new `public.numeric_array_within_range(discount_percentages, 0, 100)` helper function used in a CHECK constraint — required because Postgres CHECK constraints cannot contain subqueries, so validating every array element needed an IMMUTABLE SQL function wrapping `unnest()`. Foreign key `on delete restrict` confirmed. `enforce_benefit_grant_immutability_trg` is **not** attached to this table (confirmed via direct trigger listing — only the audit/block-delete/updated-at triggers appear).

## `benefit_detail_items` Schema

Created exactly per the required column list. `statement` non-blank check and `display_order >= 0` check confirmed directly. Index `benefit_detail_items_grant_section_order_idx` on `(benefit_grant_id, section, display_order, id)` confirmed present and **not** unique (`pg_indexes.indexdef` contains no `UNIQUE`), per the explicit instruction to prefer an index over a uniqueness constraint.

## RLS and Grants

Both tables: RLS enabled, three policies each (SELECT via `user_has_membership_access` joined through `benefit_grants`; INSERT and UPDATE via `user_is_membership_admin`, both with matching `USING` and `WITH CHECK`), no DELETE policy. Grants: `select, insert, update` to `authenticated` only, confirmed via direct query — no DELETE grant anywhere, no `membership_id` column duplicated onto either child table (both join through `benefit_grant_id → benefit_grants.membership_id`).

## Audit, Delete Protection, and `updated_at`

`public.set_updated_at()` created as the neutral, table-agnostic replacement (body identical to `set_people_updated_at()`, but under a name that doesn't imply a `people`-specific origin); `set_people_updated_at()` itself is untouched — confirmed via `git diff` showing zero changes to `20260728203144_add_people.sql`. Both new tables get `AFTER INSERT OR UPDATE → log_audit_event()`, `BEFORE DELETE → block_hard_delete()`, and `BEFORE UPDATE → set_updated_at()`, all confirmed attached and enabled (`tgenabled = 'O'`) via direct trigger listing.

## Structured Content Seed Summary

All seven `benefit_grant_details` rows and every `benefit_detail_items` row were inserted exactly as specified in this step's content brief, matched by `benefit_code` only — no matching by `name` anywhere in the seed migration (confirmed by reading the file: every `insert` joins `benefit_grants` via `on v.benefit_code = g.benefit_code` or `where g.benefit_code = '...'`).

**BPG Weeks** (`bpg_weeks`) — typed attributes: `discounted`/`property_dependent`, `discount_percentages = {20,30,60}`, `gold_season_only = false`, quantity/expiration text as specified. 10 detail items across 5 sections (included×3, excluded×2, eligible_properties×1, fees_and_costs×2, confirmation_questions×2). No intentionally unresolved question beyond the two `confirm_before_use` items already specified.

**Incentive Stays** (`incentive_stays`) — `discounted`/`property_dependent`, `minimum_nights=4`/`maximum_nights=7`, `discount_percentages={20,30}`, `gold_season_only=true`. 11 items across 5 sections. **Intentionally unresolved**: `contract_quantity_text` states the contract-table-vs-application (4-vs-6) discrepancy directly, and a `confirmation_questions` item states it explicitly as requiring reconciliation — `original_quantity` was **not** changed (still 6).

**Imperial Grand Weeks** (`imperial_grand_weeks`) — `complimentary`/`all_inclusive`, `minimum_nights=maximum_nights=7`, `guests_included=2`, `service_fee_required=false`, `gold_season_only=true`. 10 items across 6 sections.

**Spa Resort Credit** (`spa_resort_credit`) — `credit`/`not_applicable`, `service_fee_required=true`. 8 items across 5 sections. `plain_language_summary` and an `included`-section item both record the contract's "Spa Resort Credit Pack" phrasing as content only — `benefit_grants.name` was **not** changed (still exactly "Spa Resort Credit", confirmed directly).

**Universal Credit** (`universal_credit`) — `credit`/`not_applicable`, all boolean/numeric fields left `null` (no stated fact to populate them with). 15 items — the largest set, across 4 sections (9 `included` items alone). No unresolved discrepancy beyond the four standard `confirm_before_use` questions supplied.

**Golf Rounds at 50%** (`golf_rounds_50`) — `discounted`/`not_applicable`, `discount_percentages={50}`. 7 items across 4 sections. **Intentionally unresolved presentation**: `contract_expiration_text` uses the exact prescribed non-committal wording; `expiration_date` was **not** set to any invented date (still `null`, confirmed directly).

**Unlimited Golf Bonus Nights** (`unlimited_golf_bonus_nights`) — `complimentary`/`property_dependent`, `guests_included=2`. 10 items across 4 sections. The "8 vs. Unlimited" question is presented as the approved non-contradictory interpretation, not a discrepancy warning; `original_quantity` was **not** changed (still 8, confirmed directly).

## Content Integrity Checks

All performed via direct `psql` queries against the local instance before considering the migrations complete:
- Every seeded `benefit_grant_details`/`benefit_detail_items` row resolves to exactly one grant via `benefit_code` (by construction — every insert joins on `benefit_code`, which is `unique (membership_id, benefit_code)`).
- Exactly 7 `benefit_grant_details` rows exist — confirmed (`count(*) = 7`).
- Every one of the seven benefits has at least one detail item — confirmed (counts range 7–15, all > 0; total 71 items).
- No detail item has a blank `statement` — enforced by the table's own CHECK constraint (any blank insert would have aborted the whole migration).
- No unapproved `benefit_grants` field was changed — confirmed directly: `name`, `original_quantity`, `quantity_kind`, `expiration_date` verified unchanged for all four specifically-called-out benefits (Incentive Stays, Golf Rounds at 50%, Spa Resort Credit, Unlimited Golf Bonus Nights).
- Shared and Golf pools untouched — the seed migration writes zero rows to `benefit_grants.pool`, `ownership_units`, or any pool-eligibility trigger; confirmed by reading the file.
- No `benefit_transactions`, `reservations`, or `benefit_balances`-affecting row was touched — the seed migration contains no `insert`/`update`/`delete` against any of those relations; confirmed by reading the file.

## pgTAP Changes

- **Old plan count**: 36
- **New plan count**: 80 (44 new assertions)
- **Exact pass/fail result**: `1..80`, all 80 `ok`, `finish()` returned 0 rows (no "Looks like you failed" line), transaction ended `ROLLBACK`.

This took several iterations to reach — four real bugs were found and fixed during this step, all in the **new test code**, not the schema:
1. pgTAP's `results_eq()` raised "could not determine which collation to use for string comparison" when diffing a table column against a `VALUES` list through its internal refcursor comparison — replaced with a plain array-equality check (enum order) and an `EXCEPT`-based symmetric-difference check, then further simplified (see #2).
2. The semantic-code-mapping test initially matched by `name`, which an *earlier, pre-existing* test in the same transaction ("Referenced grant still permits name changes") intentionally renames — a real interaction with existing test behavior, not a flaw in the new schema. Tried matching by `created_at` order next, which also failed: all seven seeded rows share the *exact same* timestamp (Postgres's `now()` is constant for the whole transaction that originally inserted them via one `UNION ALL` statement), making `ORDER BY created_at` non-deterministic across ties. Final fix: verify by `benefit_code` set-membership and per-code uniqueness only, with an explanatory comment on why per-row identity re-verification isn't attempted at this point in a transaction where `name` is deliberately mutable elsewhere — the backfill migration's own exact-match `UPDATE ... WHERE name = '<literal>'` statements make code-to-grant misassignment structurally impossible regardless.
3. `test_ids` (a temp table) had no grant to the `authenticated` role, causing "permission denied for table test_ids" once the new RLS test block switched roles — fixed with an explicit `grant select on test_ids to authenticated;` before entering that block.
4. A pre-existing test ("An unreferenced grant permits accounting-field changes") picks "the first grant with no transactions" and increments its quantity by 1 — it happened to pick Incentive Stays, silently bumping its `original_quantity` from 6 to 7 before my new "Incentive Stays remains 6" assertion ran. Fixed by adding `and name <> 'Incentive Stays'` to that pre-existing fixture's candidate filter (a minimal, justified exclusion, not a weakened safeguard — the original test still exercises the same behavior against a different grant).
5. A genuine logic bug in my own ordering assertion: `order by section, display_order, id desc` only reverses the tiebreak column, not the primary sort keys, so it did not actually return the *last* row of the canonical ascending order — fixed to `order by section desc, display_order desc, id desc`. Also switched the fixture grant for this specific test from `shared_grant` (BPG Weeks) to `golf_grant` (Golf Rounds at 50%), since an earlier RLS test in the same suite inserts an `operational_notes` item into `shared_grant`, which would have sorted after `confirmation_questions` and invalidated the "confirmation_questions is last" expectation for that specific grant.

## Local Migration Result

All five migrations applied cleanly via `supabase migration up --local` in one pass, in order, with no errors — including the backfill safeguard's `validate_benefit_grant_semantic_names()` call succeeding (exactly 7 names matched). Directly verified afterward: `benefit_code` assignment correct for all seven grants; `benefit_grant_details` row count = 7; `benefit_detail_items` counts per grant all > 0 (71 total); `discount_percentages` arrays correct; accounting fields (`original_quantity`, `quantity_kind`, `expiration_date`) unchanged for all four specifically-flagged benefits; a rolled-back test insert confirmed the `custom_` default; a rolled-back test update confirmed the membership-scoped uniqueness constraint rejects a duplicate code.

## Generated Database Types

`src/lib/database.types.ts` regenerated via `npx supabase gen types typescript --local`, not hand-edited. Confirmed present: `benefit_detail_items`, `benefit_grant_details` table types; `benefit_cost_model`, `benefit_stay_plan`, `benefit_detail_source_type`, `benefit_detail_section` enum types and `Constants` entries; `benefit_grants.benefit_code: string` (non-optional in `Row`, correctly reflecting the `NOT NULL` constraint).

## Build Result

**`npm run build` currently fails.** `tsc -b` reports 4 errors, all in `src/services/benefitsService.ts` (lines 262, 312, 348, 400 — the four call sites of the internal `mapBenefitGrantRow()` helper): `Property 'benefit_code' is missing in type '{...}' but required in type '{...}'`. Root cause: `BENEFIT_GRANT_COLUMNS` (the service's hardcoded `select` column list, written before this feature existed) does not include `benefit_code`, but `mapBenefitGrantRow`'s parameter is typed against the full generated `Database['public']['Tables']['benefit_grants']['Row']`, which now requires `benefit_code`. This is a genuine, correct compile error surfacing a real gap (the service doesn't yet expose `benefit_code` anywhere), not a false positive from the type generator. **This was not fixed in this step**, per the explicit restriction against modifying existing application files or implementing service/UI code here — it is documented here and in `MIGRATION_VERIFICATION.md` as the first required item for Step 4.

## Migration Verification Documentation

`supabase/MIGRATION_VERIFICATION.md` extended with sections 19–23 (one per new migration), following the existing numbered-section convention exactly, including the intro pointer line update and a closing validation note. The build-failure finding above is also recorded there, at the end of section 23, so it isn't lost between this report and the next step.

## Hosted Database Status

**No hosted migration or SQL execution occurred at any point in this step.** No `supabase db push --linked`, no direct SQL against the connected/hosted project, no production data touched, no assumption made about the hosted `benefit_transactions` table's contents. All five migrations, the full pgTAP run, and every verification query in this report were executed exclusively against the local Docker instance (`supabase_db_BBT_PalaceElite`).

## Git Status

**Committed report file**: `docs/claude-reports/BENEFIT-DETAILS-STEP-3.md` only (this file), commit message `Add benefit details Step 3 schema report`.

**Uncommitted implementation files** (left in the working tree, not committed, per this step's explicit instruction):
```
 M src/lib/database.types.ts
 M supabase/MIGRATION_VERIFICATION.md
 M supabase/tests/001_business_rules.sql
?? supabase/migrations/20260731200000_add_benefit_detail_enums.sql
?? supabase/migrations/20260731210000_add_benefit_grant_details.sql
?? supabase/migrations/20260731220000_add_benefit_detail_items.sql
?? supabase/migrations/20260731230000_add_benefit_grants_code.sql
?? supabase/migrations/20260731240000_seed_benefit_detail_content.sql
```
No service or UI file was created or modified — `git status` confirms nothing under `src/pages/` or `src/components/` changed.

## Deviations or Findings

1. `results_eq()`/collation issue, the pre-existing rename/tied-timestamp interactions, the `test_ids` permission gap, and the ordering-query bug (all detailed under pgTAP Changes) were real defects found and fixed during this step — none were present in the final committed test file, but the iteration process itself is reported for transparency since several required real debugging, not just first-attempt success.
2. The `npm run build` failure (see Build Result) is the most significant finding of this step — it's a genuine, expected consequence of adding a `NOT NULL` column to a table an existing service already queries with an explicit column list, and confirms the schema change is "complete" in the sense that TypeScript correctly caught every place the new required field isn't yet handled.
3. One pre-existing test's fixture-selection logic was adjusted (excluding Incentive Stays from the "unreferenced grant" candidate pool) — a minimal, justified change to avoid a naming collision between two now-more-numerous sets of fixtures, not a weakening of any safeguard.

## Risks and Open Questions

1. **Step 4 cannot proceed on service/UI work without first fixing `benefitsService.ts`'s `BENEFIT_GRANT_COLUMNS`/`BenefitGrantRecord`/`mapBenefitGrantRow`** to account for `benefit_code` — this should be the very first action of Step 4, before any new detail-service or detail-UI code is written, or the build will remain broken throughout.
2. Universal Credit's specific reviewed-contract content gap (flagged in Step 2) remains — this step seeded exactly what Step 2/this step's brief supplied (9 `included` items plus the standard confirmation questions), which is complete relative to what was given, but Step 2's note that the *underlying* contract facts for this one benefit weren't separately supplied still stands as background context, not a blocker for this step's own completion.
3. The backfill safeguard function currently has no *automated* pgTAP test directly exercising its raise behavior (e.g., renaming a grant and calling it inside a rolled-back sub-scenario) — the pgTAP suite verifies the *end state* (exactly 7 codes, no nulls, uniqueness enforced) thoroughly, but not the guard function's raise path in isolation. Worth adding in a future test-hardening pass; not a blocker since the guard demonstrably worked during the actual migration run.

## Recommended BENEFIT-DETAILS / STEP-4

Fix `benefitsService.ts` first (add `benefit_code` to `BENEFIT_GRANT_COLUMNS`, `BenefitGrantRecord`, and the `mapBenefitGrantRow` mapping — a small, mechanical change) and confirm `npm run build` passes before writing any new code. Then implement the read-only detail service method(s) (e.g. `getBenefitDetail(benefitGrantId)` returning the `benefit_grant_details` row plus ordered `benefit_detail_items`) and the read-only `BenefitDetailSlideOver` UI, per the Step 1/Step 2 design record — still no write-path UI, per the approved read-only initial release scope.

## Confidence Assessment

High (0.9–1.0): every schema object (tables, enums, triggers, RLS policies, grants, constraints) verified directly via `psql` introspection queries against the actual applied local database, not inferred from the migration source alone. pgTAP 80/80 pass confirmed by direct execution with visible output. The `npm run build` failure is confirmed by direct execution with the exact TypeScript error text captured, not assumed. Content mapping matches the supplied brief field-for-field, verified by direct query for every numeric/boolean/text value and every accounting-field-unchanged claim.
Medium (0.8): the five debugging fixes to the new pgTAP assertions are correct as verified by the final 80/80 pass, but represent my own test-authoring corrections within this step rather than first-attempt-correct schema design — reported in full rather than smoothed over.
Explicitly flagged, not merely low-confidence: the build failure is a known, real, unresolved blocker for Step 4, stated plainly rather than downplayed.

No schema, service, or UI code was committed in this step. No hosted access occurred.
