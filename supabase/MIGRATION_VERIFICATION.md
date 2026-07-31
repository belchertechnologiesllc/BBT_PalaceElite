# Migration verification

Read-only checks to run from the Supabase SQL Editor (or `psql`) after
applying `supabase/migrations/20260728033000_initial_schema.sql`, to confirm
the schema landed as intended. None of these statements modify data — they
are all `select` queries against catalog views or the seeded rows.

Sections 1-11 cover the initial schema migration. Section 12 covers
`20260730190000_add_ownership_units_update_policy.sql`. Sections 13-14
cover `20260731120000_add_people_display_order.sql` and
`20260731130000_add_reorder_people_function.sql`. Section 15 covers
`20260731160000_revoke_default_truncate_grants.sql`. Sections 16-18 cover
`20260731170000_add_ownership_units_shared_pool.sql`,
`20260731180000_enforce_symmetric_pool_eligibility.sql`, and
`20260731190000_protect_benefit_grant_accounting_fields.sql`
(ISSUE-10 / STEP-3).

## 1. Seed data landed correctly

```sql
select name, contract_number, purchase_price from public.memberships;

select name, participates_in_golf_pool, ownership_percentage
from public.ownership_units
order by name;
-- Expect: Belcher = true, "Belcher Sr." = true, Tatro = false.

select name, pool, quantity_kind, original_quantity
from public.benefit_grants
order by pool, name;
-- Expect 5 "shared" rows and 2 "golf" rows (Golf Rounds at 50%,
-- Unlimited Golf Bonus Nights).
```

## 2. No CASCADE deletes on core accounting entities

```sql
select
  tc.table_name,
  kcu.column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.table_name in ('ownership_units','benefit_grants','reservations','benefit_transactions','unit_users','profiles')
order by tc.table_name, kcu.column_name;
```

Expect `delete_rule` to be `RESTRICT` (or `NO ACTION`) for every row except
`profiles.id -> auth.users(id)`, which remains `CASCADE` by design (see the
comment above the `profiles` table in the migration — it is transitively
protected by the `RESTRICT` foreign keys from `benefit_transactions`,
`reservations`, and `audit_log` that reference `profiles(id)`).

## 3. Composite membership-consistency constraints exist

```sql
select conname, conrelid::regclass as table_name, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.benefit_transactions'::regclass, 'public.reservations'::regclass)
  and contype = 'f'
order by conrelid::regclass::text, conname;
```

Expect to see multi-column `FOREIGN KEY (membership_id, ...)` definitions
referencing `ownership_units`, `benefit_grants`, and `reservations` by their
composite unique keys.

## 4. Hard deletes are blocked and audit-log tampering is blocked

These use `begin ... rollback` so nothing is actually changed:

```sql
begin;
  delete from public.memberships;
rollback;
-- Expect: ERROR: Hard deletes are not permitted on table "memberships" ...

begin;
  update public.audit_log set action = 'x' where id = (select min(id) from public.audit_log);
rollback;
-- Expect: ERROR: public.audit_log is append-only; UPDATE is not permitted.
```

## 5. Golf-pool eligibility trigger is present and wired up

```sql
select tgname, tgrelid::regclass as table_name, tgenabled
from pg_trigger
where tgname = 'enforce_pool_eligibility_trg';
```

To confirm the business rule itself (still read-only — rolled back):

```sql
begin;
  insert into public.benefit_transactions (membership_id, ownership_unit_id, benefit_grant_id, quantity_used)
  select m.id, ou.id, bg.id, 1
  from public.memberships m
  join public.ownership_units ou on ou.membership_id = m.id and ou.name = 'Tatro'
  join public.benefit_grants bg on bg.membership_id = m.id and bg.pool = 'golf'
  limit 1;
  -- Expect: ERROR: Ownership unit ... does not participate in the golf benefit pool
rollback;
```

## 6. SECURITY DEFINER functions are hardened

