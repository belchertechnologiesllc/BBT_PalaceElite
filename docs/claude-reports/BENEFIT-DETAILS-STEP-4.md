# REPORT LABEL: BENEFIT-DETAILS / STEP-4 / SCHEMA-FINALIZATION-AND-DETAIL-SERVICE

## Branch and Starting State

Branch: `feature/structured-benefit-details`, based on `main` at `e4303d3`.

Starting working tree (uncommitted from STEP-3): the five migration files,
`src/lib/database.types.ts`, `supabase/MIGRATION_VERIFICATION.md`, and
`supabase/tests/001_business_rules.sql`. `npm run build` was failing.
Verified with `git status -sb` before making any change.

## Step 3 Review Findings

1. The `benefit_code` backfill in `20260731230000_add_benefit_grants_code.sql`
   matched rows by `name` alone, globally, with no `membership_id` scoping.
   Correct for the single seeded membership today, but not safe in general.
2. `public.validate_benefit_grant_semantic_names()` was retained as a
   permanent function whose only purpose was validating that one-time
   backfill.
3. `public.numeric_array_within_range()` silently accepted a non-null array
   containing a null element (`v < p_min or v > p_max` evaluates to null,
   not true, for a null `v`, so `not exists(...)` passed).
4. The STEP-3 pgTAP "exact seven semantic code mappings" test checked set
   membership/count only, not per-row identity, and was explicitly
   documented as doing so because the suite's own earlier rename test
   ("Referenced grant still permits name changes") made name-based
   verification impossible by that point in the transaction.
5. `numeric_array_within_range` had no explicit `search_path` and no
   privilege restriction.

## Membership-Scoped Backfill Correction

`20260731230000_add_benefit_grants_code.sql` now performs the backfill
inside a migration-local `do $$ ... $$` block:

- **Target membership identification:** `select g.membership_id into strict
  v_membership_id from benefit_grants g where g.name = any(expected_names)
  group by g.membership_id having count(*) = 7 and count(distinct g.name) =
  7`. `into strict` raises `NO_DATA_FOUND` if no membership qualifies and
  `TOO_MANY_ROWS` if more than one does.
- **Zero/multiple-membership safeguards:** both exceptions are caught and
  re-raised as explicit `P0001` errors with clear messages before any
  `benefit_code` value is written.
- **Duplicate-name safeguard:** the `having` clause requires
  `count(*) = count(distinct name) = 7`; a membership with a duplicate of
  one expected name (and thus more than 7 total matching rows, or fewer
  than 7 distinct names) fails to qualify as a candidate at all, which
  surfaces as the same "no membership found" failure.
- **Exact-row-count safeguard:** each of the seven `update` statements is
  scoped to `where membership_id = v_membership_id and name = '<exact
  name>'`, so a similarly-named grant in a different membership can never
  be touched.
- **Update-count verification:** after all seven updates, a `count(*)`
  query re-checks that exactly 7 rows in the target membership carry one of
  the seven approved codes; a mismatch raises before the column is
  finalized as `NOT NULL` + unique.

## Backfill Helper Removal

`public.validate_benefit_grant_semantic_names()` no longer exists anywhere
in the schema. Verified via `select
to_regprocedure('public.validate_benefit_grant_semantic_names()')`
returning `null`, and via a dedicated pgTAP assertion (see below). The
regenerated `database.types.ts` no longer lists it under `Functions`.

## Utility Function Security Review

- `numeric_array_within_range(numeric[], numeric, numeric)`: added `set
  search_path = pg_catalog`; execute revoked from `public`, granted only to
  `authenticated` (the only role that ever inserts/updates
  `benefit_grant_details`). Null-element behavior decided and documented:
  a non-null array containing a null element is invalid -- the check
  expression was changed from `v < p_min or v > p_max` to `v is null or v <
  p_min or v > p_max`. Verified for null array (valid), empty array
  (valid), boundary values 0/100 (valid), below-zero and above-100 values
  (invalid), and a null element inside a non-null array (invalid, new).
- `set_updated_at()`: already had `set search_path = pg_catalog, public`
  and `revoke execute from public` with no re-grant (trigger invocation
  does not require an explicit grant) -- unchanged, already satisfied this
  review.

## Final Migration Files

All five files under `supabase/migrations/`:
`20260731200000_add_benefit_detail_enums.sql`,
`20260731210000_add_benefit_grant_details.sql` (helper-function security
fix),
`20260731220000_add_benefit_detail_items.sql` (unchanged from STEP-3),
`20260731230000_add_benefit_grants_code.sql` (rewritten backfill),
`20260731240000_seed_benefit_detail_content.sql` (unchanged from STEP-3;
re-reviewed, see below).

