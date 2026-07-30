# Migration verification

Read-only checks to run from the Supabase SQL Editor (or `psql`) after
applying `supabase/migrations/20260728033000_initial_schema.sql`, to confirm
the schema landed as intended. None of these statements modify data — they
are all `select` queries against catalog views or the seeded rows.

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
