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

export type MemberReportRow = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  relationshipToPrimary: string | null;
  personRole: string;
  dateOfBirth: string | null;
  ownershipUnitName: string;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
  isActive: boolean;
  archivedAt: string | null;
};

export type OwnershipReportRow = {
  id: string;
  name: string;
  membersDescription: string | null;
  ownershipPercentage: number;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
  activeMemberCount: number;
  activeMembers: string;
  archivedAt: string | null;
};

export type BenefitUsageReportRow = {
  id: string;
  effectiveDate: string;
  transactionType: BenefitTransactionType;
  status: TransactionStatus;
  ownershipUnitName: string;
  benefitName: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  quantityDelta: number;
  faceValue: number;
  economicValue: number;
  notes: string | null;
  sourceReference: string | null;
  relatedTransactionId: string | null;
  transactionGroupId: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
};

export type PoolActivityReportRow = {
  pool: BenefitPool;
  ownershipUnitName: string;
  quantityKind: QuantityKind;
  transactionCount: number;
  netQuantityDelta: number;
  useQuantity: number;
  economicValueRecorded: number;
};

export type AuditReportRow = {
  id: number;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  previousData: unknown;
  newData: unknown;
};

export type ReportingSnapshot = {
  membership: { id: string; name: string };
  fromDate: string;
  toDate: string;
  isAdmin: boolean;
  members: MemberReportRow[];
  ownership: OwnershipReportRow[];
  benefitUsage: BenefitUsageReportRow[];
  poolActivity: PoolActivityReportRow[];
  audit: AuditReportRow[];
  generatedAt: string;
};

type Payload = {
  membership_id: string;
  from_date: string;
  to_date: string;
  is_admin: boolean;
  generated_at: string;
  members: Array<Record<string, unknown>>;
  ownership: Array<Record<string, unknown>>;
  benefit_usage: Array<Record<string, unknown>>;
  pool_activity: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
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
  if (!Number.isFinite(result)) throw new Error(`Report returned an invalid ${label}.`);
  return result;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Report returned an invalid ${label}.`);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function assertPayload(data: unknown): Payload {
  if (!data || typeof data !== 'object') {
    throw new Error('Reporting snapshot returned an invalid response.');
  }
  const value = data as Partial<Payload>;
  if (
    typeof value.membership_id !== 'string' ||
    typeof value.from_date !== 'string' ||
    typeof value.to_date !== 'string' ||
    typeof value.is_admin !== 'boolean' ||
    typeof value.generated_at !== 'string' ||
    !Array.isArray(value.members) ||
    !Array.isArray(value.ownership) ||
    !Array.isArray(value.benefit_usage) ||
    !Array.isArray(value.pool_activity) ||
    !Array.isArray(value.audit)
  ) {
    throw new Error('Reporting snapshot returned an incomplete response.');
  }
  return value as Payload;
}

export async function getReportingSnapshot(
  fromDate: string,
  toDate: string,
): Promise<ReportingSnapshot> {
  if (!fromDate || !toDate) throw new Error('A report date range is required.');
  if (fromDate > toDate) throw new Error('Report start date cannot be after end date.');

  const client = requireSupabase();
  const membership = await resolveAccessibleMembership();
  const rpcClient = client as unknown as RpcClient;
  const { data, error } = await rpcClient.rpc('get_reporting_snapshot', {
    p_membership_id: membership.id,
    p_from: fromDate,
    p_to: toDate,
  });

  if (error) throw new Error(error.message);
  const payload = assertPayload(data);
  if (payload.membership_id !== membership.id) {
    throw new Error('Reporting snapshot membership did not match the active membership.');
  }

  return {
    membership,
    fromDate: payload.from_date,
    toDate: payload.to_date,
    isAdmin: payload.is_admin,
    generatedAt: payload.generated_at,
    members: payload.members.map((row) => ({
      id: stringValue(row.id, 'member id'),
      firstName: stringValue(row.first_name, 'first name'),
      lastName: stringValue(row.last_name, 'last name'),
      preferredName: nullableString(row.preferred_name),
      relationshipToPrimary: nullableString(row.relationship_to_primary),
      personRole: stringValue(row.person_role, 'person role'),
      dateOfBirth: nullableString(row.date_of_birth),
      ownershipUnitName: stringValue(row.ownership_unit_name, 'ownership unit'),
      participatesInSharedPool: row.participates_in_shared_pool === true,
      participatesInGolfPool: row.participates_in_golf_pool === true,
      isActive: row.is_active === true,
      archivedAt: nullableString(row.archived_at),
    })),
    ownership: payload.ownership.map((row) => ({
      id: stringValue(row.id, 'ownership id'),
      name: stringValue(row.name, 'ownership name'),
      membersDescription: nullableString(row.members_description),
      ownershipPercentage: numberValue(row.ownership_percentage, 'ownership percentage'),
      participatesInSharedPool: row.participates_in_shared_pool === true,
      participatesInGolfPool: row.participates_in_golf_pool === true,
      activeMemberCount: numberValue(row.active_member_count, 'active member count'),
      activeMembers: typeof row.active_members === 'string' ? row.active_members : '',
      archivedAt: nullableString(row.archived_at),
    })),
    benefitUsage: payload.benefit_usage.map((row) => ({
      id: stringValue(row.id, 'transaction id'),
      effectiveDate: stringValue(row.effective_date, 'effective date'),
      transactionType: stringValue(row.transaction_type, 'transaction type') as BenefitTransactionType,
      status: stringValue(row.status, 'transaction status') as TransactionStatus,
      ownershipUnitName: stringValue(row.ownership_unit_name, 'ownership unit'),
      benefitName: stringValue(row.benefit_name, 'benefit name'),
      pool: stringValue(row.pool, 'pool') as BenefitPool,
      quantityKind: stringValue(row.quantity_kind, 'quantity kind') as QuantityKind,
      quantityDelta: numberValue(row.quantity_delta, 'quantity delta'),
      faceValue: numberValue(row.face_value, 'face value'),
      economicValue: numberValue(row.economic_value, 'economic value'),
      notes: nullableString(row.notes),
      sourceReference: nullableString(row.source_reference),
      relatedTransactionId: nullableString(row.related_transaction_id),
      transactionGroupId: nullableString(row.transaction_group_id),
      approvedAt: nullableString(row.approved_at),
      voidedAt: nullableString(row.voided_at),
    })),
    poolActivity: payload.pool_activity.map((row) => ({
      pool: stringValue(row.pool, 'pool') as BenefitPool,
      ownershipUnitName: stringValue(row.ownership_unit_name, 'ownership unit'),
      quantityKind: stringValue(row.quantity_kind, 'quantity kind') as QuantityKind,
      transactionCount: numberValue(row.transaction_count, 'transaction count'),
      netQuantityDelta: numberValue(row.net_quantity_delta, 'net quantity delta'),
      useQuantity: numberValue(row.use_quantity, 'use quantity'),
      economicValueRecorded: numberValue(row.economic_value_recorded, 'economic value'),
    })),
    audit: payload.audit.map((row) => ({
      id: numberValue(row.id, 'audit id'),
      createdAt: stringValue(row.created_at, 'audit timestamp'),
      actorId: nullableString(row.actor_id),
      actorName: typeof row.actor_name === 'string' ? row.actor_name.trim() : '',
      action: stringValue(row.action, 'audit action'),
      entityType: stringValue(row.entity_type, 'audit entity type'),
      entityId: nullableString(row.entity_id),
      previousData: row.previous_data ?? null,
      newData: row.new_data ?? null,
    })),
  };
}