## Final Structured Content Counts

Re-inspected `20260731240000_seed_benefit_detail_content.sql` line by line:
7 `benefit_grant_details` rows; 71 `benefit_detail_items` rows total
(bpg_weeks=10, incentive_stays=11, imperial_grand_weeks=10,
spa_resort_credit=8, universal_credit=15, golf_rounds_50=7,
unlimited_golf_bonus_nights=10). All matching is by `benefit_code` only.
No `name`/`pool`/`quantity_kind`/`original_quantity`/`release_date`/
`expiration_date`/`restrictions` column is touched. Incentive Stays
`original_quantity` remains 6; Spa Resort Credit `name` remains unchanged;
Golf Rounds at 50% `expiration_date` remains null; Unlimited Golf Bonus
Nights `original_quantity` remains 8. No `benefit_transactions`,
`benefit_balances`, or `reservations` row is touched by any of the five
migrations.

## Final pgTAP Results

- Previous plan (STEP-3): 80.
- Final plan (STEP-4): 84 (net +4: the STEP-3 "exact seven semantic code
  mappings" test was split into a one-membership-count check and a
  per-code identity check against grant IDs captured before any rename
  occurs in the suite; plus new tests for cross-membership code reuse, the
  removed backfill helper, and the null-discount-element rejection).
- Exact result: `Files=1 (001_business_rules.sql), Tests=84, Failures=0`
  (`npx supabase test db`, run against a full `supabase db reset`, not a
  patched database). A second, unrelated, pre-existing empty test file
  (`002_people.sql`, last touched in commit `a8f82c3`, untouched by this
  work) causes a separate "no plan found" failure in the same `test db`
  invocation; this is not part of this feature's scope.

## Generated Database Types

Regenerated via `npx supabase gen types typescript --local` against the
freshly-reset local database (not hand-edited). Confirmed
`validate_benefit_grant_semantic_names` no longer appears anywhere in the
file, and `benefit_grants.benefit_code: string` (non-optional) is present
in `Row`/`Insert`/`Update`.

## Existing Benefits Service Repair

`src/services/benefitsService.ts`: added `benefit_code` to
`BENEFIT_GRANT_COLUMNS`, `benefitCode: string` to `BenefitGrantRecord`, and
`benefitCode: row.benefit_code` to `mapBenefitGrantRow`. No other line
changed. `createBenefitGrant` still omits `benefit_code` from its insert
payload (the database default generates it), and its returned record now
includes the generated value because it flows through the same
`mapBenefitGrantRow` helper as every other method -- so
`updateBenefitGrantMetadata` and `updateBenefitGrantAccounting` also
return `benefitCode` with no further change. No display-name-based logic
was added anywhere. Archive, transaction, reservation, and balance
behavior are untouched.

## New Benefit Details Service

`src/services/benefitDetailsService.ts` (new file). Exports
`BenefitCostModel`, `BenefitStayPlan`, `BenefitDetailSourceType`,
`BenefitDetailSection`, `BenefitGrantDetailRecord`,
`BenefitDetailItemRecord`, `BenefitDetailView`, and the single method
`getBenefitDetail(benefitGrantId: string): Promise<BenefitDetailView |
null>`. Not imported by any React component in this step.

## Service Query and Ordering Design

Two queries: one `benefit_grant_details` lookup by exact
`benefit_grant_id` (`.maybeSingle()`), one `benefit_detail_items` lookup
by the same exact `benefit_grant_id`. Neither query is looped, so this
never becomes N+1 regardless of caller behavior. Since PostgREST does not
expose Postgres enum ordinal ordering through `.order('section')` (it
would sort the text representation alphabetically), the service defines an
explicit `SECTION_ORDER` map mirroring `benefit_detail_section`'s
declaration order and sorts items client-side by
`section → displayOrder → id`, exactly as required.

## Error and Null Handling

`benefitGrantId` is validated as a non-blank string before any query
(throws otherwise). A missing `benefit_grant_details` row returns `null`
directly (not converted from or masking an error). A details row with zero
items returns `{ detail, items: [] }`, never treated as an error. Supabase/
RLS errors from either query are thrown as `Error` with the underlying
message, never swallowed or converted to `null`. No service-role client is
used anywhere in this file (only the existing `supabase` client, which
uses the publishable/anon key already wired into the rest of the app).

## Build Result

