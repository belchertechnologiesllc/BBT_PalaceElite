# Administrator bootstrap procedure

The initial schema migration (`supabase/migrations/20260728033000_initial_schema.sql`)
seeds the membership, its three ownership units, and the initial benefit
grants, but it deliberately does **not** create any `unit_users` row or
otherwise assign an administrator. Doing that in the migration would require
hard-coding a Supabase Auth UUID, email address, or password — which the
migration must never contain (it ships in source control and CI, not a
secrets store).

Instead, the migration ships a parameterized, reviewable SQL function,
`public.bootstrap_administrator(p_auth_user_id uuid)`, that you run **once**,
manually, after the real administrator has signed up. It:

1. Verifies the given `auth.users` row exists.
2. Ensures a `public.profiles` row exists for that user (in case the
   `on_auth_user_created` trigger has not already created one).
3. Looks up the single seeded membership and its `Belcher` ownership unit by
   name.
4. Upserts a `public.unit_users` row linking that Auth user to the `Belcher`
   unit with `role = 'admin'`.

Execution of the function is restricted to `service_role` (`REVOKE EXECUTE
... FROM PUBLIC; GRANT EXECUTE ... TO service_role;`), so it can only be run
from a context that already has full project access (the Supabase SQL
Editor, or a trusted server process holding the service-role key) — never
from the anon/authenticated client roles used by the web app.

## Steps

1. **Enable Email/Password sign-in** in the Supabase project (Authentication
   → Providers → Email), if not already enabled.
2. **Have the administrator sign up** through the app's normal
   Email/Password sign-up flow (or create the user from the Supabase
   Dashboard: Authentication → Users → Add user). This creates the
   `auth.users` row and, via the `on_auth_user_created` trigger, the matching
   `public.profiles` row.
3. **Find their Auth UUID.** In the Supabase Dashboard, go to Authentication
   → Users, locate the account by email, and copy its `UID` column. (You can
   also run `select id, email from auth.users where email = '<their email>';`
   from the SQL Editor, which runs as a privileged role.)
4. **Run the bootstrap function** from the Supabase SQL Editor (which
   executes as a privileged role, satisfying the `service_role`
   execute-grant requirement):

   ```sql
   select public.bootstrap_administrator('<paste-the-auth-uuid-here>');
   ```

   Do not paste a UUID into a commit, issue, or chat log — treat it like any
   other account identifier and enter it directly into the SQL Editor.
5. **Verify the result:**

   ```sql
   select uu.role, uu.granted_at, ou.name as ownership_unit, p.display_name
   from public.unit_users uu
   join public.ownership_units ou on ou.id = uu.ownership_unit_id
   join public.profiles p on p.id = uu.user_id
   where uu.role = 'admin';
   ```

   You should see exactly one row with `ownership_unit = 'Belcher'` and
   `role = 'admin'` for the intended account (running it again for the same
   user is safe — the function upserts and re-activates the role rather than
   erroring).

## Re-running / correcting

The function is idempotent for a given `p_auth_user_id`: calling it again
simply re-asserts `role = 'admin'` and clears `revoked_at` on the existing
`unit_users` row rather than creating a duplicate. To grant `admin` access to
a different or additional Auth user, call it again with their UUID.

To grant `viewer`/`contributor` access (non-admin) to another family member's
account instead, insert directly into `unit_users` from the SQL Editor,
choosing the appropriate `ownership_unit_id`, e.g.:

```sql
insert into public.unit_users (ownership_unit_id, user_id, role)
values (
  (select id from public.ownership_units where name = 'Tatro'),
  '<their-auth-uuid>',
  'contributor'
);
```

## Why this can't be part of the migration

* The migration file is committed to source control and reviewed as a PR
  diff; embedding a real person's email, password, or Auth UUID there would
  leak PII/secrets into git history (requirement: no hard-coded email, Auth
  UUID, password, or service-role key).
* Supabase Auth UUIDs are assigned by the Auth service at sign-up time and
  cannot be predicted or fabricated ahead of time — the account has to exist
  first.
* Keeping the bootstrap step manual and `service_role`-gated makes it an
  explicit, reviewable, one-time operational action rather than something
  that silently runs (or silently fails) on every migration replay.