```sql
select
  p.proname,
  p.prosecdef as is_security_definer,
  p.proconfig as pinned_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
order by p.proname;
```

Expect every row's `pinned_settings` to include
`search_path=pg_catalog, public`.

```sql
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
order by routine_name, grantee;
```

Expect no `PUBLIC` grantee, and `bootstrap_administrator` granted only to
`service_role` (plus the table owner).

## 7. `audit_log` has no client DML grants

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'audit_log'
order by grantee, privilege_type;
```

Expect `anon`/`authenticated` to have `SELECT` only — no `INSERT`, `UPDATE`,
or `DELETE`.

## 8. Balance view uses `security_invoker`

```sql
select relname, reloptions
from pg_class
where relname = 'benefit_balances';
```

Expect `reloptions` to contain `security_invoker=true`.

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'benefit_balances';
```

Expect `authenticated` to have `SELECT`, and no grant to `PUBLIC`/`anon`.

## 9. Row Level Security is enabled on every accounting table

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
  and relname in ('memberships','ownership_units','profiles','unit_users','benefit_grants','reservations','benefit_transactions','audit_log');
```

Expect `relrowsecurity = true` for every row.

## 10. New-user provisioning trigger exists

```sql
select tgname, tgrelid::regclass as table_name
from pg_trigger
where tgname = 'on_auth_user_created';
```

Expect one row: `on_auth_user_created` on `auth.users`.

## 11. No administrator was accidentally seeded

```sql
select count(*) from public.unit_users;
```

Expect `0` immediately after the migration runs, before
`supabase/ADMIN_BOOTSTRAP.md` has been followed.

---

**Note on local validation performed for this PR:** these checks (plus
insert/void/approve flows and RLS isolation between two mock Auth users) were
exercised against a disposable local PostgreSQL 16 instance with a minimal
mock `auth` schema, *not* against the live Supabase project. That local
database was dropped afterward and is not part of this repository.

## 12. `ownership_units` UPDATE policy landed correctly

Checks for
`supabase/migrations/20260730190000_add_ownership_units_update_policy.sql`,
which adds the missing UPDATE policy/grant on `public.ownership_units`
without touching any other privilege, column, or existing policy.

### 12a. The new policy exists, is scoped to UPDATE, and reuses the
admin-check helper

```sql
select
  polname,
  polcmd,
  pg_get_expr(polqual, polrelid) as using_expression,
  pg_get_expr(polwithcheck, polrelid) as with_check_expression
from pg_policy
where polrelid = 'public.ownership_units'::regclass;
```

Expect two rows:
- `membership users can read units` — `polcmd = 'r'` (SELECT), unchanged
  from the initial schema migration.
- `membership admins can update units` — `polcmd = 'w'` (UPDATE), with both
  `using_expression` and `with_check_expression` equal to
  `user_is_membership_admin(membership_id)`.

Both a `using` and `with check` clause referencing the *new* row's
`membership_id` are required — without `with_check`, an administrator could
update a row's `membership_id` to move it into a membership they do not
administer, since only the pre-update row would be checked.

### 12b. `authenticated` has UPDATE; `anon` does not

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ownership_units'
order by grantee, privilege_type;
```

Expect `authenticated` to have `SELECT` and `UPDATE` only. Expect no row for
`anon`, and no `INSERT` or `DELETE` for any grantee — this migration adds
only `grant update ... to authenticated` on top of the existing
`grant select ... to authenticated` from the initial schema migration.

### 12c. DELETE remains blocked, and an unauthorized UPDATE is rejected

These use `begin ... rollback` so nothing is actually changed:

```sql
begin;
  delete from public.ownership_units
  where id = (select id from public.ownership_units limit 1);
rollback;
-- Expect: ERROR: Hard deletes are not permitted on table "ownership_units" ...
```

Run as an authenticated user who is **not** an admin of the target
membership (or as `anon`, where RLS alone already blocks the statement):