`npm run build` (`tsc -b && vite build`) succeeds with zero errors after
this step's changes -- the STEP-3 `benefitsService.ts` compile failure
(`benefit_code` missing from `BENEFIT_GRANT_COLUMNS`/`BenefitGrantRecord`)
is resolved.

## Static Service Review

- No `supabase` import added to any React component (`benefitDetailsService.ts`
  is not imported anywhere yet).
- No display-name matching in either service file.
- No hard-coded membership UUID anywhere in this step's code (the schema
  migration locates the target membership dynamically; the service files
  never reference a membership at all).
- No service-role key used.
- No query against `benefit_transactions`, `benefit_balances`, or
  `reservations` in `benefitDetailsService.ts`.
- No write/upsert/edit/delete/archive/reorder method exists in
  `benefitDetailsService.ts`.
- `getBenefitCatalog`, `createBenefitGrant`, `updateBenefitGrantMetadata`,
  `updateBenefitGrantAccounting`, and `getBenefitAdministrationContext`
  retain their existing signatures and behavior.
- `createBenefitGrant` still works with no `benefitCode` input; confirmed
  by inspection (the insert payload is unchanged) and by the pgTAP fixture
  grant insert/assertions, which never supply `benefit_code` and still
  observe a generated `custom_` value.

## Schema Commit

`f3655dc` -- "Add structured benefit detail schema and content". Files:
`supabase/migrations/20260731200000_add_benefit_detail_enums.sql`,
`supabase/migrations/20260731210000_add_benefit_grant_details.sql`,
`supabase/migrations/20260731220000_add_benefit_detail_items.sql`,
`supabase/migrations/20260731230000_add_benefit_grants_code.sql`,
`supabase/migrations/20260731240000_seed_benefit_detail_content.sql`,
`supabase/tests/001_business_rules.sql`,
`supabase/MIGRATION_VERIFICATION.md`, `src/lib/database.types.ts`.

## Service Commit

`f228160` -- "Add benefit detail read service". Files:
`src/services/benefitsService.ts`, `src/services/benefitDetailsService.ts`.

## Report Commit

Recorded after this file is committed; see the branch's commit log
(message: "Add benefit details Step 4 service report").

## Final Commit History

```
<report-sha> Add benefit details Step 4 service report
f228160      Add benefit detail read service
f3655dc      Add structured benefit detail schema and content
77ec996      Add benefit details Step 3 schema report
81ea110      Add benefit details Step 2 decision report
e4303d3      Merge pull request #25 from .../fix/ownership-page-visual-cleanup
```

(The report-commit SHA is necessarily written before that commit exists;
see the same self-referential-SHA caveat recorded in the STEP-2 report.)

## Hosted Database Status

No hosted migration or SQL execution occurred at any point in this step.
Every verification query, the pgTAP suite run, and `supabase db reset`
targeted only the local Docker Postgres instance
(`supabase_db_BBT_PalaceElite`, `127.0.0.1:54322`). `supabase db push
--linked` was never run.

## Final Git Status

After the three commits above, `git status -sb` shows a clean working
tree, three commits ahead of `origin/feature/structured-benefit-details`
(pending push, performed immediately after this report is written and
committed, per this step's instructions).

## Deviations or Findings

- The STEP-3 report's documented build-failure follow-up is now resolved
  (see Build Result).
- No other deviation from the STEP-4 instructions.

## Risks and Open Questions

- `benefit_detail_items` still has no reorder/uniqueness guarantee on
  `(benefit_grant_id, section, display_order)` -- a future admin-authored
  reorder operation (out of scope through STEP-4) will need to decide
  whether to add one.
- The `confirmation_questions` items (e.g. the Incentive Stays 4-vs-6
  discrepancy) remain visible, unresolved product questions; nothing in
  this step attempts to resolve them.

## Recommended BENEFIT-DETAILS / STEP-5

Implement the UI: a clickable benefit card/row and a read-only detail
SlideOver in `BenefitsPage.tsx` (or a new component it renders) that calls
`getBenefitDetail`, rendering `items` grouped by section in the order the
service already guarantees, with an explicit empty state for `items: []`
and for `getBenefitDetail` returning `null` (no structured content authored
yet).

## Confidence Assessment

High confidence in the schema correction, security review, and pgTAP
coverage -- all locally verified against a from-scratch database reset,
not assumed. Moderate-high confidence in the service layer: it compiles,
follows the existing repo's service-layer conventions closely, and its
ordering logic was reasoned through explicitly, but it has not yet been
exercised by any UI, so real Supabase/PostgREST response shapes have not
been observed end-to-end through this new code path.
