-- Palace Elite membership manager: initial schema
--
-- Accounting-integrity and audit-protection design notes (see requirement list in
-- the PR description for the numbered items referenced below):
--
--   * Core accounting entities (memberships, ownership_units, benefit_grants,
--     reservations, benefit_transactions) never CASCADE-delete one another.
--     Every inter-entity foreign key is ON DELETE RESTRICT, and a BEFORE DELETE
--     trigger additionally blocks hard deletes outright (see
--     public.block_hard_delete). Corrections are made with archival/void
--     columns (voided_at/voided_by/void_reason, archived_at) instead of
--     destructive DELETE statements, so the transaction, reservation, and
--     audit history is permanently reconstructable.
--   * Composite foreign keys tie membership_id, ownership_unit_id,
--     benefit_grant_id, and reservation_id together so a benefit transaction
--     can never reference a unit, grant, or reservation that belongs to a
--     different membership, and a reservation referenced by a transaction
--     must belong to the same ownership unit as the transaction.
--   * public.audit_log is append-only: direct INSERT/UPDATE/DELETE grants are
--     revoked from every client-facing role, rows are written exclusively by
--     SECURITY DEFINER trigger functions, and a dedicated trigger rejects any
--     UPDATE or DELETE attempted against the table itself. Inserts, updates,
--     approvals, and voids on core tables are logged automatically via
--     public.log_audit_event. Attempted hard deletes are always blocked (see
--     above) and surfaced via a detailed RAISE EXCEPTION rather than an
--     audit_log row, because a row written inside the same trigger that then
--     raises would be rolled back with it -- see the comment on
--     public.block_hard_delete for the full explanation.
--   * All SECURITY DEFINER functions pin `search_path` to `pg_catalog, public`
--     (preventing search-path hijacking), REVOKE EXECUTE FROM PUBLIC, and
--     GRANT EXECUTE only to the specific role(s) that legitimately need to
--     call them.

-- =============================================================================
-- 1. Extensions and enumerated types
-- =============================================================================

create extension if not exists pgcrypto;

create type public.app_role as enum ('viewer', 'contributor', 'admin');
create type public.benefit_pool as enum ('shared', 'golf');
create type public.quantity_kind as enum ('currency', 'count', 'nights', 'weeks', 'rounds');
create type public.transaction_status as enum ('draft', 'submitted', 'approved', 'voided');

-- =============================================================================
-- 2. Core membership and identity tables
-- =============================================================================

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contract_number text not null unique,
  purchase_price numeric(12,2) not null check (purchase_price >= 0),
  start_date date not null,
  expiration_date date not null,
  archived_at timestamptz,
  archived_reason text,
  created_at timestamptz not null default now(),
  check (archived_at is null or archived_reason is not null)
);
comment on column public.memberships.archived_at is
  'Archival flag used instead of deletion when a membership is sold/transferred out of this ledger.';

create table public.ownership_units (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete restrict,
  name text not null,
  members_description text,
  ownership_percentage numeric(7,4) not null check (ownership_percentage > 0 and ownership_percentage <= 100),
  -- Golf pool participation: Belcher and Belcher Sr. only. Tatro participates
  -- in the shared pool but is excluded from the golf pool (requirement 5).
  participates_in_golf_pool boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (membership_id, name),
  -- Referenced by composite foreign keys from reservations/benefit_transactions
  -- to guarantee membership_id/ownership_unit_id consistency (requirement 6).
  unique (membership_id, id)
);

-- profiles mirrors auth.users 1:1. It intentionally still cascades from
-- auth.users (deleting a Supabase auth account should remove the linked
-- profile), but any profile referenced by accounting history is transitively
-- protected: benefit_transactions/reservations/audit_log reference profiles
-- with ON DELETE RESTRICT below, so a profile involved in real activity can
-- never actually be removed even when the parent auth.users row is deleted.
-- Access should be revoked via unit_users.revoked_at / profiles.is_active
-- instead of deletion (requirement 4).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