```sql
begin;
  update public.ownership_units
  set members_description = 'RLS smoke test'
  where id = (select id from public.ownership_units limit 1);
rollback;
-- Expect 0 rows updated (RLS silently filters the target row rather than
-- raising, per standard Postgres RLS UPDATE behavior) when the caller is
-- not public.user_is_membership_admin() for that unit's membership.
```

### 12d. Existing audit and hard-delete-blocking triggers are untouched

```sql
select tgname, tgrelid::regclass as table_name, tgenabled
from pg_trigger
where tgrelid = 'public.ownership_units'::regclass
  and tgname in ('ownership_units_audit_trg', 'ownership_units_block_delete_trg');
```

Expect both rows present and `tgenabled = 'O'` (enabled), unchanged from the
initial schema migration — this migration does not create, drop, or replace
any trigger.

### 12e. No column, percentage, or unrelated-policy drift

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'ownership_units'
order by ordinal_position;
```

Expect the same eight columns as before this migration
(`id`, `membership_id`, `name`, `members_description`,
`ownership_percentage`, `participates_in_golf_pool`, `archived_at`,
`created_at`) — no additions (e.g. no shared-pool or archive-reason column),
no drops, no type changes.

```sql
select name, ownership_percentage from public.ownership_units order by name;
-- Expect unchanged values: Belcher = 33.3333, "Belcher Sr." = 33.3333,
-- Tatro = 33.3334 (see section 1) — this migration contains no DML.
```

## 13. `people.display_order` landed correctly

Checks for `supabase/migrations/20260731120000_add_people_display_order.sql`.

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'people' and column_name = 'display_order';
```

Expect one row: `integer`, `is_nullable = 'NO'`, `column_default = '0'`.

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.people'::regclass and conname = 'people_display_order_check';
```

Expect `CHECK ((display_order >= 0))`.

```sql
select display_order, count(*) from public.people group by display_order;
```

Expect every existing row still at `display_order = 0` (the migration is additive-only, no backfill logic beyond the column default).

## 14. `reorder_people_within_ownership_unit` is atomic, admin-gated, and audited

Checks for `supabase/migrations/20260731130000_add_reorder_people_function.sql`.
**Not executed** — this repository has no live Supabase connection available in
this environment; these are the checks to run once one is.

### 14a. Least privilege

```sql
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'reorder_people_within_ownership_unit'
order by grantee;
```

Expect `authenticated` with `EXECUTE`, no `PUBLIC` row.

```sql
select proname, prosecdef, proconfig
from pg_proc
where proname = 'reorder_people_within_ownership_unit';
```

Expect `prosecdef = true` and `proconfig` containing `search_path=pg_catalog, public`.

### 14b. Authorization is enforced

As a real authenticated user who is **not** an admin of the target membership:

```sql
select public.reorder_people_within_ownership_unit(
  '<some ownership_unit_id>'::uuid,
  array['<person_id_1>', '<person_id_2>']::uuid[]
);
-- Expect: ERROR: Membership administrator access is required
```

### 14c. Validation rejects malformed input, one case at a time

As a real admin, each of these should raise before touching any row:

```sql
-- Missing a currently-active person from the unit
select public.reorder_people_within_ownership_unit('<unit_id>'::uuid, array['<only_some_of_the_ids>']::uuid[]);

-- Includes an id from a different ownership unit
select public.reorder_people_within_ownership_unit('<unit_id>'::uuid, array['<id_from_another_unit>']::uuid[]);

-- Includes an inactive (is_active = false) person's id
select public.reorder_people_within_ownership_unit('<unit_id>'::uuid, array['<inactive_person_id>']::uuid[]);

-- Duplicate id in the array
select public.reorder_people_within_ownership_unit('<unit_id>'::uuid, array['<id>', '<id>']::uuid[]);
```

Expect each to raise `ERROR: p_person_ids must contain exactly the active people ...`
or `ERROR: p_person_ids contains duplicate person ids`, and expect **zero rows
changed** — confirm with `select id, display_order from public.people where ownership_unit_id = '<unit_id>'`
before and after each failed call.

### 14d. A valid reorder is atomic and persists

```sql
select public.reorder_people_within_ownership_unit(
  '<unit_id>'::uuid,
  array['<id_now_first>', '<id_now_second>', '<id_now_third>']::uuid[]
);

