-- Palace Elite Membership Manager
-- Phase 2A: people associated with ownership units
--
-- People are distinct from Supabase Auth profiles:
--   * A person may exist without a login.
--   * A profile may optionally be linked to one person.
--   * Authorization remains controlled through public.unit_users.
--   * Historical people are archived rather than deleted.

-- =============================================================================
-- 1. People table
-- =============================================================================

create table public.people (
  id uuid primary key default gen_random_uuid(),

  -- membership_id is intentionally stored alongside ownership_unit_id so:
  --   * membership consistency can be enforced with a composite foreign key,
  --   * RLS remains straightforward,
  --   * audit_log receives the membership id automatically.
  membership_id uuid not null
    references public.memberships(id) on delete restrict,

  ownership_unit_id uuid not null
    references public.ownership_units(id) on delete restrict,

  -- Optional 1:1 link to an application login.
  -- Most family members will not need a Supabase Auth account.
  profile_id uuid unique
    references public.profiles(id) on delete restrict,

  first_name text not null check (nullif(btrim(first_name), '') is not null),
  last_name text not null check (nullif(btrim(last_name), '') is not null),
  preferred_name text,

  -- Flexible descriptive relationship for display purposes.
  relationship_to_primary text,

  -- Business role within the ownership unit.
  person_role text not null default 'family_member'
    check (
      person_role in (
        'primary_owner',
        'co_owner',
        'spouse',
        'child',
        'adult_child',
        'family_member',
        'guest',
        'other'
      )
    ),

  date_of_birth date,

  participates_in_shared_pool boolean not null default true,
  participates_in_golf_pool boolean not null default false,

  is_active boolean not null default true,

  archived_at timestamptz,
  archived_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    archived_at is null
    or nullif(btrim(archived_reason), '') is not null
  ),

  check (
    archived_at is null
    or is_active = false
  ),

  -- Guarantees that the person belongs to an ownership unit from the same
  -- membership.
  foreign key (membership_id, ownership_unit_id)
    references public.ownership_units (membership_id, id)
    on delete restrict,

  unique (membership_id, id)
);

create index people_membership_id_idx
  on public.people (membership_id);

create index people_ownership_unit_id_idx
  on public.people (ownership_unit_id);

create index people_active_unit_idx
  on public.people (ownership_unit_id, is_active)
  where archived_at is null;

comment on table public.people is
  'People associated with Palace Elite ownership units. A person may exist without an application login.';

comment on column public.people.profile_id is
  'Optional one-to-one link to public.profiles/auth.users. Authorization remains controlled through public.unit_users.';

comment on column public.people.person_role is
  'Business role within the ownership unit; distinct from the application authorization role in unit_users.';

-- =============================================================================
-- 2. Validation and maintenance functions
-- =============================================================================

create or replace function public.set_people_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_people_updated_at() from public;

create or replace function public.enforce_people_pool_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_unit_golf_eligible boolean;
begin
  select ou.participates_in_golf_pool
    into v_unit_golf_eligible
  from public.ownership_units ou
  where ou.id = new.ownership_unit_id
    and ou.membership_id = new.membership_id;

  if not found then
    raise exception
      'Ownership unit % does not belong to membership %.',
      new.ownership_unit_id,
      new.membership_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.participates_in_golf_pool
     and coalesce(v_unit_golf_eligible, false) = false then
    raise exception
      'Person cannot participate in the golf pool because ownership unit % is not golf eligible.',
      new.ownership_unit_id
      using errcode = 'check_violation';
  end if;

  if new.archived_at is not null then
    new.is_active := false;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_people_pool_eligibility() from public;

-- =============================================================================
-- 3. Triggers
-- =============================================================================

create trigger people_set_updated_at_trg
  before update on public.people
  for each row
  execute function public.set_people_updated_at();

create trigger people_pool_eligibility_trg
  before insert or update on public.people
  for each row
  execute function public.enforce_people_pool_eligibility();

create trigger people_audit_trg
  after insert or update on public.people
  for each row
  execute function public.log_audit_event();

create trigger people_block_delete_trg
  before delete on public.people
  for each row
  execute function public.block_hard_delete();

-- =============================================================================
-- 4. Row-level security
-- =============================================================================

alter table public.people enable row level security;

create policy "membership users can read people"
on public.people
for select
to authenticated
using (
  public.user_has_membership_access(membership_id)
);

create policy "membership admins can insert people"
on public.people
for insert
to authenticated
with check (
  public.user_is_membership_admin(membership_id)
);

create policy "membership admins can update people"
on public.people
for update
to authenticated
using (
  public.user_is_membership_admin(membership_id)
)
with check (
  public.user_is_membership_admin(membership_id)
);

grant select, insert, update
on public.people
to authenticated;

-- No DELETE grant is provided. The hard-delete trigger also protects against
-- privileged direct SQL deletion.

-- =============================================================================
-- 5. Administrator/profile linkage helper
-- =============================================================================

