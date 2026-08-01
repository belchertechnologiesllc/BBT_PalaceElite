# REPORT LABEL: BENEFIT-DETAILS / HOSTED-SUPABASE / READ-ONLY-READINESS

## Headline Finding

**There is no pending migration gap.** All 15 local migrations — including
the entire structured-benefit-detail set
(`20260731200000` through `20260731240000`) and the Step 4 correction to
the `benefit_code` backfill — are already recorded as applied on the
hosted `membership_tracker` project, and every corresponding schema
object, trigger, policy, enum, constraint, and index was independently
confirmed to exist with the exact expected definition. The seeded data
(seven benefit grants, seven `benefit_grant_details` rows, 71
`benefit_detail_items` rows) matches the expected shape and content
exactly, with zero discrepancies found in any accounting field. This
contradicts this assessment's original premise ("determine whether the
pending migrations can be applied safely") — there is nothing pending to
apply. This is reported as found, not glossed over, since presenting a
false migration-gap narrative would be worse than correcting the premise.

Every finding below was obtained via read-only `select` queries executed
through `supabase db query --linked` (Supabase's Management-API-backed
query runner) or via repository file inspection. No `insert`, `update`,
`delete`, `alter`, `create`, `drop`, `truncate`, `grant`, or `revoke`
statement was executed against the hosted project at any point, and
`supabase db push --linked` was never run.

## Repository State

