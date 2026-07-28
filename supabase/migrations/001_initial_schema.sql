create extension if not exists pgcrypto;

create type public.app_role as enum ('viewer', 'contributor', 'admin');
create type public.benefit_pool as enum ('shared', 'golf');
create type public.quantity_kind as enum ('currency', 'count', 'nights', 'weeks', 'rounds');
create type public.transaction_status as enum ('draft', 'submitted', 'approved', 'reversed');

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contract_number text not null unique,
  purchase_price numeric(12,2) not null check (purchase_price >= 0),
  start_date date not null,
  expiration_date date not null,
  created_at timestamptz not null default now()
);

create table public.ownership_units (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  name text not null,
  members_description text,
  ownership_percentage numeric(7,4) not null check (ownership_percentage > 0 and ownership_percentage <= 100),
  participates_in_golf_pool boolean not null default false,
  created_at timestamptz not null default now(),
  unique (membership_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.unit_users (
  ownership_unit_id uuid not null references public.ownership_units(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'viewer',
  primary key (ownership_unit_id, user_id)
);

create table public.benefit_grants (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  name text not null,
  pool public.benefit_pool not null,
  quantity_kind public.quantity_kind not null,
  original_quantity numeric(12,2) not null check (original_quantity >= 0),
  release_date date,
  expiration_date date,
  restrictions text,
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  ownership_unit_id uuid not null references public.ownership_units(id),
  resort text not null,
  check_in date not null,
  check_out date not null,
  room_type text,
  confirmation_number text,
  public_comparable_price numeric(12,2) check (public_comparable_price >= 0),
  amount_paid numeric(12,2) check (amount_paid >= 0),
  pricing_evidence text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (check_out > check_in)
);

create table public.benefit_transactions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  ownership_unit_id uuid not null references public.ownership_units(id),
  benefit_grant_id uuid not null references public.benefit_grants(id),
  reservation_id uuid references public.reservations(id) on delete set null,
  quantity_used numeric(12,2) not null check (quantity_used > 0),
  face_value numeric(12,2) not null default 0 check (face_value >= 0),
  economic_value numeric(12,2) not null default 0 check (economic_value >= 0),
  status public.transaction_status not null default 'draft',
  notes text,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create view public.benefit_balances as
select
  g.id,
  g.membership_id,
  g.name,
  g.pool,
  g.quantity_kind,
  g.original_quantity,
  g.original_quantity - coalesce(sum(t.quantity_used) filter (where t.status = 'approved'), 0) as remaining_quantity,
  g.release_date,
  g.expiration_date,
  g.restrictions
from public.benefit_grants g
left join public.benefit_transactions t on t.benefit_grant_id = g.id
group by g.id;

alter table public.memberships enable row level security;
alter table public.ownership_units enable row level security;
alter table public.profiles enable row level security;
alter table public.unit_users enable row level security;
alter table public.benefit_grants enable row level security;
alter table public.reservations enable row level security;
alter table public.benefit_transactions enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.user_has_membership_access(target_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.unit_users uu
    join public.ownership_units ou on ou.id = uu.ownership_unit_id
    where uu.user_id = auth.uid()
      and ou.membership_id = target_membership
  );
$$;

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

create policy "membership users can read benefits"
on public.benefit_grants for select
to authenticated
using (public.user_has_membership_access(membership_id));

create policy "membership users can read reservations"
on public.reservations for select
to authenticated
using (public.user_has_membership_access(membership_id));

create policy "membership users can read transactions"
on public.benefit_transactions for select
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
      and ownership_unit_id = reservations.ownership_unit_id
      and role in ('contributor', 'admin')
  )
);

create policy "contributors can create benefit transactions"
on public.benefit_transactions for insert
to authenticated
with check (
  public.user_has_membership_access(membership_id)
  and exists (
    select 1 from public.unit_users
    where user_id = auth.uid()
      and ownership_unit_id = benefit_transactions.ownership_unit_id
      and role in ('contributor', 'admin')
  )
);

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
select id, 'BPG Weeks', 'shared', 'weeks', 100, '2051-03-29', 'Preferential rate; room category and discount vary.' from membership
union all select id, 'Incentive Stays', 'shared', 'count', 6, '2033-03-29', 'Release dates and Gold Season restrictions apply.' from membership
union all select id, 'Imperial Grand Weeks', 'shared', 'weeks', 2, '2031-03-29', 'Seven nights for two people; additional-person fees may apply.' from membership
union all select id, 'Spa Resort Credit', 'shared', 'currency', 3740, '2031-03-29', 'Service fee applies.' from membership
union all select id, 'Universal Credit', 'shared', 'currency', 280, '2029-03-29', null from membership
union all select id, 'Golf Rounds at 50%', 'golf', 'rounds', 20, null, 'Belcher and Belcher Sr. pool only.' from membership
union all select id, 'Unlimited Golf Bonus Nights', 'golf', 'nights', 8, '2031-03-29', 'Belcher and Belcher Sr. pool only.' from membership;
