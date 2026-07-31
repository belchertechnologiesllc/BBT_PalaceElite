# Proposal: Order members within ownership units

Status: steps 1-3 implemented (persisted `display_order`, atomic reorder
function, and MembersPage reordering controls), not yet committed. Step 4
test plan is written (see below and `supabase/MIGRATION_VERIFICATION.md`
sections 13-14) but **not executed** — this environment has no live
Supabase connection, no local Docker/`supabase start` stack running, and
no test framework. Step 5 (deploy) remains.

The "`getActivePeople()` does not filter on `is_active`" open question
below was resolved during step 3: `getActivePeople()` now filters on
`is_active = true` as well as `archived_at IS NULL`, matching
`getOwnershipUnits()`'s existing definition of an active member. This is
a real behavior change — a person who is deactivated but not archived
will no longer appear on the Members page at all, whereas before they
appeared without any visual distinction from active members.

## Objective

Allow an authorized administrator to control the display order of People
cards inside each ownership-unit section on the Members page.

## Recommended behavior

- Cards can only be reordered within their current ownership unit.
- Reordering does not change the person's ownership-unit assignment.
- Use drag-and-drop on desktop, with accessible Move up and Move down
  controls as a keyboard/mobile fallback.
- Save the new order immediately or through an explicit Save order action.
- Refreshing the page preserves the selected order.
- Reordering is authorization-protected and recorded in audit history.

## Database change

Add a persistent ordering column to `people`, preferably:

```sql
display_order integer not null default 0
```

The Members query would then order by:

```
ownership unit order
  → person display_order
  → last name
  → first name
```

The name fallback ensures deterministic rendering for existing records
before they receive customized positions.

Because several cards may need new positions in one operation, avoid
issuing many independent client updates. Add a database function such as:

```
reorder_people_within_ownership_unit(...)
```

That function should:

- verify the caller is a membership administrator;
- confirm every supplied person belongs to the same membership and
  ownership unit;
- update the complete sequence atomically;
- reject missing, duplicated, unauthorized, inactive, or cross-unit
  person IDs;
- allow the existing audit mechanism to record each changed row.

This preserves consistency if a network request fails halfway through.

## Important scope boundary

"Move" could also mean moving a person from one ownership unit to
another. That is kept separate from card ordering. This feature only
rearranges cards within an ownership unit; changing ownership-unit
assignment has accounting and authorization implications and stays part
of a later member-management workflow.

## Open questions raised during review

- **The reorder function is not required for authorization.** Unlike
  `ownership_units` (which had no UPDATE policy at all before
  `20260730190000_add_ownership_units_update_policy.sql`), `people`
  already has a full `"membership admins can update people"` UPDATE
  policy and grant. A naive per-row `.update()` loop would already be
  authorized today. The function's value is atomicity and stronger
  validation (reject missing/duplicate/cross-unit ids), not closing a
  security gap — worth being precise about this distinction wherever the
  function is documented.
- **"Ownership unit order" does not exist yet.** `ownership_units` has no
  persisted order column; both `MembersPage` and the new `OwnershipPage`
  currently `.order('name')` alphabetically. Until/unless unit-level
  ordering becomes its own feature, "ownership unit order" in the sort
  chain above means the existing alphabetical-by-name order.
- **`getActivePeople()` does not currently filter on `is_active`** — only
  on `archived_at IS NULL`. Inactive-but-not-archived people are
  therefore already shown as cards today. If the reorder function
  rejects inactive ids, an admin could see a card they can't move. This
  needs to be resolved one way or the other before shipping the UI:
  either tighten the display filter to active-only, or drop the
  inactive-rejection rule.

## Sequence

1. Add persisted `display_order`.
2. Add the atomic reorder function and RLS-safe service method.
3. Add card reordering controls to `MembersPage`.
4. Test persistence, authorization, mobile interaction, and audit
   entries.
5. Deploy the migration before deploying the UI.

## Step 4 — test plan

**Not executed.** Nothing has been applied to Supabase in this
environment (no live project connection, no `supabase start`/Docker
stack running, no service-role credentials used), and this repository
has no automated test framework, so none of this could be run as part
of implementing steps 1-3. The database-level checks are in
`supabase/MIGRATION_VERIFICATION.md` sections 13-14. The checklist below
covers the parts that need the running app in a browser against a real
(or local) Supabase instance.

### Persistence

- [ ] Reorder cards in a unit, click Save order, confirm the toast and
      the new on-screen order.
- [ ] Reload the page (hard refresh) — order should match what was
      saved, not the pre-reorder order.
- [ ] Reorder a *different* unit's cards, click Save order — confirm the
      first unit's already-saved order is untouched.
- [ ] Start a reorder (drag or Move), do **not** save, then trigger an
      unrelated reload (e.g. add a new person elsewhere) — confirm the
      unsaved draft is discarded (per the `useEffect` on `people`) rather
      than silently persisting or causing a save-time mismatch error.

### Authorization

- [ ] As a membership admin: reorder and save successfully.
- [ ] As an authenticated non-admin (a `unit_users` row with
      `role <> 'admin'`, or no `unit_users` row at all): attempt a
      reorder — confirm the RPC call fails and the `orderError` banner
      shows a clear message, not a raw Postgres error code.
- [ ] Confirm the failed attempt did **not** change `display_order` for
      any row (matches 14b/14c).

### Mobile interaction

- [ ] On a touch device or a narrow/mobile browser viewport: confirm
      native HTML5 drag-and-drop is **not** expected to work (this is a
      known limitation of touch browsers, which the proposal anticipated
      by requiring the Move up/down fallback) — verify this doesn't
      produce a broken or stuck state, just no drag response.
  - [ ] Confirm Move up / Move down buttons work correctly via tap and
      are large enough to comfortably tap on a small screen.
  - [ ] Confirm Save order / Reset order buttons are reachable and usable
      at mobile widths (`.page-heading-actions`'s existing responsive
      rule stretches buttons full-width under 640px — confirm this
      layout still reads sensibly here since it wasn't designed with this
      row in mind).

### Audit entries

- [ ] After a successful save, confirm `audit_log` has one row per
      reordered person with `entity_type = 'people'`, `action = 'UPDATE'`,
      and `previous_data`/`new_data` reflecting the `display_order`
      change (matches 14e).