select id, display_order from public.people
where ownership_unit_id = '<unit_id>' and is_active = true
order by display_order;
```

Expect `display_order` to be `0, 1, 2` in the array's order.

### 14e. The reorder is captured in `audit_log`

```sql
select entity_id, action, previous_data ->> 'display_order' as old_order, new_data ->> 'display_order' as new_order
from public.audit_log
where entity_type = 'people'
order by created_at desc
limit 5;
```

Expect one row per reordered person, `action = 'UPDATE'`, and `old_order`/
`new_order` reflecting the change — confirms `people_audit_trg` captured
`display_order` automatically with no trigger changes, as expected since
`log_audit_event()` logs `to_jsonb(old)`/`to_jsonb(new)` (the whole row).

## 15. `anon`/`authenticated` no longer have TRUNCATE on any table

Checks for `supabase/migrations/20260731160000_revoke_default_truncate_grants.sql`.
Unrelated to the reorder feature — found while testing it locally, shipped
alongside it rather than separately.

This closes a gap that predates every migration in this repository: this
Supabase project has a platform-set `ALTER DEFAULT PRIVILEGES FOR ROLE
postgres IN SCHEMA public` entry that grants `TRUNCATE`, `REFERENCES`, and
`TRIGGER` to `anon`/`authenticated`/`service_role` on every table created
by role `postgres` — which is every table in this schema. `TRUNCATE` is
not filtered by row level security, so this silently let an unauthenticated
caller wipe any table, including `audit_log`, in one statement.

### 15a. No table grants TRUNCATE/REFERENCES/TRIGGER to anon/authenticated

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
order by table_name, grantee, privilege_type;
```

Expect zero rows.

```sql
select has_table_privilege('anon', 'public.audit_log', 'TRUNCATE') as anon_truncate_audit_log;
```

Expect `false` — this specific check is the one that failed before this
migration.

### 15b. The default is fixed for future tables too

```sql
select defaclrole::regrole, defaclacl
from pg_default_acl
where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r';
```

Expect the `postgres`-role entry's ACL to no longer include `D` (truncate),
`x` (references), or `t` (trigger) for `anon`/`authenticated`.

### 15c. Existing DML grants are untouched

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
order by table_name, grantee, privilege_type;
```

Expect this list to be identical before and after the migration — compare
against a snapshot taken before applying it. In particular `authenticated`
should still have exactly `SELECT`+`UPDATE` on `ownership_units`,
`SELECT`+`INSERT`+`UPDATE` on `people`, `SELECT` on `memberships` and
`audit_log`, and `anon` should still have none of these on any table.

---

**Note on local validation performed for this fix:** applied and verified
against a local Docker Postgres instance (`supabase start`), not the
connected/hosted project — `has_table_privilege()` confirmed `false` for
`anon`/`authenticated` TRUNCATE across every table in `public` after the
migration, and a snapshot of SELECT/INSERT/UPDATE grants taken before and
after confirmed no legitimate privilege was affected.

## 16. `ownership_units.participates_in_shared_pool` landed correctly

Checks for `supabase/migrations/20260731170000_add_ownership_units_shared_pool.sql`.

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ownership_units'
  and column_name = 'participates_in_shared_pool';
```

Expect one row: `boolean`, `is_nullable = 'NO'`, `column_default = 'true'`.

```sql
select name, participates_in_shared_pool, participates_in_golf_pool
from public.ownership_units
order by name;
```

Expect: Belcher = (true, true), "Belcher Sr." = (true, true), Tatro = (true, false).
The Golf column must be unchanged from section 1 — this migration does not
touch `participates_in_golf_pool`.

```sql
select col_description('public.ownership_units'::regclass, ordinal_position)
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ownership_units'
  and column_name = 'participates_in_shared_pool';
```

