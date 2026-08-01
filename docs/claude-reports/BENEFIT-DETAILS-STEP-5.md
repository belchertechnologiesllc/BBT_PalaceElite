# REPORT LABEL: BENEFIT-DETAILS / STEP-5 / CLICKABLE-CARDS-AND-DETAIL-SLIDEOVER

## Branch and Starting State

Branch: `feature/structured-benefit-details`, based on `main` at `e4303d3`.
Starting state verified with `git status -sb`: clean working tree, three
commits ahead of `origin/feature/structured-benefit-details`
(`f3655dc`, `f228160`, `b3330ec` -- the Step 3/4 schema, service, and
report commits). `npx supabase test db` was failing overall (exit
unsuccessful) due to `002_people.sql`, even though the real suite passed.

## Supabase Test-Runner Cleanup

- **Original state:** `supabase/tests/002_people.sql` was 0 bytes.
  `git log --follow` shows it was created empty in commit `a8f82c3` ("Add
  people domain model") and never touched again -- it was a placeholder
  that was never filled in, not a file that regressed from a working
  state.
- **Chosen correction:** deleted the file (approved handling option 1: "If
  it is truly empty or only an unused placeholder"). Confirmed via `grep`
  across the repo that no documentation or script references
  `002_people.sql` by name (the only hit was this step's own Step 4
  report, describing the pre-existing defect, not depending on the file).
- **Why appropriate:** pg_prove/pgTAP requires every `.sql` test file to
  emit a TAP plan; an empty file has none, so it always fails the run
  regardless of the real suite's outcome. There was no test content to
  preserve or move, so option 2 (add a plan) or option 3 (relocate tests)
  did not apply.
- **`001_business_rules.sql` was not modified** by this cleanup; its 84
  assertions are unchanged from Step 4.
- **Complete `npx supabase test db` result** after the fix:
  ```
  /Users/tony/BBT_PalaceElite/supabase/tests/001_business_rules.sql .. ok
  All tests successful.
  Files=1, Tests=84,  2 wallclock secs (...)
  Result: PASS
  ```

## UI Files Created

- `src/components/BenefitDetailView.tsx` -- presentational, read-only
  detail component (props: `grant`, `detailView`, `isLoading`,
  `errorMessage`).

## UI Files Modified

- `src/pages/BenefitsPage.tsx` -- restructured `BenefitGrantCard`'s
  clickable region, added detail-request state/handlers, added a second
  `SlideOver` for read-only details, exported `formatDate` for reuse by
  the new component.
- `src/styles.css` -- added `.benefit-card-trigger` (clickable region,
  hover/focus-visible treatment), `.benefit-card-view-hint`, and a new
  `.benefit-detail-*` / `.source-badge-*` block for the SlideOver content.

## Card Interaction Design

`BenefitGrantCard` now renders:

```
<article class="benefit-card">
  <div class="benefit-card-trigger" role="button" tabIndex={0}
       aria-label="View details for {name}" onClick=... onKeyDown=...>
    <title row, dl of quantity/dates/restrictions, "View details" hint>
  </div>
  <button type="button" class="secondary-button button-block">Edit benefit</button>
</article>
```

The trigger is a `div`, not a native `<button>`, because its content
includes flow content (`<h4>`, `<dl>`) that a native `<button>` cannot
validly contain (button's content model is phrasing content only).
Keyboard operability is provided explicitly: `tabIndex={0}` makes it
focusable, and `onKeyDown` activates on both `Enter` and `Space` (with
`preventDefault()` on `Space` so the page does not also scroll). Pointer
users can click anywhere across the title/quantity/dates content, not
just a small link, satisfying "clickable across its main content area."

## Interactive-Markup Review

No nested buttons exist anywhere in this change. The detail-trigger `div`
and the "Edit benefit" `button` are **siblings** inside `<article
class="benefit-card">`, never one inside the other, so clicking Edit can
never also activate the details trigger (or vice versa) via event
bubbling -- no `stopPropagation()` workaround was needed because there is
no nesting to guard against. Verified by reading the rendered JSX
structure directly; there is exactly one `<button>` per card (`Edit
benefit`) and exactly one `role="button"` div (the trigger).

## Detail SlideOver Structure

Reuses the existing `SlideOver` primitive unmodified. `title` is bound to
`detailGrant.name` (the selected benefit's current display name, live from
`BenefitGrantRecord`, not a static string). An `eyebrow`-styled "Benefit
details" line is rendered as the first child of the body, matching the
existing eyebrow convention used elsewhere in the app (`PageHeader`,
`BenefitPoolSection`). `width="lg"` was chosen (720px) since populated
detail content -- typed-attribute grid plus grouped item lists -- is
noticeably longer than the existing `md` (560px) Edit form.

## Allocation and Typed Attributes Display

"Current allocation" (Pool, Original quantity, Quantity kind, plus Release
date/Expiration date/Restrictions when non-null) is built directly from
the already-known `BenefitGrantRecord` and rendered immediately when the
SlideOver opens -- it does not wait on `getBenefitDetail()`, since that
data was already available from the click that opened the panel.

"Typed attributes" (cost model, stay plan, minimum/maximum nights, guests
included, discount percentages, service fee required, Gold Season only,
contract quantity/expiration text, contract source reference) is built
from `detailView.detail` and renders only entries whose underlying value
is non-null; the whole section is omitted if every attribute is null. No
null value is ever rendered as a false-sounding default: nullable
booleans render `Yes`/`No` only when non-null and are omitted entirely
when null, per the explicit "no service fee" / "no season restriction" /
"never expires" anti-patterns called out in this step's instructions.

## Section and Source-Type Presentation

Enum values are mapped to the exact labels specified in this step's
instructions (`COST_MODEL_LABELS`, `STAY_PLAN_LABELS`, `SECTION_LABELS`,
`SOURCE_TYPE_LABELS` in `BenefitDetailView.tsx`) -- no raw snake_case
value is ever rendered. Items are grouped by section via
`groupItemsBySection()`, which walks `detailView.items` in the order the
service already returns (section, then `displayOrder`, then `id`) and
starts a new group only when the section value changes from the previous
item -- it does not sort or otherwise reorder. Each item shows its
statement plus a `source-badge-<sourceType>` pill with its mapped label;
`confirm_before_use` uses a distinct amber treatment (matching the
existing "Locked" tag's amber palette) from `contract`'s blue and
`operational`'s green, so it reads as visually distinct, not as an
equally-authoritative fact -- but the badge's text label is what actually
conveys the distinction (color is a secondary cue, not the only one).

## Loading, Error, and Empty States

- **Immediate name:** the SlideOver's own `title` is bound to
  `detailGrant.name`, set synchronously before the async request starts.
- **Loading:** `role="status"` text shown while `detailLoading` is true;
  the allocation section (synchronous data) still renders underneath it.
- **Error:** `role="alert"` block shown when `detailErrorMessage` is set;
  the SlideOver itself is untouched by the error (only `SlideOver`'s own
  close button/backdrop can close it, both already wired to
  `handleCloseDetails`).
- **`getBenefitDetail()` resolves `null`:** renders "No structured
  contract details have been authored for this benefit yet." -- distinct
  copy and code path from the error branch, never conflated with it.
- **Details row exists, `items: []`:** summary/typed-attributes still
  render normally; the "Detail sections" section renders "No additional
  detail sections have been authored." instead of an empty list.
- **No unhandled rejection:** `getBenefitDetail(...).then(...).catch(...)`
  in `handleViewDetails` handles both branches explicitly.

## Race and Stale-Request Handling

`detailRequestIdRef` (a `useRef` counter, not React state) is incremented
every time a new detail request starts *and* every time the SlideOver
closes. Each in-flight promise closes over the `requestId` value current
at the moment it was issued; both the `.then` and `.catch` handlers check
`detailRequestIdRef.current !== requestId` first and return early
(discarding the response) if it no longer matches. Concretely:

- **A then quickly B:** opening B bumps the ref before A's promise
  settles, so A's eventual response is discarded and B's (or a still-later
  C's) is the only one applied.
- **Close while loading:** `handleCloseDetails` bumps the ref and resets
  all detail state synchronously; a still-in-flight response for the
  closed request is discarded when it arrives, so it cannot reopen the
  panel or apply stale data to a closed SlideOver.

No new state-management library was introduced; this is a single `useRef`
counter plus the existing `useState` calls.

## Edit and Detail Coordination

- `handleViewDetails` calls `setSelectedGrant(null)` as its first
  statement, closing Edit before opening Details.
- `handleEdit` (the new wrapper now passed as `onEdit` to
  `BenefitPoolSection`) calls `handleCloseDetails()` before
  `setSelectedGrant(grant)`, closing Details (and invalidating any
  in-flight detail request) before opening Edit.
- Both SlideOvers' `open` props are independent booleans
  (`Boolean(selectedGrant)` / `Boolean(detailGrant)`), but the two
  handlers above guarantee they are never intentionally opened
  simultaneously through this UI.
- `handleSaveDetails`/`handleSaveAllocation` are untouched:
  `setSelectedGrant(updated)` still keeps the Edit SlideOver open after a
  successful save, exactly as before this step.

## Responsive Design

Added a `max-width: 640px` block: the typed-attribute grid collapses from
`repeat(auto-fill, minmax(200px, 1fr))` to a single column, and detail-item
rows switch from a horizontal `flex` row (statement + badge side by side)
to a stacked column so the source badge never forces horizontal scrolling
next to long statement text. `overflow-wrap: break-word` plus `min-width:
0` is applied to the attribute grid's `dd` and to
`.benefit-detail-item-statement`, so long contract text, property names,
and confirmation questions wrap normally instead of overflowing. The
existing `.slideover-body { overflow-y: auto }` already handles vertical
scrolling for longer populated benefits (e.g. Universal Credit's 15 items)
without any change needed there.

## Accessibility Review

- Details trigger: `role="button"` + `aria-label="View details for
  {name}"` gives it an accessible name independent of its visual content.
- Edit button: unchanged, named by its own visible text ("Edit benefit"),
  independently focusable, not nested inside the trigger.
- Focus order: trigger precedes Edit in DOM order, matching the visual
  top-to-bottom layout -- no `tabIndex` values other than `0`/default are
  used, so source order is the tab order.
- Section headings use real heading elements: SlideOver's own `<h2>`
  (title) → `<h3>` (Current allocation / Summary / Typed attributes /
  Detail sections) → `<h4>` (each section-group heading) -- a consistent,
  non-skipping hierarchy.
- Item lists use `<ul>`/`<li>`; attribute pairs use `<dl>`/`<dt>`/`<dd>`
  (matching the existing card's own `dl` convention).
- Loading uses `role="status"`; error uses `role="alert"` -- both live
  regions so assistive tech announces the state change without requiring
  focus to move.
- Source badges are never the only cue: the mapped label text ("From the
  contract", "Confirm before use", etc.) is always rendered alongside the
  color treatment.
- `SlideOver`'s existing close button and backdrop-click behavior were not
  modified, so keyboard-accessible close behavior is unchanged.
- No nested buttons or invalid interactive markup (see Interactive-Markup
  Review above).
- Long content wraps via `overflow-wrap: break-word`; no fixed pixel
  widths were introduced that would clip text at higher browser zoom
  levels.

## Static Content Accuracy Review

Traced each fact through the data path (never hard-coded in React):

- **BPG Weeks discounted, not complimentary:** `cost_model = 'discounted'`
  → renders "Discounted" via `COST_MODEL_LABELS`.
- **Incentive Stays 4-vs-6 discrepancy:** `contract_quantity_text`
  ("Contract table appears to list 4 Incentive Stays; the application
  allocation currently records 6.") renders verbatim under Typed
  attributes; the same discrepancy also appears as a
  `confirmation_questions` detail item.
- **Imperial Grand Weeks complimentary for two:** `cost_model =
  'complimentary'` → "Complimentary"; `guests_included = 2` → "Guests
  included: 2".
- **Spa Resort Credit restricted credit with a service fee:** `cost_model
  = 'credit'` → "Credit"; `service_fee_required = true` → "Service fee
  required: Yes".
- **Universal Credit non-cash:** `cost_model = 'credit'` plus its
  `plain_language_summary` ("flexible non-cash membership credit...")
  renders in the Summary section.
- **Golf Rounds 50% discounted, no "never expires":** `discount_percentages
  = {50}` → "Discount percentages: 50%"; `contract_expiration_text`
  ("No separate expiration is listed...") never contains the phrase
  "never expires" (already pgTAP-verified at the data layer in Step 3/4;
  this step only renders whatever that field contains, unmodified).
- **Unlimited Golf Bonus Nights, eight nights, unlimited golf per
  qualifying night:** `plain_language_summary` states this directly;
  `guests_included = 2` renders alongside it.

No component in this step branches on `grant.name` or `grant.benefitCode`
-- confirmed by inspection of `BenefitDetailView.tsx` and the modified
parts of `BenefitsPage.tsx`; every value shown is read from
`BenefitGrantRecord` or `BenefitDetailView` fields via generic label maps
keyed by enum value, never by benefit identity.

## Existing Workflow Regression Review

Static (code-level, not browser) review of each existing flow:

- **Create workflow:** `handleCreateSubmit`, the "Add benefit" button, and
  the Create `SlideOver` are byte-for-byte unchanged.
- **Edit metadata / Edit allocation:** `handleSaveDetails` /
  `handleSaveAllocation` bodies unchanged; the only change is that
  `onEdit` now points at the new `handleEdit` wrapper (which just adds a
  `handleCloseDetails()` call before the pre-existing
  `setSelectedGrant(grant)`), so the form itself and its save behavior are
  untouched.
- **Shared/Golf separation:** `sharedGrants`/`golfGrants` filtering and
  the two `BenefitPoolSection` calls are unchanged apart from the two new
  props being threaded through.

## Supabase Test Result

`npx supabase test db`:
```
/Users/tony/BBT_PalaceElite/supabase/tests/001_business_rules.sql .. ok
All tests successful.
Files=1, Tests=84,  2 wallclock secs (...)
Result: PASS
```
Full command exits successfully (not just the individual file), confirming
the Phase A fix.

## Build Result

`npm run build` (`tsc -b && vite build`) succeeds with zero errors:
```
✓ 94 modules transformed.
dist/assets/index-C865Myz3.css   15.36 kB │ gzip:  4.01 kB
dist/assets/index-vGvV9vO5.js   477.72 kB │ gzip: 132.48 kB
✓ built in 6.66s
```

`git diff --check` reported no whitespace errors (only benign CRLF
line-ending notices from Git, consistent with every other file in this
repo).

## Browser Verification Status

**No browser or browser-automation tool was available in this
environment** (no Playwright/Puppeteer/similar tool). All scenario review
listed above (open/close, loading, error, null detail, empty items,
populated detail, rapid A-to-B, close-while-loading, Edit/Detail
isolation, existing workflows, narrow-layout CSS) was performed as
**static code and CSS review only** -- reading the rendered JSX structure,
the state-transition logic, and the CSS rules directly -- verified to
compile and pass `tsc`/`vite build`, but **not exercised in a running
browser**. This is explicitly not characterized as browser verification.

## Test-Runner Commit

`36c1a9b` -- "Fix Supabase database test runner". Files:
`supabase/tests/002_people.sql` (deleted).

## UI Commit

`01d1d32` -- "Add structured benefit detail viewer". Files:
`src/components/BenefitDetailView.tsx` (new),
`src/pages/BenefitsPage.tsx`, `src/styles.css`.

## Report Commit

Recorded after this file is committed; see the branch's commit log
(message: "Add benefit details Step 5 UI report"). As in prior reports,
the SHA is necessarily written before that commit exists (self-referential
limitation, documented previously in the Step 2 report).

## Final Commit History

```
<report-sha> Add benefit details Step 5 UI report
01d1d32      Add structured benefit detail viewer
36c1a9b      Fix Supabase database test runner
b3330ec      Add benefit details Step 4 service report
f228160      Add benefit detail read service
f3655dc      Add structured benefit detail schema and content
77ec996      Add benefit details Step 3 schema report
81ea110      Add benefit details Step 2 decision report
e4303d3      Merge pull request #25 from .../fix/ownership-page-visual-cleanup
```

## Hosted Database Status

No hosted SQL or migration execution occurred at any point in this step.
`npx supabase test db` and all manual verification targeted only the local
Docker Postgres instance already running from Step 4
(`supabase_db_BBT_PalaceElite`, `127.0.0.1:54322`). No migration file was
added, modified, or reapplied in this step. `supabase db push --linked`
was never run.

## Final Git Status

After the three commits above (test-runner fix, UI, report), `git status
-sb` shows a clean working tree, ahead of
`origin/feature/structured-benefit-details` (pending push, performed
immediately after this report is committed, per this step's
instructions).

## Deviations or Findings

- `002_people.sql` was deleted rather than given a plan, since it never
  contained any test content to preserve (see Supabase Test-Runner
  Cleanup).
- No other deviation from the Step 5 instructions.

## Risks and Open Questions

- This UI has not been exercised in a real browser (see Browser
  Verification Status) -- a first manual pass in a running dev server
  before merge would be prudent to catch anything static review cannot
  (actual focus-ring rendering, real PostgREST response shapes, touch
  interaction on the clickable card region).
- The "View details" hint text is purely visual (`aria-hidden="true"`) and
  relies entirely on the trigger's `aria-label` for its accessible name;
  if that label is ever edited, the two must be kept in sync by hand.

## Recommended BENEFIT-DETAILS / STEP-6

Perform an actual browser/manual QA pass against the local dev server
(`npm run dev`) covering the scenario list in this report's Static
Scenario Review, then decide whether any detail-administration (write)
capability is in scope for a future step -- explicitly out of scope
through Step 5.

## Confidence Assessment

High confidence in the data-accuracy path (typed attributes and section
grouping are proven correct against real seeded content by the Step 3/4
pgTAP suite, and this step's rendering logic is a thin, generic mapping
over that already-verified data) and in the schema/test-runner cleanup
(directly verified). Moderate confidence in the interactive/accessibility
behavior: the markup and event-handling logic were reasoned through
carefully and match established patterns (native `SlideOver`, existing
button/badge classes), but -- as stated above -- none of it has been
exercised in an actual browser, so real focus/keyboard/touch behavior is
unverified beyond static review.
