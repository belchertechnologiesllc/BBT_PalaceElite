# REPORT LABEL: PALACE ELITE / DASHBOARD LIVE BENEFIT DATA

## Problem

`src/pages/DashboardPage.tsx` rendered a hard-coded local `benefits` array.
Editing a benefit's allocation on the Benefits page (e.g. Unlimited Golf
Bonus Nights, 8 → 7) succeeded in the database, but the Dashboard's
"Available membership benefits" section never read Supabase at all, so it
kept showing the original mocked values (`8 nights` for both original and
remaining) regardless of what the database actually held.

## Root Cause

Confirmed by inspection before making any change: `DashboardPage.tsx`
defined a local `const benefits: Benefit[] = [...]` array with every
benefit's name, pool, original/remaining quantity, and expiration date
typed in as string literals. No Supabase query existed anywhere in the
file for this section.

## Fix Summary

- Added `src/services/dashboardService.ts` (new, dedicated dashboard
  service — matches this repo's existing per-page service-layer
  convention, e.g. `benefitsService.ts`, `ownershipUnitsService.ts`) with
  one exported method, `getDashboardData()`, that returns the current
  membership (id/name/purchase price), its active ownership units, its
  live benefit balances, and a count of non-voided reservations.
- `getDashboardData()` reads `public.benefit_balances` — the
  `security_invoker` view defined in
  `20260728033000_initial_schema.sql` that already computes
  `remaining_quantity = original_quantity - sum(approved, non-voided
  quantity_used)` per grant — as the authoritative source for original vs.
  remaining, exactly as required. No new migration was needed or added;
  the view already existed and already had everything this page needed.
- Refactored `src/services/benefitsService.ts` to extract the existing
  "resolve the one membership this user can access" logic (previously
  private to `getBenefitAdministrationContext`) into an exported
  `resolveAccessibleMembership()` function, so the new dashboard service
  reuses the exact same zero/one/many-membership resolution and error
  messages instead of duplicating that logic. `getBenefitAdministrationContext`'s
  own public behavior is unchanged (same inputs, same outputs, same error
  messages) — this is a pure internal refactor, verified by the Benefits
  page continuing to work identically in browser testing below.