create or replace function public.link_profile_to_person(
  p_person_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_ownership_unit_id uuid;
begin
  if p_person_id is null or p_profile_id is null then
    raise exception 'p_person_id and p_profile_id are required';
  end if;

  select membership_id, ownership_unit_id
    into v_membership_id, v_ownership_unit_id
  from public.people
  where id = p_person_id
    and archived_at is null;

  if not found then
    raise exception 'Active person % was not found', p_person_id;
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and is_active = true
  ) then
    raise exception 'Active profile % was not found', p_profile_id;
  end if;

  -- service_role may perform administrative setup. An authenticated caller
  -- must already be a membership administrator.
  if auth.role() <> 'service_role'
     and not public.user_is_membership_admin(v_membership_id) then
    raise exception 'Membership administrator access is required'
      using errcode = 'insufficient_privilege';
  end if;

  update public.people
  set profile_id = p_profile_id
  where id = p_person_id;

  -- Linking identity does not itself grant authorization. Ensure an existing
  -- unit_users row is not assumed or silently created here.
end;
$$;

revoke execute
on function public.link_profile_to_person(uuid, uuid)
from public;

grant execute
on function public.link_profile_to_person(uuid, uuid)
to authenticated, service_role;

-- =============================================================================
-- 6. Seed known people
-- =============================================================================
--
-- Only known names are seeded. Additional Tatro family members can be entered
-- through the Members module once their names and roles are confirmed.

insert into public.people (
  membership_id,
  ownership_unit_id,
  first_name,
  last_name,
  preferred_name,
  relationship_to_primary,
  person_role,
  participates_in_shared_pool,
  participates_in_golf_pool
)
select
  ou.membership_id,
  ou.id,
  seed.first_name,
  seed.last_name,
  seed.preferred_name,
  seed.relationship_to_primary,
  seed.person_role,
  true,
  seed.participates_in_golf_pool
from public.ownership_units ou
join (
  values
    ('Belcher',     'Anthony', 'Belcher', null::text, 'Self',          'primary_owner', true),
    ('Belcher',     'Kristin', 'Belcher', null::text, 'Spouse',        'spouse',        false),
    ('Belcher',     'Nora',    'Belcher', null::text, 'Child',         'child',         false),
    ('Belcher',     'Preston', 'Belcher', null::text, 'Child',         'child',         false),
    ('Belcher',     'Grayson', 'Belcher', null::text, 'Child',         'child',         false),
    ('Belcher Sr.', 'Mike',    'Belcher', null::text, 'Self',          'primary_owner', true),
    ('Belcher Sr.', 'Theresa', 'Belcher', null::text, 'Spouse',        'spouse',        false),
    ('Tatro',       'Larry',   'Tatro',   null::text, 'Self',          'primary_owner', false)
) as seed(
  unit_name,
  first_name,
  last_name,
  preferred_name,
  relationship_to_primary,
  person_role,
  participates_in_golf_pool
)
  on seed.unit_name = ou.name
where not exists (
  select 1
  from public.people p
  where p.ownership_unit_id = ou.id
    and lower(p.first_name) = lower(seed.first_name)
    and lower(p.last_name) = lower(seed.last_name)
);

-- =============================================================================
-- 7. Extend administrator bootstrap
-- =============================================================================
--
-- Re-running bootstrap_administrator will now also link the administrator's
-- Auth profile to Anthony Belcher when that person is still unlinked.

create or replace function public.bootstrap_administrator(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_unit_id uuid;
  v_person_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'p_auth_user_id is required';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = p_auth_user_id
  ) then
    raise exception 'No auth.users row found for %', p_auth_user_id;
  end if;

  insert into public.profiles (id, display_name)
  select
    u.id,
    coalesce(
      u.raw_user_meta_data ->> 'display_name',
      split_part(u.email, '@', 1)
    )
  from auth.users u
  where u.id = p_auth_user_id
  on conflict (id) do nothing;

  select id
    into v_membership_id
  from public.memberships
  order by created_at asc
  limit 1;

  if v_membership_id is null then
    raise exception
      'No membership record exists to bootstrap an administrator against';
  end if;

  select id
    into v_unit_id
  from public.ownership_units
  where membership_id = v_membership_id
    and name = 'Belcher';

  if v_unit_id is null then
    raise exception
      'Belcher ownership unit not found for membership %',
      v_membership_id;
  end if;

  insert into public.unit_users (
    ownership_unit_id,
    user_id,
    role
  )
  values (
    v_unit_id,
    p_auth_user_id,
    'admin'
  )
  on conflict (ownership_unit_id, user_id)
  do update
  set
    role = excluded.role,
    revoked_at = null;

  select id
    into v_person_id
  from public.people
  where ownership_unit_id = v_unit_id
    and lower(first_name) = 'anthony'
    and lower(last_name) = 'belcher'
    and archived_at is null
  order by created_at asc
  limit 1;

  if v_person_id is not null then
    update public.people
    set profile_id = p_auth_user_id
    where id = v_person_id
      and (
        profile_id is null
        or profile_id = p_auth_user_id
      );

    if not found then
      raise exception
        'Anthony Belcher is already linked to a different profile';
    end if;
  end if;
end;
$$;

revoke execute
on function public.bootstrap_administrator(uuid)
from public;

grant execute
on function public.bootstrap_administrator(uuid)
to service_role;
