import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { resolveAccessibleMembership } from './benefitsService';
import {
  getActiveOwnershipUnits,
  type OwnershipUnitOption,
} from './ownershipUnitsService';

export type BenefitPool = Database['public']['Enums']['benefit_pool'];
export type QuantityKind = Database['public']['Enums']['quantity_kind'];

export type DashboardBenefitRow = {
  id: string;
  name: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: number;
  remainingQuantity: number;
  expirationDate: string | null;
};

export type DashboardMembershipSummary = {
  id: string;
  name: string;
  purchasePrice: number;
};

export type DashboardData = {
  membership: DashboardMembershipSummary;
  ownershipUnits: OwnershipUnitOption[];
  benefits: DashboardBenefitRow[];
  openReservationsCount: number;
};

// -----------------------------------------------------------------------
// Internal helpers (not exported -- the UI has no need for these directly)
// -----------------------------------------------------------------------

type BenefitBalanceRow = Pick<
  Database['public']['Views']['benefit_balances']['Row'],
  | 'id'
  | 'name'
  | 'pool'
  | 'quantity_kind'
  | 'original_quantity'
  | 'remaining_quantity'
  | 'expiration_date'
>;

const BENEFIT_BALANCE_COLUMNS = `
  id,
  name,
  pool,
  quantity_kind,
  original_quantity,
  remaining_quantity,
  expiration_date
`;

// public.benefit_balances is a Postgres view, so every column is typed
// nullable regardless of the underlying benefit_grants constraints
// (id/name/pool/quantity_kind/original_quantity/remaining_quantity are
// NOT NULL on the source table -- only expiration_date is genuinely
// nullable). A null in any of the "always populated" fields here would
// indicate a schema drift bug, not a valid row to render, so such a row
// is dropped rather than rendered with invented placeholder text.
function mapBenefitBalanceRow(row: BenefitBalanceRow): DashboardBenefitRow | null {
  if (
    row.id === null ||
    row.name === null ||
    row.pool === null ||
    row.quantity_kind === null ||
    row.original_quantity === null ||
    row.remaining_quantity === null
  ) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    pool: row.pool,
    quantityKind: row.quantity_kind,
    originalQuantity: row.original_quantity,
    remainingQuantity: row.remaining_quantity,
    expirationDate: row.expiration_date,
  };
}

// -----------------------------------------------------------------------
// Public service methods
// -----------------------------------------------------------------------

// Bundles everything the Dashboard page needs into one call: the current
// membership (id/name/purchase_price), its active ownership units, its
// live benefit balances (original vs. remaining, authoritative per
// public.benefit_balances -- see the view definition in
// 20260728033000_initial_schema.sql), and a count of non-voided
// reservations. Read-only; no accounting, transaction, or reservation
// data is written or altered.
export async function getDashboardData(
  signal?: AbortSignal,
): Promise<DashboardData> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const membershipSummary = await resolveAccessibleMembership();

  // .abortSignal() must be called before a terminal builder method like
  // .single() -- it is not available on the resulting thenable, hence
  // applying it mid-chain here rather than after.
  let membershipBuilder = supabase
    .from('memberships')
    .select('id, name, purchase_price')
    .eq('id', membershipSummary.id);

  let balancesBuilder = supabase
    .from('benefit_balances')
    .select(BENEFIT_BALANCE_COLUMNS)
    .eq('membership_id', membershipSummary.id)
    .is('archived_at', null)
    .order('pool', { ascending: true })
    .order('name', { ascending: true });

  // head: false (i.e. a normal response body) is used deliberately over
  // head: true here: a HEAD request returns no body, which is more
  // bandwidth-efficient, but was observed in browser QA to trigger a
  // benign Chromium DevTools Protocol quirk where a second
  // Network.loadingFailed (net::ERR_ABORTED) event is emitted for the
  // same already-succeeded request -- confirmed harmless (exactly one
  // real request, one real 200 response, correct data rendered) but
  // avoided outright here since it shows up as a spurious "failed
  // request" in tooling. The reservations count for one membership is a
  // handful of rows at most, so the tiny extra response body is immaterial.
  let reservationsBuilder = supabase
    .from('reservations')
    .select('id', { count: 'exact' })
    .eq('membership_id', membershipSummary.id)
    .is('voided_at', null);

  if (signal) {
    membershipBuilder = membershipBuilder.abortSignal(signal);
    balancesBuilder = balancesBuilder.abortSignal(signal);
    reservationsBuilder = reservationsBuilder.abortSignal(signal);
  }

  const [membershipResult, ownershipUnits, balancesResult, reservationsResult] =
    await Promise.all([
      membershipBuilder.single(),
      getActiveOwnershipUnits(signal),
      balancesBuilder,
      reservationsBuilder,
    ]);

  if (membershipResult.error) {
    throw new Error(membershipResult.error.message);
  }

  if (!membershipResult.data) {
    throw new Error('Membership was not found.');
  }

  if (balancesResult.error) {
    throw new Error(balancesResult.error.message);
  }

  if (reservationsResult.error) {
    throw new Error(reservationsResult.error.message);
  }

  const benefits = (balancesResult.data ?? [])
    .map(mapBenefitBalanceRow)
    .filter((row): row is DashboardBenefitRow => row !== null);

  return {
    membership: {
      id: membershipResult.data.id,
      name: membershipResult.data.name,
      purchasePrice: membershipResult.data.purchase_price,
    },
    ownershipUnits,
    benefits,
    openReservationsCount: reservationsResult.count ?? 0,
  };
}