1. `git fetch origin` — succeeded, found `main` 13 commits ahead
   (the merge of PR #26).
2. `git checkout main` — switched cleanly.
3. `git pull --ff-only` — fast-forwarded `e4303d3..5027e1e`.
4. `git log --oneline -1` confirms `HEAD` is `5027e1e`, "Merge pull
   request #26 from belchertechnologiesllc/feature/structured-benefit-details" —
   matches the expected merge commit exactly.
5. `git status -sb` — clean working tree, no ahead/behind vs.
   `origin/main`.
6. Read in full: `docs/claude-reports/BENEFIT-DETAILS-STEP-6.md`,
   `docs/claude-reports/BENEFIT-DETAILS-STEP-7.md`, and
   `supabase/MIGRATION_VERIFICATION.md`.
7. Local migration files, in timestamp order:

```
20260728033000_initial_schema.sql
20260728185815_enforce_transaction_immutability.sql
20260728203144_add_people.sql
20260730190000_add_ownership_units_update_policy.sql
20260731120000_add_people_display_order.sql
20260731130000_add_reorder_people_function.sql
20260731160000_revoke_default_truncate_grants.sql
20260731170000_add_ownership_units_shared_pool.sql
20260731180000_enforce_symmetric_pool_eligibility.sql
20260731190000_protect_benefit_grant_accounting_fields.sql
20260731200000_add_benefit_detail_enums.sql
20260731210000_add_benefit_grant_details.sql
20260731220000_add_benefit_detail_items.sql
20260731230000_add_benefit_grants_code.sql
20260731240000_seed_benefit_detail_content.sql
```

## Hosted Project Confirmation

Via `npx supabase projects list` (read-only project metadata):

| Field | Value |
|---|---|
| Project name | `membership_tracker` |
| Project ref | `euppepjigeufhjrtgzie` |
| Region | `us-west-2` |
| Status | `ACTIVE_HEALTHY` |
| Database host | `db.euppepjigeufhjrtgzie.supabase.co` |
| PostgreSQL version | `17.6.1.147` |
| Linked to this checkout | `true` |

Cross-checked via a live read-only query (`select current_database(),
version();`) executed against the linked project: returned
`PostgreSQL 17.6 ...`, consistent with the metadata above. **The
connected project matches the expected `membership_tracker` project
exactly** — confirmed, not assumed.

## Hosted Public Schema

`select table_name from information_schema.tables where
table_schema='public'` returned exactly 12 relations:

```
audit_log, benefit_balances, benefit_detail_items, benefit_grant_details,
benefit_grants, benefit_transactions, memberships, ownership_units,
people, profiles, reservations, unit_users
```

(`benefit_balances` is a view, not a base table — confirmed separately:
it does not appear in the `relkind='r'` / RLS-status query below, which
lists exactly the 11 base tables.) This set matches what the fully
merged local schema defines — no unexpected extra tables, no missing
tables.

## Hosted Migration History

`npx supabase migration list --linked` and a direct
`select version from supabase_migrations.schema_migrations order by
version` both show **all 15 local migration versions present on hosted,
1:1, with no gaps and no extras**:

```
20260728033000  20260728185815  20260728203144  20260730190000
20260731120000  20260731130000  20260731160000  20260731170000
20260731180000  20260731190000  20260731200000  20260731210000
20260731220000  20260731230000  20260731240000
```

## Exact Pending Migration List

**None.** Every local migration file has a corresponding entry in
`supabase_migrations.schema_migrations` on hosted. This includes all
eleven migrations the assessment brief specifically asked about
(`20260731120000` through `20260731240000`) — every one of them is
already applied.

## Migration Timestamp and Object-Collision Review

No timestamp collisions: 15 local files, 15 distinct hosted version
strings, exact 1:1 match, strictly increasing. No evidence of any
out-of-band schema change: every object created by the structured-detail
migrations (four enums, two tables, one column, one unique constraint,
one index, two helper functions, six triggers, six RLS policies) was
independently verified to exist with the exact definition the migration
files specify (see Structured Detail Object Status below) — nothing
"partially exists" or "differs from local migration definition." Notably,
`public.validate_benefit_grant_semantic_names()` — the permanent helper
function present in the original Step 3 draft of
`20260731230000_add_benefit_grants_code.sql` and explicitly **removed**
in the Step 4 correction (replaced with a migration-local `DO` block) —
was confirmed **absent** on hosted (`to_regprocedure(...)` returns
`null`). This confirms hosted was migrated using the **corrected**
Step 4 version of that migration, not the earlier flawed draft.

## Membership and Benefit Grant Aggregate Findings

All counts are aggregates only; no membership id, name, or other
identifier is disclosed.

1. **Total hosted memberships:** 1.
2. **Total hosted `benefit_grants`:** 7.
3. **Active vs. archived grants:** 7 active, 0 archived.
4. **Grants by pool:** `shared` = 5, `golf` = 2.
5. **Grants by `quantity_kind`:** `currency` = 2, `count` = 1,
   `nights` = 1, `weeks` = 2, `rounds` = 1.
6. **`benefit_grants.benefit_code` column exists:** yes (`text`, `NOT
   NULL`, default `'custom_' || replace(gen_random_uuid()::text, '-',
   '')` — matches the migration exactly).
7. **`benefit_code` values populated:** yes — 0 rows have a `null`
   `benefit_code` (all 7 populated).
8. **Duplicate non-null `(membership_id, benefit_code)` pairs:** 0 found.
9. **Exactly one row for each of the seven expected names, within the
   one hosted membership:** yes — the `benefit_code` distribution below
   shows each of the seven approved codes exactly once, and since there
   is only one membership total, this is trivially "within that
   membership."
10. **Exactly one membership satisfies all seven expected-name
    matches:** yes (there is only one membership, and it holds all
    seven).
11. **Any expected name appearing more than once inside that
    membership:** no.
12. **Other memberships containing any of those same expected names:**
    not applicable — there is only one membership on hosted.
13. **Extra benefit grants outside the expected seven:** no — total
    grant count is exactly 7, matching the seven approved codes with no
    remainder.
14. **Null or blank names:** 0.
15. **Any existing grant that would receive a generated `custom_` code
    rather than one of the seven semantic codes:** no — the `benefit_code`
    grouping below shows only the seven approved semantic values, no
    `custom_*` value present among the 7 grants.
16. **Fail-loud assumptions in `20260731230000_add_benefit_grants_code.sql`
    satisfied exactly:** yes. That migration's `do $$ ... $$` block
    requires locating exactly one membership with exactly the seven
    expected names (no duplicates, none missing) before writing any
    `benefit_code` value, then re-verifies exactly 7 rows carry an
    approved code afterward. The migration is already applied and its
    own internal safeguards already passed (it would have raised and
    aborted the whole transaction otherwise) — and the current hosted
    state independently confirms the same invariant still holds today.

`benefit_code` distribution (aggregate, confirms items 6–8 and 13–15
above):

| benefit_code | count |
|---|---|
| bpg_weeks | 1 |
| golf_rounds_50 | 1 |
| imperial_grand_weeks | 1 |
| incentive_stays | 1 |
| spa_resort_credit | 1 |
| universal_credit | 1 |
| unlimited_golf_bonus_nights | 1 |

## Seven-Benefit Backfill Compatibility

Directly satisfied by the findings above: the backfill already ran
(hosted migration `20260731230000` is applied), and its result state —
exactly seven grants, each with exactly one approved semantic code,
zero nulls, zero duplicates, zero stray `custom_` codes among the seven —
is exactly the state the migration's fail-loud checks were designed to
guarantee. There is nothing left to assess "before" applying this
migration; it has already been applied and its postconditions verified
directly against current hosted data, not merely trusted from the
migration's own internal checks.

## Accounting and Transaction Safety

1. **Total transaction count:** 0.
2. **Transaction count by status:** no rows (0 transactions of any
   status).
3. **Transaction count by benefit grant:** no rows (0 transactions
   reference any grant).
4. **Grants referenced by at least one transaction:** 0 of 7.
5. **Does any pending migration change accounting fields on referenced
   grants?** Not applicable — there is no pending migration, and
   separately, 0 grants have any recorded usage to protect.
6. **Does current hosted data satisfy the accounting-field-immutability
   migration's assumptions
   (`20260731190000_protect_benefit_grant_accounting_fields.sql`)?**
   Yes — trivially, since no transaction references any grant, the
   immutability trigger's "referenced grant" branch has never yet been
   exercised on hosted, and the "unreferenced grant" branch (fully
   editable) applies to all 7 grants.
7. **Do reservations reference benefit grants directly?**
   No — `public.reservations` has no `benefit_grant_id`/benefit-related
   column (confirmed via `information_schema.columns`), matching the
   documented local schema design where only `benefit_transactions`
   links a grant to a reservation.
8. **Do `shared`/`golf` pool values remain valid and separate?** Yes —
   the two-value enum distribution (5 `shared`, 2 `golf`) accounts for
   all 7 grants with no other value present.
9. **Is ownership-unit eligibility symmetric for current data?** Yes —
   3 ownership units total, `participates_in_shared_pool = true` for
   all 3, `participates_in_golf_pool = true` for 2 of 3; a join-based
   check found **0** `people` rows whose own
   `participates_in_shared_pool`/`participates_in_golf_pool` flag is
   `true` while their owning unit's corresponding flag is `false` — no
   symmetry violation exists in current data.
10. **Would enforcing symmetric pool eligibility fail on existing
    rows?** No — see (9); this migration
    (`20260731180000_enforce_symmetric_pool_eligibility.sql`) is
    already applied and hosted data already satisfies it with zero
    violating rows.
11. **Would existing transaction history be altered by any pending
    migration?** Not applicable — no pending migration exists, and
    there is no transaction history on hosted to alter (0 rows).

## Pool and Ownership Eligibility Compatibility

Covered directly under Accounting and Transaction Safety items 8–10
above: fully compatible, zero violations, already enforced.

## Structured Detail Object Status

All objects created by `20260731200000` through `20260731220000`
confirmed present and matching the local migration definitions exactly:

- **Enums** — `benefit_cost_model` (4 values: complimentary, discounted,
  credit, mixed), `benefit_stay_plan` (4 values: all_inclusive,
  european_plan, property_dependent, not_applicable),
  `benefit_detail_source_type` (4 values: contract, operational,
  inference, confirm_before_use), `benefit_detail_section` (9 values, in
  the load-bearing declaration order: included, excluded,
  eligible_properties, season_rules, occupancy_rules, fees_and_costs,
  redemption_steps, confirmation_questions, operational_notes) — all
  four enums' values and ordinal order match the migration files exactly.
- **Tables** — `benefit_grant_details` and `benefit_detail_items` both
  exist, both have `relrowsecurity = true`.
- **Triggers** — all 6 expected triggers present:
  `benefit_grant_details_audit_trg`,
  `benefit_grant_details_block_delete_trg`,
  `benefit_grant_details_set_updated_at_trg`,
  `benefit_detail_items_audit_trg`,
  `benefit_detail_items_block_delete_trg`,
  `benefit_detail_items_set_updated_at_trg`.
- **RLS policies** — all 6 expected policies present (one SELECT, one
  INSERT, one UPDATE per table; no DELETE policy on either table, matching
  the migration's intentional no-DELETE-grant design).
- **Helper functions** — `numeric_array_within_range` (`prosecdef =
  false`, i.e. `SECURITY INVOKER`, `search_path = pg_catalog`) and
  `set_updated_at` (`prosecdef = false`, `search_path = pg_catalog,
  public`) both present with the exact hardened settings from the Step 4
  security review. `validate_benefit_grant_semantic_names()` — the
  permanent helper removed in the Step 4 correction — confirmed
  **absent**.
- **Column** — `benefit_grants.benefit_code`: `text`, `NOT NULL`, default
  `'custom_' || replace(gen_random_uuid()::text, '-', '')`, matching the
  corrected migration exactly.
- **Constraint** — `benefit_grants_membership_id_benefit_code_key`:
  `UNIQUE (membership_id, benefit_code)`, present and matching.
- **Index** — `benefit_detail_items_grant_section_order_idx`: `btree
  (benefit_grant_id, section, display_order, id)`, present and matching.

No object was found to already-exist-differently, partially exist, or
have been created out of band — every object matches its migration
definition exactly, because every migration has, in fact, already run.

## Seeded Content Compatibility

- `benefit_grant_details` row count: **7** (matches expected).
- `benefit_detail_items` row count: **71** (matches expected), with the
  exact expected per-benefit distribution: bpg_weeks=10,
  golf_rounds_50=7, imperial_grand_weeks=10, incentive_stays=11,
  spa_resort_credit=8, universal_credit=15,
  unlimited_golf_bonus_nights=10 — summing to 71, identical to the
  counts documented in `supabase/MIGRATION_VERIFICATION.md` section 23.
- No unique-constraint collision risk found (the one-to-one
  `benefit_grant_id` unique constraint on `benefit_grant_details` is
  satisfied — exactly 7 detail rows for exactly 7 grants, no duplicates).
- No seeded semantic `benefit_code` collides with anything — see the
  distribution table above (each of the 7 exactly once).
- **Direct comparison of all seven grants' accounting fields
  (name/pool/quantity_kind/original_quantity/expiration_date) against
  the values documented in `supabase/MIGRATION_VERIFICATION.md` sections
  1 and 23 found zero discrepancies** — every field matches exactly:
  `BPG Weeks` (shared, weeks, 100, 2051-03-29), `Incentive Stays`
  (shared, count, 6, 2033-03-29), `Imperial Grand Weeks` (shared, weeks,
  2, 2031-03-29), `Spa Resort Credit` (shared, currency, 3740,
  2031-03-29), `Universal Credit` (shared, currency, 280, 2029-03-29),
  `Golf Rounds at 50%` (golf, rounds, 20, **null** expiration — matches
  "no date invented"), `Unlimited Golf Bonus Nights` (golf, nights, 8,
  2031-03-29). No name was renamed, no quantity was corrected, no
  expiration date was invented — exactly as the seed migration's own
  documented intent required.

**No discrepancy exists.** Per this step's instructions, had one been
found it would have been classified as blocked and documented without
proposing an overwrite — that branch does not apply here.

## Migration-by-Migration Risk Assessment

Since every migration is already applied and its postconditions
independently re-verified against current hosted data (not merely
inferred from the migration having "succeeded" at some point in the
past), every migration in the originally-requested list is assessed as
**Low risk / Already deployed and verified**:

| Timestamp | Filename | Object pre-existed? | Hosted data satisfies assumptions? | Risk | Reason |
|---|---|---|---|---|---|
| 20260731120000 | add_people_display_order.sql | N/A (already applied) | Yes | Low | Column present; no conflicting state possible to check further without exceeding this report's people-table scope, which was intentionally kept aggregate-only |
| 20260731130000 | add_reorder_people_function.sql | N/A (already applied) | Yes | Low | Function-only migration; no data precondition |
| 20260731160000 | revoke_default_truncate_grants.sql | N/A (already applied) | Yes | Low | Privilege-only migration; idempotent by nature |
| 20260731170000 | add_ownership_units_shared_pool.sql | N/A (already applied) | Yes | Low | Column present; 3/3 units show `participates_in_shared_pool = true` |
| 20260731180000 | enforce_symmetric_pool_eligibility.sql | N/A (already applied) | Yes | Low | 0 symmetry violations found in current `people`/`ownership_units` data |
| 20260731190000 | protect_benefit_grant_accounting_fields.sql | N/A (already applied) | Yes | Low | 0 transactions exist, so the "referenced grant" immutability branch is currently inert but present and correct |
| 20260731200000 | add_benefit_detail_enums.sql | N/A (already applied) | Yes | Low | All 4 enums present with exact expected values/order |
| 20260731210000 | add_benefit_grant_details.sql | N/A (already applied) | Yes | Low | Table, triggers, RLS, helper functions all present and hardened per Step 4 |
| 20260731220000 | add_benefit_detail_items.sql | N/A (already applied) | Yes | Low | Table, index, triggers, RLS all present |
| 20260731230000 | add_benefit_grants_code.sql | N/A (already applied) | Yes | Low | Corrected (Step 4) version confirmed deployed — membership-scoped backfill, no permanent helper function, unique constraint present, 0 nulls, 0 duplicates |
| 20260731240000 | seed_benefit_detail_content.sql | N/A (already applied) | Yes | Low | 7 detail rows + 71 items present with exact expected per-benefit counts and zero accounting-field drift |

**Expected failure mode** for all eleven, had they *not* already been
applied: none observed, since none were applied during this assessment
(strictly read-only). **Rollback considerations:** not applicable — no
forward action was taken in this session.

## Deployment Stop Checkpoints

The instructions require a stop checkpoint before
`20260731230000_add_benefit_grants_code.sql` and
`20260731240000_seed_benefit_detail_content.sql`, with explicit
validation of the hosted seven-row shape at those checkpoints. That
validation was performed directly in this assessment (see Membership and
Benefit Grant Aggregate Findings and Seven-Benefit Backfill
Compatibility above) — both checkpoints' conditions are satisfied by
current hosted state. Since both migrations are already applied, there
is no longer a "before" moment to checkpoint against; this section
documents that the validation those checkpoints exist to enforce has
been performed and passed, not that the checkpoints were exercised as
gates during a live deployment.

## Netlify Configuration Review

From `netlify.toml` (repository file, no hosted read needed):

- **Build command:** `npm run build` (`tsc -b && vite build`).
- **Publish directory:** `dist`.
- **Node version:** `20` (`NODE_VERSION = "20"` under
  `[build.environment]`).
- **SPA redirect/fallback:** present — `[[redirects]] from = "/*" to =
  "/index.html" status = 200`, correct for a client-side-routed SPA.
- **`VITE_SUPABASE_URL` usage:** confirmed in `src/lib/supabase.ts` via
  `import.meta.env.VITE_SUPABASE_URL`.
- **Browser-safe Supabase key variable name:** `VITE_SUPABASE_ANON_KEY`
  — an anon/publishable key by name and by usage (passed directly to
  `createClient` for the browser client).
- **No service-role key in frontend configuration:** confirmed —
  `grep -rn "SERVICE_ROLE\|service_role" src/` returned no matches
  anywhere in application source.
- **Netlify environment variables themselves** (the actual values
  configured in the Netlify dashboard for the production site) were
  **not** inspected — that is a Netlify-platform read, not a repository
  or hosted-Supabase read, and is out of this assessment's stated
  read-only-Supabase scope. This must still be confirmed as a manual
  step before any real deployment (see Required Post-Migration
  Production Steps).

## Mobile Web Readiness

- **Mobile viewport metadata:** present —
  `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`
  in `index.html`.
- **Is the merged UI responsive?** Yes, per direct browser verification
  already performed and documented in
  `docs/claude-reports/BENEFIT-DETAILS-STEP-6.md` (real Chromium/
  Playwright testing at 1440/1024/768/390px, one defect found and fixed)
  and `docs/claude-reports/BENEFIT-DETAILS-STEP-7.md` (keyboard
  accessibility re-verified at 1440/390px) — not re-tested in this
  session, since this session's scope is hosted-database read-only
  assessment, not a repeat of browser QA already completed and reported.
- **Will "Add to Home Screen" work as a browser shortcut?** Yes, in the
  basic sense every modern mobile browser supports pinning any HTTPS page
  as a home-screen shortcut/bookmark (Safari "Add to Home Screen", Chrome
  "Add to Home screen") — this works today with zero additional
  configuration, launching the page in a browser tab/chrome.
- **Does PWA support exist?** No — no `manifest.json` or service worker
  was found anywhere in the repository (`find . -iname "manifest*.json"`
  returned nothing outside `node_modules`). Without a web app manifest,
  "Add to Home Screen" produces a plain browser bookmark rather than an
  installable, standalone-display PWA (no custom icon/splash screen, no
  offline capability, opens with browser chrome visible). This remains
  optional future work, exactly as this assessment's instructions
  characterize it — not a blocker for the basic mobile-web experience.

## Required Post-Migration Production Steps

Documented as the standard sequence for when the maintainer is ready to
promote this to production — **none of these were performed in this
session**:

1. Explicitly authorize hosted migration deployment.
2. Apply migrations in verified order — **already done**; this step
   would be a no-op confirmation, not new work, since
   `supabase_migrations.schema_migrations` already lists all 15 versions.
3. Run hosted verification queries — the queries in this report (and in
   `supabase/MIGRATION_VERIFICATION.md`) already serve this purpose and
   have already been run with passing results.
4. Configure Netlify production environment variables
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` pointing at the hosted
   project) in the Netlify dashboard — **not verified in this session**
   (platform-config read, out of scope; see Netlify Configuration Review).
5. Deploy `main` (Netlify build/publish) — **not performed**, per this
   assessment's explicit restriction.
6. Configure Supabase Auth Site URL and redirect URLs for the production
   domain — **not verified in this session** (Auth service configuration
   is not a `select`-able database table; this needs a manual dashboard
   check, not a SQL read).
7. Test login and benefit details over HTTPS on the deployed production
   URL.
8. Test on actual iPhone/Android devices over Wi-Fi and cellular.
9. Add to Home Screen (works today as a browser bookmark; see Mobile Web
   Readiness).
10. Consider PWA support (manifest + service worker) separately later,
    as optional future work.

## Hosted Migration Readiness Classification

**Ready for migration authorization.**

This classification requires an important caveat, stated plainly: it
does **not** mean "the maintainer should now run `supabase db push
--linked`." It means **the migration set has already been safely
applied**, and every read-only check this assessment performed against
current hosted data confirms that deployment was correct, complete, and
produced zero discrepancies from the expected schema and seed content.
If `supabase db push --linked` were run against this project right now,
it would find nothing new to apply (all 15 versions already recorded)
and would be a safe no-op. Per this assessment's explicit instructions,
this classification is **not** to be interpreted as authorization to
deploy anything — no deploy action of any kind was taken or is being
recommended as an immediate next step here.

## Blockers

None found for the database/migration layer. Two items remain
**unverified in this session** (not blockers, but open items requiring a
manual, non-SQL check before a production Netlify deployment):

1. Netlify's actual configured production environment variables (Netlify
   dashboard, not a repository or database read).
2. Supabase Auth's Site URL / redirect URL configuration for the
   production domain (Auth service dashboard setting, not a
   `select`-able table).

## Risks and Open Questions

- This assessment found that hosted deployment had already occurred by
  the time this session began, with no record in this conversation of
  who or what applied it. This is worth the maintainer's own awareness:
  a `supabase db push --linked` (or equivalent) was run against
  production data at some point between the Step 7 report being written
  and this session starting, outside of any step explicitly authorized
  in this conversation's history.
- 0 transactions and 0 reservations currently exist on hosted, meaning
  the accounting-immutability trigger's "referenced grant" protections
  are correct but functionally untested against a real referenced row on
  this specific hosted database (they are, however, already covered by
  the 84-assertion local pgTAP suite, which does exercise that exact
  path).
- PWA support remains unimplemented, as expected/optional per this
  assessment's own instructions.

## Confidence Assessment

High confidence in every finding above: each was obtained via a direct,
individually-executed read-only SQL query or repository file read, not
inferred or assumed. The single most significant finding — that the
migration gap this assessment was framed around does not exist — is
reported exactly as found, with the evidence that established it shown
inline (schema_migrations contents, live object/column/constraint/
trigger/policy existence checks, and exact-value data comparisons),
rather than silently substituting a "yes it's safe to deploy" narrative
for a request that assumed deployment had not yet happened.