Expect a non-null explanatory comment.

## 17. Symmetric Shared/Golf eligibility enforcement is wired up

Checks for `supabase/migrations/20260731180000_enforce_symmetric_pool_eligibility.sql`.

```sql
select tgname, tgrelid::regclass, tgenabled
from pg_trigger
where tgname in ('people_pool_eligibility_trg', 'enforce_pool_eligibility_trg');
```

Expect both triggers still attached to `public.people` and
`public.benefit_transactions` respectively, `tgenabled = 'O'` — trigger
*attachment* is unchanged by this migration; only the underlying function
bodies were replaced via `CREATE OR REPLACE FUNCTION`.

```sql
select proname, prosecdef
from pg_proc
where proname in ('enforce_people_pool_eligibility', 'enforce_pool_eligibility');
```

Expect `prosecdef = false` (`SECURITY INVOKER`) for both — unchanged from
before this migration.

Functional checks (run inside a transaction you intend to roll back, or see
the pgTAP suite in `supabase/tests/001_business_rules.sql` for the same
checks run automatically):

- Inserting a `people` row with `participates_in_shared_pool = true` under
  an ownership unit whose `participates_in_shared_pool = false` must raise.
- Inserting a `people` row with `participates_in_golf_pool = true` under
  Tatro (`participates_in_golf_pool = false`) must still raise, exactly as
  before this migration.
- Inserting a `benefit_transactions` row against a `shared`-pool grant for
  an ownership unit with `participates_in_shared_pool = false` must raise.
- The existing Golf-pool transaction behavior (Tatro rejected, Belcher
  accepted) must be unchanged.

## 18. `benefit_grants` accounting fields are locked once referenced by a transaction

Checks for
`supabase/migrations/20260731190000_protect_benefit_grant_accounting_fields.sql`.

```sql
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.benefit_grants'::regclass and not tgisinternal
order by tgname;
```

Expect three rows: `benefit_grants_audit_trg`, `benefit_grants_block_delete_trg`,
and `enforce_benefit_grant_immutability_trg`, all `tgenabled = 'O'`.

```sql
select has_function_privilege('anon', 'public.enforce_benefit_grant_immutability()', 'EXECUTE') as anon_can_exec,
       has_function_privilege('authenticated', 'public.enforce_benefit_grant_immutability()', 'EXECUTE') as auth_can_exec;
```

Expect both `false` — this is a trigger-only function, never called
directly by any client role, consistent with `block_hard_delete` and
`prevent_audit_log_tampering`.

Functional checks (see `supabase/tests/001_business_rules.sql` for the
automated equivalents):

- On a grant with **zero** `benefit_transactions` rows referencing it,
  every field (`membership_id`, `pool`, `quantity_kind`, `original_quantity`,
  `release_date`, `expiration_date`, `name`, `restrictions`, `archived_at`/
  `archived_reason`) remains editable.
- On a grant with **at least one** `benefit_transactions` row referencing
  it (any status — draft, submitted, approved, or voided all count),
  attempting to change `membership_id`, `pool`, `quantity_kind`,
  `original_quantity`, `release_date`, or `expiration_date` must raise.
- `created_at` must be rejected on **every** update to `benefit_grants`,
  regardless of whether the grant has any referencing transactions.
- `name`, `restrictions`, and `archived_at`/`archived_reason` (set
  together) must remain editable on a referenced grant, and the resulting
  `UPDATE` must still produce an `audit_log` row via the unchanged
  `benefit_grants_audit_trg`.

---

**Note on local validation performed for sections 16-18:** applied and
verified against the same local Docker Postgres instance used for section
15 (`supabase_db_BBT_PalaceElite`), not the connected/hosted project. The
full pgTAP suite in `supabase/tests/001_business_rules.sql` (36 assertions)
was run against this local instance and passed with zero failures,
including 20 new assertions added for this work. No migration in this
range was applied to, or executed against, the hosted Supabase project.