-- unit_users is the access-control roster for an ownership unit. Rows are
-- never deleted (revoked_at marks historical access instead) so we retain a
-- full audit trail of who could act on behalf of a unit and when.
create table public.unit_users (
  ownership_unit_id uuid not null references public.ownership_units(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.app_role not null default 'viewer',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (ownership_unit_id, user_id)
);

-- =============================================================================
-- 3. Benefit domain tables
-- =============================================================================

create table public.benefit_grants (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete restrict,
  name text not null,
  pool public.benefit_pool not null,
  quantity_kind public.quantity_kind not null,
  original_quantity numeric(12,2) not null check (original_quantity >= 0),
  release_date date,
  expiration_date date,
  restrictions text,
  archived_at timestamptz,
  archived_reason text,
  created_at timestamptz not null default now(),
  check (archived_at is null or archived_reason is not null),
  unique (membership_id, id)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete restrict,
  ownership_unit_id uuid not null references public.ownership_units(id) on delete restrict,
  resort text not null,
  check_in date not null,
  check_out date not null,
  room_type text,
  confirmation_number text,
  public_comparable_price numeric(12,2) check (public_comparable_price >= 0),
  amount_paid numeric(12,2) check (amount_paid >= 0),
  pricing_evidence text,
  created_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete restrict,
  void_reason text,
  created_at timestamptz not null default now(),
  check (check_out > check_in),
  check (voided_at is null or (voided_by is not null and void_reason is not null)),
  -- Composite FK targets for benefit_transactions: guarantees a transaction's
  -- (membership_id, ownership_unit_id, reservation_id) triple can only point
  -- at a reservation that truly belongs to that membership and unit
  -- (requirement 6).
  unique (membership_id, ownership_unit_id, id),
  foreign key (membership_id, ownership_unit_id)
    references public.ownership_units (membership_id, id) on delete restrict
);

create table public.benefit_transactions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete restrict,
  ownership_unit_id uuid not null references public.ownership_units(id) on delete restrict,
  benefit_grant_id uuid not null references public.benefit_grants(id) on delete restrict,
  reservation_id uuid,
  quantity_used numeric(12,2) not null check (quantity_used > 0),
  face_value numeric(12,2) not null default 0 check (face_value >= 0),
  economic_value numeric(12,2) not null default 0 check (economic_value >= 0),
  status public.transaction_status not null default 'draft',
  notes text,
  created_by uuid references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  voided_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'voided' or (voided_by is not null and voided_at is not null and void_reason is not null)),
  -- Membership/unit/grant consistency (requirement 6).
  foreign key (membership_id, ownership_unit_id)
    references public.ownership_units (membership_id, id) on delete restrict,
  foreign key (membership_id, benefit_grant_id)
    references public.benefit_grants (membership_id, id) on delete restrict,
  -- MATCH SIMPLE (the default): when reservation_id is null the constraint is
  -- not checked, so an unlinked transaction is still allowed; when present,
  -- membership_id and ownership_unit_id must match the reservation exactly.
  foreign key (membership_id, ownership_unit_id, reservation_id)
    references public.reservations (membership_id, ownership_unit_id, id) on delete restrict
);

create index benefit_transactions_reservation_id_idx on public.benefit_transactions (reservation_id);
create index benefit_transactions_benefit_grant_id_idx on public.benefit_transactions (benefit_grant_id);
create index reservations_ownership_unit_id_idx on public.reservations (ownership_unit_id);