- Rewrote `DashboardPage.tsx`'s "Available membership benefits" section to
  render `data.benefits` from live `getDashboardData()` results instead of
  the hard-coded array. No benefit is identified by name or code anywhere
  in the new rendering code — every value (name, pool, quantities, dates)
  comes from the fetched row; only the *quantity_kind enum* (not the
  benefit's name) is branched on for unit-word formatting.

## Live vs. Static Classification

Per this task's explicit request to review the rest of the mocked data and
classify it, not just the required minimum section:

### Wired to live data now

| Value | Source | Why safe now |
|---|---|---|
| "Available membership benefits" (name, pool, remaining, original, expires) | `public.benefit_balances` | Required minimum; authoritative view already computes remaining quantity correctly |
| Purchase price + per-unit price | `memberships.purchase_price` ÷ live ownership-unit count | Both fields already exist and are read-only; no accounting logic invented |
| Open reservations | `count(*)` on `public.reservations` where `voided_at is null`, scoped to the membership | `reservations` already has a `voided_at` column with exactly this "not voided" semantics used elsewhere in the schema (mirrors `benefit_transactions`' own voiding pattern) |
| Next known expiration | Computed client-side from the same live benefit list: earliest `expiration_date >= today`, with **every** benefit name sharing that date (not a single hard-coded name) | Uses data already being fetched for the required section; no extra query, no invented business rule |

### Left static (documented, not touched)

| Value | Why it must stay static until a real workflow exists |
|---|---|
| "Shared value recorded" metric | No table or view anywhere computes a per-membership "economic value received" figure. It isn't `benefit_balances`, `purchase_price`, or anything else in the schema — it would need new business logic this task was not asked to invent. The existing mock already renders `$0.00` (every static `unit.sharedValue` is already `0`), so this is not misleadingly non-zero; it simply isn't wired to anything yet. |
| "Family equity position" table — "Shared value received" and "Golf allocation" columns | These require aggregating `public.benefit_transactions` by `ownership_unit_id` and pool. No transaction-entry UI exists anywhere in this app yet — the table's own "Add transaction" button is already `disabled` for exactly this reason. The `/10 rounds`, `/4 nights` denominators in the mock are not backed by any real per-unit cap anywhere in the schema; wiring live ownership-unit *names* here while leaving those invented caps in place would be more misleading than leaving the whole table static, so it was left completely unchanged. |
| "Family equity position" table — "Ownership unit" / "Members" columns | Deliberately **also** left static (not switched to `getActiveOwnershipUnits()`, even though that data is already fetched for the per-unit purchase-price division) to avoid a confusing half-live/half-static table: mixing real unit names with invented static financial figures in the same row would look more authoritative than it is. This is a judgment call, documented here explicitly rather than made silently. |

None of these static values were invented or changed in this task —
they are exactly the same static content that existed before, left
in place with the reasoning above now written down.

## Quantity and Expiration Formatting

- `currency` → `Intl.NumberFormat('en-US', { style: 'currency', currency:
  'USD' })`, reusing the exact formatter already used elsewhere on this
  page (`formatCurrency`).
- `weeks` / `nights` / `rounds` → singular/plural unit word based on the
  numeric value (`1 week` vs. `2 weeks`, etc.), via a small
  `QUANTITY_UNIT_WORDS` lookup keyed by `quantity_kind` — not by benefit
  name.
- `count` → formatted as `"N use"` / `"N uses"`. There is no single
  natural noun already tied to `quantity_kind = 'count'` anywhere in the
  app (unlike weeks/nights/rounds, which are literal units); the existing
  `QUANTITY_KIND_LABELS` convention in `BenefitGrantForm.tsx` labels it
  generically as `"Count"` for the *kind itself* (a dropdown option), not
  as a countable noun for a specific quantity. `"use"/"uses"` was chosen
  as the closest natural-reading generic noun that still branches purely
  on the enum value, never on which benefit it is (Incentive Stays, the
  only `count`-kind benefit in the seed data, renders as `"6 uses"`,
  confirmed in browser testing below).
- Expiration date → reuses `formatDate` (already exported from
  `BenefitsPage.tsx` for exactly this purpose) for non-null dates;
  `null` → the literal string `"No date listed"`.

## Files Changed

- `src/services/dashboardService.ts` — new.
- `src/services/benefitsService.ts` — extracted
  `resolveAccessibleMembership()` (exported), `getBenefitAdministrationContext`
  now calls it; no other change.
- `src/services/ownershipUnitsService.ts` — `getActiveOwnershipUnits()`
  gained an optional `signal?: AbortSignal` parameter (backward
  compatible; existing callers unaffected) so the Dashboard's request can
  be cancelled cleanly.
- `src/pages/DashboardPage.tsx` — rewritten as described above.

## A Defect Found and Fixed During Browser QA

Initial browser testing (both `npm run dev` and a production `vite
preview` build) showed one aborted network request
(`net::ERR_ABORTED`) per Dashboard load, for the `reservations` HEAD
request specifically. This was investigated thoroughly rather than
dismissed:

1. First hypothesis — React 18 StrictMode's dev-only double-effect —
   was tested and **ruled out**: the same single aborted request still
   occurred against a genuine production build (`vite preview`, verified
   via the bundled `react-dom.production.js`, which does not
   double-invoke effects).
2. Direct instrumentation (temporary `console.log` in the effect, later
   removed) confirmed the effect itself only ran **once** per mount — no
   double-mount, no double-fetch at the application level.
3. Full network-event logging (`request`/`response`/`requestfinished`/
   `requestfailed`) for that URL showed **exactly one real request and
   one real 200 response** — followed by a second `requestfailed`
   (`net::ERR_ABORTED`) event for the *same, already-succeeded* request.
   This is a known benign Chromium DevTools Protocol quirk specific to
   `HEAD` requests with no response body, not a real duplicate request
   and not an application bug.
4. Rather than merely documenting this as a known-benign artifact,
   `dashboardService.ts`'s reservations query was changed from
   `{ count: 'exact', head: true }` to `{ count: 'exact' }` (a normal GET
   with a body). Re-verified in a fresh production build: **zero**
   request/response/console anomalies of any kind for that endpoint —
   exactly one `REQUEST` → one `RESPONSE 200` → one `FINISHED`, nothing
   else. The reservations count for one membership is at most a handful
   of rows, so the small extra response body is immaterial.

A second, real improvement was also made independent of the above: the
Dashboard's data-loading effect now uses a genuine `AbortController`
wired into every Supabase/PostgREST call via `.abortSignal()` (both in
`dashboardService.ts` and, via the new optional parameter, in
`ownershipUnitsService.getActiveOwnershipUnits()`), with the controller
aborted in the effect's cleanup function. This is not working around the
HEAD-request quirk above (that was fixed separately, as described) — it
is a correctness improvement in its own right: without it, a component
unmount/remount (StrictMode double-invoke in dev, or a real fast
navigation-away in production) would leave the first invocation's
requests running to completion and discarded, wasting a full round trip
to Supabase for no benefit. With the abort wired through, that stale
in-flight work is cancelled outright.

## Browser Verification (Real Chromium via Playwright)

Performed against the local Supabase instance (`.env.local`, gitignored,
pointing at `127.0.0.1:54321` — the tracked `.env` still points at the
hosted project and was never used or modified) with a local test
administrator created through the repository's documented
`ADMIN_BOOTSTRAP.md` flow. Both `npm run dev` and a production `vite
preview` build were exercised; the network-quirk investigation above used
`vite preview` specifically to rule out dev-only causes.

- **Live data loads:** Dashboard's benefit grid renders all 7 seeded
  benefits with correct names, pools, quantities, and dates on first
  load.
- **The exact reported bug, end to end:** used the real "Edit benefit" →
  "Save allocation" form on the Benefits page to change Unlimited Golf
  Bonus Nights' original quantity from 8 to 7 (confirmed
  `ORIGINAL_QUANTITY_BEFORE_EDIT=8`, save-toast
  `"Unlimited Golf Bonus Nights allocation saved."`), then navigated to
  the Dashboard: its card shows **`Remaining: 7 nights`** and
  **`Original: 7 nights`** — confirmed via both the Playwright DOM read
  and a full-page screenshot (`01-dashboard-after-edit.png`). A regex
  check for a stray bare `8` anywhere in that specific card's text
  returned `false`.
- **Refresh persistence:** reloaded the page (`page.reload()`) — the
  card still shows 7/7 nights, proving this is genuinely live data, not
  a client-side cache of the earlier mock.
- **Other benefits unaffected:** all six other benefits render their
  original seeded values correctly (BPG Weeks 100/100 weeks, Incentive
  Stays 6/6 uses, Imperial Grand Weeks 2/2 weeks, Spa Resort Credit
  $3,740.00/$3,740.00, Universal Credit $280.00/$280.00, Golf Rounds at
  50% 20/20 rounds).
- **Shared/Golf separation:** exactly 5 cards carry the `pool-tag.shared`
  class and 2 carry `pool-tag.golf`, matching the seeded 5-Shared/2-Golf
  split, with the existing color-coded tag styling preserved unchanged.
- **Golf Rounds at 50% null-expiration handling:** its card shows the
  literal text `"No date listed"` (confirmed by direct text search), not
  an invented date.
- **Metrics grid:** Purchase price `$35,700.00` / `$11,900.00 per
  ownership unit` (live, computed from 3 live ownership units), Next
  known expiration `Mar 29, 2029` / `Universal Credit` (computed, not
  hard-coded — confirmed by re-testing with an injected empty benefit
  list, which correctly fell back to `"None scheduled"` / `"No benefits
  have a recorded expiration date"` instead of showing stale text), Open
  reservations `0` (live count).
- **Loading state:** with the `benefit_balances` REST call delayed 1.5s
  via Playwright network interception (network-layer only, no code
  change), `"Loading dashboard..."` renders immediately and is replaced
  by the populated content once the delayed response resolves.
  Screenshot: `02-loading-state.png`.
- **Error state:** with the `benefit_balances` call aborted at the
  network layer, an inline `role="alert"` renders
  (`"Unable to load dashboard" / "Supabase returned an error" /
  "TypeError: Failed to fetch"`) after `postgrest-js`'s own GET
  retry/backoff window (consistent with the same library behavior
  documented in `BENEFIT-DETAILS-STEP-6.md`). Screenshot:
  `03-error-state.png`.
- **Empty state:** with the `benefit_balances` call's response body
  replaced with `[]` (network-layer only), the benefits section renders
  `"No benefits found for this membership." / "Contact a membership
  administrator if this seems wrong."` instead of an empty grid or an
  error — while the metrics grid and ownership table (unaffected by an
  empty benefit list) continue to render normally. Screenshot:
  `04-empty-state.png`.
- **390px mobile layout:** no page-level horizontal overflow
  (`document.documentElement.scrollWidth <= clientWidth`); the benefit
  grid and metrics grid both collapse to a single column via their
  existing CSS (unmodified — `.benefit-grid`/`.metrics-grid` responsive
  rules already existed and needed no change). Screenshot:
  `05-mobile-390.png`.
- **Console/network cleanliness (final state, after the HEAD-request
  fix):** zero console messages beyond the app's own expected Vite/React
  DevTools lines, zero page errors, and **zero failed requests** across
  every scenario above.

## Local Verification

```
$ npm run build
✓ 95 modules transformed.
✓ built in 7.53s

$ git diff --check
(no output; exit 0 — only a benign CRLF notice from git, consistent with
 every other file in this repository)

$ npx supabase db reset
... (all 15 migrations reapplied cleanly; no migration was added or
     changed by this task) ...
Finished supabase db reset ... Reset local database.

$ npx supabase test db
Files=1, Tests=84, Result: PASS
```

The local database was reset to its clean seeded baseline (Unlimited Golf
Bonus Nights back to 8/8) after browser QA, so no disposable test edit
remains in the repository's local dev state. No migration file was added
or modified — the fix required none; `public.benefit_balances` already
existed with everything needed.

## What Was Not Changed

Per this task's explicit restrictions, confirmed by review of the full
diff before committing:

- No accounting rule, RLS policy, or trigger was touched.
- No transaction or reservation was created, voided, or altered (0
  transactions and reservations existed locally before and after this
  work, aside from the local-only Playwright QA browser session's
  benefit-allocation edit, which was reset away as described above).
- No benefit's pool membership changed.
- No structured benefit-detail content (`benefit_grant_details`,
  `benefit_detail_items`) was touched.
- Hosted Supabase was never accessed in this task at all — every
  command and every browser session used the local Supabase instance
  only.
- No migration file was added or modified.

## Recommended Follow-Up

Not performed in this task (out of scope):

- A transaction-entry workflow, which would let "Shared value received"
  and "Golf allocation" become genuinely live per ownership unit.
- A reservation-entry workflow, which would give "Open reservations" more
  meaning beyond a raw count once reservations start being recorded for
  real trips.

## Confidence Assessment

High confidence. The exact reported production bug was reproduced end to
end through the real UI (Benefits page edit → Dashboard read) against a
real Supabase instance, not simulated. All required states (loading,
error, empty) were exercised via genuine network-layer interception, not
assumed. One real defect (the HEAD-request network-reporting quirk) was
investigated to a definitive root cause across three independent lines of
evidence (StrictMode ruled out via production build, effect-invocation
count confirmed via direct instrumentation, and full request/response
event logging) before being fixed, rather than either dismissed
unexamined or accepted as unavoidable.
