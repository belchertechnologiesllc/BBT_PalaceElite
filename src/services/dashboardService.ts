import { supabase } from '../lib/supabase';
import {
  resolveAccessibleMembership,
  type BenefitPool,
  type QuantityKind,
} from './benefitsService';
import type {
  BenefitTransactionType,
  TransactionStatus,
} from './transactionsService';

export type { QuantityKind } from './benefitsService';

export type DashboardBenefitRow = {
  id: string;
  name: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: number;
  remainingQuantity: number;
  expirationDate: string | null;
};

export type DashboardOwnershipPosition = {
  id: string;
  name: string;
  membersDescription: string | null;
  ownershipPercentage: number;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
  activeMemberCount: number;
  sharedActivityCount: number;
  golfRoundsPosition: number | null;
  golfNightsPosition: number | null;
};

export type DashboardRecentActivity = {
  id: string;
  effectiveDate: string;
  createdAt: string;
  transactionType: BenefitTransactionType;
  status: TransactionStatus;
  quantityDelta: number;
  notes: string | null;
  sourceReference: string | null;
  ownershipUnitName: string;
  benefitName: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
};

export type DashboardExpiration = {
  benefitGrantId: string;
  benefitName: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  remainingQuantity: number;
  expirationDate: string;
  daysRemaining: number;
};

export type DashboardData = {
  membership: {
    id: string;
    name: string;
    purchasePrice: number;
    startDate: string;
    expirationDate: string;
  };
  summary: {
    activeMembers: number;
    activeOwnershipUnits: number;
    openReservations: number;
    pendingApprovals: number;
    approvedTransactions30d: number;
    unreconciledBenefits: number;
    futureExpirations: number;
  };
  benefits: DashboardBenefitRow[];
  ownershipPositions: DashboardOwnershipPosition[];
  recentActivity: DashboardRecentActivity[];
  expirations: DashboardExpiration[];
  generatedAt: string;
};

type Payload = {
  membership: Record<string, unknown>;
  summary: Record<string, unknown>;
  benefits: Array<Record<string, unknown>>;
  ownership_positions: Array<Record<string, unknown>>;
  recent_activity: Array<Record<string, unknown>>;
  expirations: Array<Record<string, unknown>>;
  generated_at: string;
};

type RpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function numberValue(value: unknown, label: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(`Dashboard returned an invalid ${label}.`);
  return result;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Dashboard returned an invalid ${label}.`);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function assertPayload(data: unknown): Payload {
  if (!data || typeof data !== 'object') throw new Error('Dashboard returned an invalid response.');
  const value = data as Partial<Payload>;
  if (
    !value.membership ||
    !value.summary ||
    !Array.isArray(value.benefits) ||
    !Array.isArray(value.ownership_positions) ||
    !Array.isArray(value.recent_activity) ||
    !Array.isArray(value.expirations) ||
    typeof value.generated_at !== 'string'
  ) {
    throw new Error('Dashboard returned an incomplete response.');
  }
  return value as Payload;
}

export async function getDashboardData(): Promise<DashboardData> {
  const client = requireSupabase();
  const membership = await resolveAccessibleMembership();
  const rpcClient = client as unknown as RpcClient;
  const { data, error } = await rpcClient.rpc('get_operational_dashboard_snapshot', {
    p_membership_id: membership.id,
  });

  if (error) throw new Error(error.message);
  const payload = assertPayload(data);
  const membershipPayload = payload.membership;
  const summary = payload.summary;

  const membershipId = stringValue(membershipPayload.id, 'membership id');
  if (membershipId !== membership.id) {
    throw new Error('Dashboard membership did not match the active membership.');
  }

  return {
    membership: {
      id: membershipId,
      name: stringValue(membershipPayload.name, 'membership name'),
      purchasePrice: numberValue(membershipPayload.purchase_price, 'purchase price'),
      startDate: stringValue(membershipPayload.start_date, 'membership start date'),
      expirationDate: stringValue(membershipPayload.expiration_date, 'membership expiration date'),
    },
    summary: {
      activeMembers: numberValue(summary.active_members, 'active member count'),
      activeOwnershipUnits: numberValue(summary.active_ownership_units, 'ownership unit count'),
      openReservations: numberValue(summary.open_reservations, 'open reservation count'),
      pendingApprovals: numberValue(summary.pending_approvals, 'pending approval count'),
      approvedTransactions30d: numberValue(summary.approved_transactions_30d, 'recent approval count'),
      unreconciledBenefits: numberValue(summary.unreconciled_benefits, 'reconciliation exception count'),
      futureExpirations: numberValue(summary.future_expirations, 'future expiration count'),
    },
    benefits: payload.benefits.map((row) => ({
      id: stringValue(row.id, 'benefit id'),
      name: stringValue(row.name, 'benefit name'),
      pool: stringValue(row.pool, 'benefit pool') as BenefitPool,
      quantityKind: stringValue(row.quantity_kind, 'quantity kind') as QuantityKind,
      originalQuantity: numberValue(row.original_quantity, 'original quantity'),
      remainingQuantity: numberValue(row.remaining_quantity, 'remaining quantity'),
      expirationDate: nullableString(row.expiration_date),
    })),
    ownershipPositions: payload.ownership_positions.map((row) => ({
      id: stringValue(row.id, 'ownership id'),
      name: stringValue(row.name, 'ownership name'),
      membersDescription: nullableString(row.members_description),
      ownershipPercentage: numberValue(row.ownership_percentage, 'ownership percentage'),
      participatesInSharedPool: row.participates_in_shared_pool === true,
      participatesInGolfPool: row.participates_in_golf_pool === true,
      activeMemberCount: numberValue(row.active_member_count, 'active member count'),
      sharedActivityCount: numberValue(row.shared_activity_count, 'shared activity count'),
      golfRoundsPosition: row.golf_rounds_position === null ? null : numberValue(row.golf_rounds_position, 'golf rounds position'),
      golfNightsPosition: row.golf_nights_position === null ? null : numberValue(row.golf_nights_position, 'golf nights position'),
    })),
    recentActivity: payload.recent_activity.map((row) => ({
      id: stringValue(row.id, 'transaction id'),
      effectiveDate: stringValue(row.effective_date, 'effective date'),
      createdAt: stringValue(row.created_at, 'created timestamp'),
      transactionType: stringValue(row.transaction_type, 'transaction type') as BenefitTransactionType,
      status: stringValue(row.status, 'transaction status') as TransactionStatus,
      quantityDelta: numberValue(row.quantity_delta, 'quantity change'),
      notes: nullableString(row.notes),
      sourceReference: nullableString(row.source_reference),
      ownershipUnitName: stringValue(row.ownership_unit_name, 'ownership unit'),
      benefitName: stringValue(row.benefit_name, 'benefit name'),
      pool: stringValue(row.pool, 'benefit pool') as BenefitPool,
      quantityKind: stringValue(row.quantity_kind, 'quantity kind') as QuantityKind,
    })),
    expirations: payload.expirations.map((row) => ({
      benefitGrantId: stringValue(row.benefit_grant_id, 'benefit id'),
      benefitName: stringValue(row.benefit_name, 'benefit name'),
      pool: stringValue(row.pool, 'benefit pool') as BenefitPool,
      quantityKind: stringValue(row.quantity_kind, 'quantity kind') as QuantityKind,
      remainingQuantity: numberValue(row.remaining_quantity, 'remaining quantity'),
      expirationDate: stringValue(row.expiration_date, 'expiration date'),
      daysRemaining: numberValue(row.days_remaining, 'days remaining'),
    })),
    generatedAt: payload.generated_at,
  };
}