-- =============================================================================
-- 4. Audit log (append-only)
-- =============================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  -- Nullable: not every audited entity (e.g. profiles, unit_users) is scoped
  -- to a single membership.
  membership_id uuid references public.memberships(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_membership_id_idx on public.audit_log (membership_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- =============================================================================
-- 5. Functions
-- =============================================================================

-- Membership access check used throughout RLS policies. SECURITY DEFINER so
-- it can read unit_users/ownership_units even though those tables have no
-- broad SELECT policy of their own; search_path is pinned and execution is
-- restricted to the `authenticated` role only.
create or replace function public.user_has_membership_access(target_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.unit_users uu
    join public.ownership_units ou on ou.id = uu.ownership_unit_id
    where uu.user_id = auth.uid()
      and uu.revoked_at is null
      and ou.membership_id = target_membership
  );
$$;

revoke execute on function public.user_has_membership_access(uuid) from public;
grant execute on function public.user_has_membership_access(uuid) to authenticated;

-- Membership admin check, used to gate approvals, voids, and roster changes.
create or replace function public.user_is_membership_admin(target_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.unit_users uu
    join public.ownership_units ou on ou.id = uu.ownership_unit_id
    where uu.user_id = auth.uid()
      and uu.revoked_at is null
      and uu.role = 'admin'
      and ou.membership_id = target_membership
  );
$$;

revoke execute on function public.user_is_membership_admin(uuid) from public;
grant execute on function public.user_is_membership_admin(uuid) to authenticated;

-- Golf-pool eligibility guard (requirement 5/6 "equivalent constraint"): a
-- benefit_transaction against a 'golf' pool grant is only permitted for an
-- ownership unit flagged participates_in_golf_pool = true (Belcher and
-- Belcher Sr.). Runs as SECURITY INVOKER because it only needs the same read
-- access the inserting/updating role already has under RLS.
create or replace function public.enforce_pool_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_pool public.benefit_pool;
  v_golf_eligible boolean;
begin
  select pool into v_pool
  from public.benefit_grants
  where id = new.benefit_grant_id;

  select participates_in_golf_pool into v_golf_eligible
  from public.ownership_units
  where id = new.ownership_unit_id;

  if v_pool = 'golf' and coalesce(v_golf_eligible, false) = false then
    raise exception 'Ownership unit % does not participate in the golf benefit pool', new.ownership_unit_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_pool_eligibility() from public;

-- Generic append-only audit logger, attached AFTER INSERT OR UPDATE to core
-- tables. Classifies status transitions on benefit_transactions/reservations
-- into APPROVE / VOID actions so the audit trail reads meaningfully instead
-- of a flat "UPDATE". SECURITY DEFINER so it can write to audit_log even
-- though client roles hold no DML grants on that table directly.
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_entity_id uuid;
  v_action text;
begin
  if TG_OP = 'INSERT' then
    v_membership_id := nullif(to_jsonb(new)->>'membership_id', '')::uuid;
    v_entity_id := nullif(to_jsonb(new)->>'id', '')::uuid;
    v_action := 'INSERT';
  else
    v_membership_id := nullif(to_jsonb(new)->>'membership_id', '')::uuid;
    v_entity_id := nullif(to_jsonb(new)->>'id', '')::uuid;
    v_action := 'UPDATE';

    if TG_TABLE_NAME = 'benefit_transactions' then
      if (to_jsonb(old)->>'status') is distinct from (to_jsonb(new)->>'status')
         and to_jsonb(new)->>'status' = 'approved' then
        v_action := 'APPROVE';
      elsif (to_jsonb(old)->>'voided_at') is null and (to_jsonb(new)->>'voided_at') is not null then
        v_action := 'VOID';
      end if;
    elsif TG_TABLE_NAME = 'reservations' then
      if (to_jsonb(old)->>'voided_at') is null and (to_jsonb(new)->>'voided_at') is not null then
        v_action := 'VOID';
      end if;
    end if;
  end if;

  insert into public.audit_log (membership_id, actor_id, action, entity_type, entity_id, previous_data, new_data)
  values (
    v_membership_id,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    case when TG_OP = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

revoke execute on function public.log_audit_event() from public;

-- Blocks hard deletes on core tables entirely, raising an exception so the
-- DELETE never succeeds. Correction must go through the archival/void
-- columns instead.
--
-- NOTE on "attempted delete" logging (requirement 7): a row inserted into
-- audit_log from *within this same trigger* would be rolled back along with
-- the DELETE the moment we RAISE EXCEPTION -- plain PL/pgSQL has no
-- autonomous transaction that can survive its own caller's abort without an
-- extra extension (e.g. dblink) opening a second connection, which we've
-- deliberately avoided here to keep this SECURITY DEFINER surface small and
-- free of embedded connection credentials (requirement 13). Instead, the
-- blocked attempt is surfaced two ways that do survive the rollback: (a) the
-- detailed error below, which Postgres/Supabase capture in the server/API
-- logs together with the statement, role, and table; and (b) the complete
-- absence of DELETE grants to anon/authenticated (see section 9), so this
-- trigger only ever fires for a privileged role (postgres/service_role)
-- issuing SQL directly, which is itself an operator action already covered
-- by Supabase's own session/query logging.
create or replace function public.block_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Hard deletes are not permitted on table "%" (row id: %); use the archival/void columns instead. Blocked for role % at %.',
    TG_TABLE_NAME,
    nullif(to_jsonb(old)->>'id', ''),
    current_user,
    clock_timestamp()
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.block_hard_delete() from public;

-- audit_log itself must be immutable: reject any UPDATE or DELETE outright,
-- regardless of caller (requirement 8).
create or replace function public.prevent_audit_log_tampering()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'public.audit_log is append-only; % is not permitted.', TG_OP
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.prevent_audit_log_tampering() from public;

-- Safe profile-provisioning trigger for new Supabase auth users (requirement
-- 12). SECURITY DEFINER so it can bypass profiles' RLS (there is no INSERT
-- policy for authenticated users) during the signup transaction. Uses
-- ON CONFLICT DO NOTHING so it can never fail signup for an already-
-- provisioned id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

-- Administrator bootstrap procedure (requirement 14). Deliberately takes the
-- Auth user id as a parameter rather than hard-coding an email, UUID, or
-- secret anywhere in this migration (requirement 13). It maps the given
-- existing Supabase Auth user onto the Belcher ownership unit with the
-- 'admin' role. Execution is restricted to service_role, so it can only be
-- invoked from the Supabase SQL editor (or another service-role context) by
-- someone who already has full project access -- see
-- supabase/ADMIN_BOOTSTRAP.md for the reviewable, step-by-step procedure.
create or replace function public.bootstrap_administrator(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_unit_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'p_auth_user_id is required';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'No auth.users row found for %', p_auth_user_id;
  end if;

  insert into public.profiles (id, display_name)
  select u.id, coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1))
  from auth.users u
  where u.id = p_auth_user_id
  on conflict (id) do nothing;

  select id into v_membership_id
  from public.memberships
  order by created_at asc
  limit 1;

  if v_membership_id is null then
    raise exception 'No membership record exists to bootstrap an administrator against';
  end if;

  select id into v_unit_id
  from public.ownership_units
  where membership_id = v_membership_id
    and name = 'Belcher';

  if v_unit_id is null then
    raise exception 'Belcher ownership unit not found for membership %', v_membership_id;
  end if;

  insert into public.unit_users (ownership_unit_id, user_id, role)
  values (v_unit_id, p_auth_user_id, 'admin')
  on conflict (ownership_unit_id, user_id)
  do update set role = excluded.role, revoked_at = null;
end;
$$;

revoke execute on function public.bootstrap_administrator(uuid) from public;
grant execute on function public.bootstrap_administrator(uuid) to service_role;

-- =============================================================================
-- 6. Triggers
-- =============================================================================

create trigger enforce_pool_eligibility_trg
  before insert or update on public.benefit_transactions
  for each row execute function public.enforce_pool_eligibility();

create trigger memberships_audit_trg
  after insert or update on public.memberships
  for each row execute function public.log_audit_event();
create trigger memberships_block_delete_trg
  before delete on public.memberships
  for each row execute function public.block_hard_delete();

create trigger ownership_units_audit_trg
  after insert or update on public.ownership_units
  for each row execute function public.log_audit_event();
create trigger ownership_units_block_delete_trg
  before delete on public.ownership_units
  for each row execute function public.block_hard_delete();

create trigger profiles_audit_trg
  after insert or update on public.profiles
  for each row execute function public.log_audit_event();
create trigger profiles_block_delete_trg
  before delete on public.profiles
  for each row execute function public.block_hard_delete();

create trigger unit_users_audit_trg
  after insert or update on public.unit_users
  for each row execute function public.log_audit_event();
create trigger unit_users_block_delete_trg
  before delete on public.unit_users
  for each row execute function public.block_hard_delete();

create trigger benefit_grants_audit_trg
  after insert or update on public.benefit_grants
  for each row execute function public.log_audit_event();
create trigger benefit_grants_block_delete_trg
  before delete on public.benefit_grants
  for each row execute function public.block_hard_delete();

create trigger reservations_audit_trg
  after insert or update on public.reservations
  for each row execute function public.log_audit_event();
create trigger reservations_block_delete_trg
  before delete on public.reservations
  for each row execute function public.block_hard_delete();

create trigger benefit_transactions_audit_trg
  after insert or update on public.benefit_transactions
  for each row execute function public.log_audit_event();
create trigger benefit_transactions_block_delete_trg
  before delete on public.benefit_transactions
  for each row execute function public.block_hard_delete();

create trigger audit_log_prevent_update_trg
  before update on public.audit_log
  for each row execute function public.prevent_audit_log_tampering();
create trigger audit_log_prevent_delete_trg
  before delete on public.audit_log
  for each row execute function public.prevent_audit_log_tampering();

-- Provision a profile row automatically whenever a new Supabase Auth user is
-- created (Email/Password or any other enabled provider).
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 7. Row level security
-- =============================================================================

alter table public.memberships enable row level security;
alter table public.ownership_units enable row level security;
alter table public.profiles enable row level security;
alter table public.unit_users enable row level security;
alter table public.benefit_grants enable row level security;
alter table public.reservations enable row level security;
alter table public.benefit_transactions enable row level security;
alter table public.audit_log enable row level security;

create policy "membership users can read memberships"
on public.memberships for select
to authenticated
using (public.user_has_membership_access(id));

create policy "membership users can read units"
on public.ownership_units for select
to authenticated
using (public.user_has_membership_access(membership_id));

create policy "users can read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "users can read own unit membership rows"
on public.unit_users for select
to authenticated
using (user_id = auth.uid());

create policy "admins can manage unit membership"
on public.unit_users for all
to authenticated
using (
  exists (
    select 1 from public.ownership_units ou
    where ou.id = unit_users.ownership_unit_id
      and public.user_is_membership_admin(ou.membership_id)
  )
)
with check (
  exists (
    select 1 from public.ownership_units ou
    where ou.id = unit_users.ownership_unit_id
      and public.user_is_membership_admin(ou.membership_id)
  )
);

create policy "membership users can read benefits"
on public.benefit_grants for select
to authenticated
using (public.user_has_membership_access(membership_id));

create policy "admins can manage benefit grants"
on public.benefit_grants for insert
to authenticated
with check (public.user_is_membership_admin(membership_id));

create policy "admins can update benefit grants"
on public.benefit_grants for update
to authenticated
using (public.user_is_membership_admin(membership_id))
with check (public.user_is_membership_admin(membership_id));

create policy "membership users can read reservations"
on public.reservations for select
to authenticated
using (public.user_has_membership_access(membership_id));

create policy "contributors can create reservations"
on public.reservations for insert
to authenticated
with check (
  public.user_has_membership_access(membership_id)
  and exists (
    select 1 from public.unit_users
    where user_id = auth.uid()
      and revoked_at is null
      and ownership_unit_id = reservations.ownership_unit_id
      and role in ('contributor', 'admin')
  )
);

create policy "admins can void reservations"
on public.reservations for update
to authenticated
using (public.user_is_membership_admin(membership_id))
with check (public.user_is_membership_admin(membership_id));

create policy "membership users can read transactions"
on public.benefit_transactions for select
to authenticated
using (public.user_has_membership_access(membership_id));

create policy "contributors can create benefit transactions"
on public.benefit_transactions for insert
to authenticated
with check (
  public.user_has_membership_access(membership_id)
  and exists (
    select 1 from public.unit_users
    where user_id = auth.uid()
      and revoked_at is null
      and ownership_unit_id = benefit_transactions.ownership_unit_id
      and role in ('contributor', 'admin')
  )
);

create policy "admins can approve or void transactions"
on public.benefit_transactions for update
to authenticated
using (public.user_is_membership_admin(membership_id))
with check (public.user_is_membership_admin(membership_id));

-- Audit history is admin-only reading material: it can contain previous_data
-- for every accounting row, so exposure is limited to membership admins.
create policy "admins can read membership audit log"
on public.audit_log for select
to authenticated
using (membership_id is not null and public.user_is_membership_admin(membership_id));

-- =============================================================================
-- 8. Views
-- =============================================================================

-- security_invoker = true makes this view evaluate RLS as the querying user
-- (not the view owner), so a membership user only ever sees balances for
-- memberships they actually have access to (requirement 10).
create view public.benefit_balances
with (security_invoker = true) as
select
  g.id,
  g.membership_id,
  g.name,
  g.pool,
  g.quantity_kind,
  g.original_quantity,
  g.original_quantity - coalesce(
    sum(t.quantity_used) filter (where t.status = 'approved' and t.voided_at is null),
    0
  ) as remaining_quantity,
  g.release_date,
  g.expiration_date,
  g.restrictions,
  g.archived_at
from public.benefit_grants g
left join public.benefit_transactions t on t.benefit_grant_id = g.id
group by g.id;

revoke all on public.benefit_balances from public;
grant select on public.benefit_balances to authenticated;

-- =============================================================================
-- 9. Table grants
-- =============================================================================
--
-- Client roles get only what RLS-governed access requires. audit_log
-- receives no INSERT/UPDATE/DELETE grant to anon/authenticated at all --
-- rows are written exclusively by the SECURITY DEFINER trigger functions
-- above, which execute with the function owner's privileges regardless of
-- the caller's table grants (requirement 8).

grant select, insert on public.reservations to authenticated;
grant select, insert on public.benefit_transactions to authenticated;
grant select, insert, update on public.benefit_grants to authenticated;
grant select on public.memberships to authenticated;
grant select on public.ownership_units to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.unit_users to authenticated;
grant select on public.audit_log to authenticated;

revoke insert, update, delete on public.audit_log from authenticated, anon, public;

-- =============================================================================
-- 10. Seed data
-- =============================================================================
--
-- Seeds the membership, its three ownership units, and the initial benefit
-- grants only. No auth user, profile, or unit_users row is created here --
-- doing so would require guessing or hard-coding an Auth UUID/email
-- (requirement 15, 13). Run supabase/ADMIN_BOOTSTRAP.md after the real
-- administrator has signed up with Email/Password to link their Auth
-- account to the Belcher ownership unit.

with membership as (
  insert into public.memberships (name, contract_number, purchase_price, start_date, expiration_date)
  values ('Palace Elite VIP Silver', '4135905', 35700.00, '2026-03-29', '2051-03-29')
  returning id
), units as (
  insert into public.ownership_units (membership_id, name, members_description, ownership_percentage, participates_in_golf_pool)
  select id, 'Belcher', 'Anthony, Kristin, and children', 33.3333, true from membership
  union all select id, 'Belcher Sr.', 'Mike and Theresa', 33.3333, true from membership
  union all select id, 'Tatro', 'Larry, spouse, and adult son', 33.3334, false from membership
)
insert into public.benefit_grants (membership_id, name, pool, quantity_kind, original_quantity, expiration_date, restrictions)
select id, 'BPG Weeks', 'shared'::public.benefit_pool, 'weeks'::public.quantity_kind, 100::numeric(12,2), '2051-03-29'::date, 'Preferential rate; room category and discount vary.' from membership
union all select id, 'Incentive Stays', 'shared'::public.benefit_pool, 'count'::public.quantity_kind, 6::numeric(12,2), '2033-03-29'::date, 'Release dates and Gold Season restrictions apply.' from membership
union all select id, 'Imperial Grand Weeks', 'shared'::public.benefit_pool, 'weeks'::public.quantity_kind, 2::numeric(12,2), '2031-03-29'::date, 'Seven nights for two people; additional-person fees may apply.' from membership
union all select id, 'Spa Resort Credit', 'shared'::public.benefit_pool, 'currency'::public.quantity_kind, 3740::numeric(12,2), '2031-03-29'::date, 'Service fee applies.' from membership
union all select id, 'Universal Credit', 'shared'::public.benefit_pool, 'currency'::public.quantity_kind, 280::numeric(12,2), '2029-03-29'::date, null::text from membership
union all select id, 'Golf Rounds at 50%', 'golf'::public.benefit_pool, 'rounds'::public.quantity_kind, 20::numeric(12,2), null::date, 'Belcher and Belcher Sr. pool only.' from membership
union all select id, 'Unlimited Golf Bonus Nights', 'golf'::public.benefit_pool, 'nights'::public.quantity_kind, 8::numeric(12,2), '2031-03-29'::date, 'Belcher and Belcher Sr. pool only.' from membership;
