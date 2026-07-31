-- Revoke TRUNCATE/REFERENCES/TRIGGER from anon and authenticated on every
-- table in the public schema, and fix the standing default so future
-- tables don't silently re-acquire them.
--
-- Discovered while locally testing the ownership-reorder feature
-- (2026-07-31), not by inspecting any migration in this repository: every
-- table here was created by role `postgres` (confirmed via
-- pg_class.relacl), and this Supabase project has an
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` entry
-- (set up by the platform, not by any file in supabase/migrations/) that
-- grants TRUNCATE, REFERENCES, and TRIGGER to anon, authenticated, and
-- service_role on every newly created table, in addition to postgres
-- itself getting full insert/select/update/delete/truncate/references/
-- trigger. Confirmed live:
--
--   select has_table_privilege('anon', 'public.audit_log', 'TRUNCATE');
--   -- returned true, with zero authentication required.
--
-- TRUNCATE is not filtered by row level security at all in PostgreSQL --
-- only the TRUNCATE grant is checked -- so this silently bypassed every
-- RLS policy in this schema, the append-only design of audit_log (whose
-- own migration only revokes INSERT/UPDATE/DELETE, never TRUNCATE), and
-- block_hard_delete() (which only fires BEFORE DELETE, never BEFORE
-- TRUNCATE). An anonymous caller could run `TRUNCATE public.audit_log`,
-- `TRUNCATE public.people`, or any other table in this schema in one
-- statement.
--
-- This does not touch INSERT/SELECT/UPDATE/DELETE: those were already
-- correctly scoped per table by each table's own explicit grant
-- statements, confirmed unaffected by this migration.

revoke truncate, references, trigger
on all tables in schema public
from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger
  on tables
  from anon, authenticated;
