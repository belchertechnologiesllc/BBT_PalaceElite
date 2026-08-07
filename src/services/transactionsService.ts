import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import {
  getBenefitCatalog,
  resolveAccessibleMembership,
  type BenefitGrantRecord,
  type BenefitMembershipSummary,
  type BenefitPool,
  type QuantityKind,
} from './benefitsService';

export type BenefitTransactionType =
  | 'earn'
  | 'use'
  | 'adjustment'
  | 'transfer'
  | 'correction'
  | 'reversal'
  | 'import';

export type TransactionDirection = 'increase' | 'decrease';
export type TransactionStatus = Database['public']['Enums']['transaction_status'];

export type TransactionOwnershipUnit = {
  id: string;
  membershipId: string;
  name: string;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
};

export type BenefitTransactionRecord = {
  id: string;
  membershipId: string;
  ownershipUnitId: string;
  ownershipUnitName: string;
  benefitGrantId: string;
  benefitName: string;
  benefitPool: BenefitPool;
  quantityKind: QuantityKind;
  reservationId: string | null;
  transactionType: BenefitTransactionType;
  quantityDelta: number;
  quantityUsed: number | null;
  effectiveDate: string;
  faceValue: number;
  economicValue: number;
  status: TransactionStatus;
  notes: string | null;
  sourceReference: string | null;
  relatedTransactionId: string | null;
  transactionGroupId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
};

export type BenefitTransactionContext = {
  membership: BenefitMembershipSummary;
  grants: BenefitGrantRecord[];
  ownershipUnits: TransactionOwnershipUnit[];
  transactions: BenefitTransactionRecord[];
  isAdmin: boolean;
};

export type CreateBenefitTransactionInput = {
  membershipId: string;
  ownershipUnitId: string;
  benefitGrantId: string;
  transactionType: Exclude<BenefitTransactionType, 'transfer' | 'reversal'>;
  quantity: number;
  direction?: TransactionDirection;
  effectiveDate: string;
  faceValue?: number;
  economicValue?: number;
  notes?: string | null;
  sourceReference?: string | null;
  relatedTransactionId?: string | null;
};

export type CreateBenefitTransferInput = {
  membershipId: string;
  benefitGrantId: string;
  fromOwnershipUnitId: string;
  toOwnershipUnitId: string;
  quantity: number;
  effectiveDate: string;
  notes?: string | null;
  sourceReference?: string | null;
};

// The checked-in generated database types intentionally still describe the
// production schema on main. This feature branch adds columns/functions via a
// migration that has not been applied to production yet. We therefore keep a
// narrow local row overlay and cast only at the boundary where the pending
// migration extends the generated shape. Once the migration is deployed,
// regenerating database.types.ts can remove these compatibility casts.
type PendingTransactionRow = Database['public']['Tables']['benefit_transactions']['Row'] & {
  transaction_type: BenefitTransactionType;
  quantity_delta: number;
  effective_date: string;
  source_reference: string | null;
  related_transaction_id: string | null;
  transaction_group_id: string | null;
  quantity_used: number | null;
};

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  return supabase;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
}

function signedDelta(
  transactionType: CreateBenefitTransactionInput['transactionType'],
  quantity: number,
  direction?: TransactionDirection,
): number {
  if (transactionType === 'use') {
    return -quantity;
  }

  if (transactionType === 'earn') {
    return quantity;
  }

  if (!direction) {
    throw new Error('Increase or decrease direction is required for this transaction type.');
  }

  return direction === 'increase' ? quantity : -quantity;
}

async function invokePendingRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const client = requireSupabase();

  const rpc = client.rpc as unknown as (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => Promise<RpcResult>;

  const { data, error } = await rpc(name, args);

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function mapTransactionRow(
  row: PendingTransactionRow,
  grantsById: Map<string, BenefitGrantRecord>,
  unitsById: Map<string, TransactionOwnershipUnit>,
): BenefitTransactionRecord {
  const grant = grantsById.get(row.benefit_grant_id);
  const unit = unitsById.get(row.ownership_unit_id);

  if (!grant) {
    throw new Error(`Transaction ${row.id} references an inaccessible benefit grant.`);
  }

  if (!unit) {
    throw new Error(`Transaction ${row.id} references an inaccessible ownership unit.`);
  }

  return {
    id: row.id,
    membershipId: row.membership_id,
    ownershipUnitId: row.ownership_unit_id,
    ownershipUnitName: unit.name,
    benefitGrantId: row.benefit_grant_id,
    benefitName: grant.name,
    benefitPool: grant.pool,
    quantityKind: grant.quantityKind,
    reservationId: row.reservation_id,
    transactionType: row.transaction_type,
    quantityDelta: row.quantity_delta,
    quantityUsed: row.quantity_used,
    effectiveDate: row.effective_date,
    faceValue: row.face_value,
    economicValue: row.economic_value,
    status: row.status,
    notes: row.notes,
    sourceReference: row.source_reference,
    relatedTransactionId: row.related_transaction_id,
    transactionGroupId: row.transaction_group_id,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    voidedBy: row.voided_by,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
  };
}

export async function getBenefitTransactionContext(): Promise<BenefitTransactionContext> {
  const client = requireSupabase();
  const membership = await resolveAccessibleMembership();

  const [grants, unitsResult, transactionResult, adminResult] = await Promise.all([
    getBenefitCatalog(membership.id),
    client
      .from('ownership_units')
      .select(`
        id,
        membership_id,
        name,
        participates_in_shared_pool,
        participates_in_golf_pool
      `)
      .eq('membership_id', membership.id)
      .is('archived_at', null)
      .order('name'),
    client
      .from('benefit_transactions')
      .select('*')
      .eq('membership_id', membership.id)
      .order('created_at', { ascending: false }),
    client.rpc('user_is_membership_admin', {
      target_membership: membership.id,
    }),
  ]);

  if (unitsResult.error) {
    throw new Error(unitsResult.error.message);
  }

  if (transactionResult.error) {
    throw new Error(transactionResult.error.message);
  }

  if (adminResult.error) {
    throw new Error(adminResult.error.message);
  }

  const ownershipUnits: TransactionOwnershipUnit[] = (unitsResult.data ?? []).map(
    (unit) => ({
      id: unit.id,
      membershipId: unit.membership_id,
      name: unit.name,
      participatesInSharedPool: unit.participates_in_shared_pool,
      participatesInGolfPool: unit.participates_in_golf_pool,
    }),
  );

  const grantsById = new Map(grants.map((grant) => [grant.id, grant]));
  const unitsById = new Map(ownershipUnits.map((unit) => [unit.id, unit]));

  // See PendingTransactionRow above: select('*') remains valid before and after
  // the migration; the overlay simply describes the post-migration columns to
  // TypeScript while this branch is under review.
  const transactionRows = (transactionResult.data ?? []) as unknown as PendingTransactionRow[];

  const transactions = transactionRows
    .map((row) => mapTransactionRow(row, grantsById, unitsById))
    .sort((a, b) => {
      const byDate = b.effectiveDate.localeCompare(a.effectiveDate);
      return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt);
    });

  return {
    membership,
    grants,
    ownershipUnits,
    transactions,
    isAdmin: adminResult.data === true,
  };
}

export async function createBenefitTransaction(
  input: CreateBenefitTransactionInput,
): Promise<void> {
  const client = requireSupabase();

  if (!input.membershipId || !input.ownershipUnitId || !input.benefitGrantId) {
    throw new Error('Membership, ownership unit, and benefit are required.');
  }

  if (!input.effectiveDate) {
    throw new Error('Effective date is required.');
  }

  assertPositiveFinite(input.quantity, 'Quantity');

  const faceValue = input.faceValue ?? 0;
  const economicValue = input.economicValue ?? 0;
  assertNonNegativeFinite(faceValue, 'Face value');
  assertNonNegativeFinite(economicValue, 'Economic value');

  const notes = normalizeNullableText(input.notes);
  const sourceReference = normalizeNullableText(input.sourceReference);
  const relatedTransactionId = normalizeNullableText(input.relatedTransactionId);

  if (input.transactionType === 'import' && !sourceReference) {
    throw new Error('Import transactions require a source reference.');
  }

  if (
    (input.transactionType === 'adjustment' || input.transactionType === 'correction') &&
    !notes
  ) {
    throw new Error(`${input.transactionType === 'adjustment' ? 'Adjustment' : 'Correction'} transactions require a reason in notes.`);
  }

  if (input.transactionType === 'correction' && !relatedTransactionId) {
    throw new Error('Correction transactions require a related approved transaction.');
  }

  const quantityDelta = signedDelta(
    input.transactionType,
    input.quantity,
    input.direction,
  );

  const pendingPayload = {
    membership_id: input.membershipId,
    ownership_unit_id: input.ownershipUnitId,
    benefit_grant_id: input.benefitGrantId,
    transaction_type: input.transactionType,
    quantity_delta: quantityDelta,
    quantity_used: input.transactionType === 'use' ? input.quantity : null,
    effective_date: input.effectiveDate,
    face_value: faceValue,
    economic_value: economicValue,
    status: 'submitted' as TransactionStatus,
    notes,
    source_reference: sourceReference,
    related_transaction_id:
      input.transactionType === 'correction' ? relatedTransactionId : null,
  };

  // Cast only at the pending-schema boundary; see PendingTransactionRow.
  const payload = pendingPayload as unknown as Database['public']['Tables']['benefit_transactions']['Insert'];

  const { error } = await client.from('benefit_transactions').insert(payload);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createBenefitTransfer(
  input: CreateBenefitTransferInput,
): Promise<void> {
  if (!input.membershipId || !input.benefitGrantId) {
    throw new Error('Membership and benefit are required.');
  }

  if (!input.fromOwnershipUnitId || !input.toOwnershipUnitId) {
    throw new Error('Transfer source and destination ownership units are required.');
  }

  if (input.fromOwnershipUnitId === input.toOwnershipUnitId) {
    throw new Error('Transfer source and destination must be different.');
  }

  if (!input.effectiveDate) {
    throw new Error('Effective date is required.');
  }

  assertPositiveFinite(input.quantity, 'Transfer quantity');

  await invokePendingRpc('create_benefit_transfer', {
    p_membership_id: input.membershipId,
    p_benefit_grant_id: input.benefitGrantId,
    p_from_ownership_unit_id: input.fromOwnershipUnitId,
    p_to_ownership_unit_id: input.toOwnershipUnitId,
    p_quantity: input.quantity,
    p_effective_date: input.effectiveDate,
    p_notes: normalizeNullableText(input.notes),
    p_source_reference: normalizeNullableText(input.sourceReference),
  });
}

export async function approveBenefitTransaction(transactionId: string): Promise<void> {
  if (!transactionId) {
    throw new Error('transactionId is required.');
  }

  await invokePendingRpc('approve_benefit_transaction', {
    p_transaction_id: transactionId,
  });
}

export async function reverseBenefitTransaction(
  transactionId: string,
  reason: string,
  sourceReference?: string | null,
): Promise<void> {
  if (!transactionId) {
    throw new Error('transactionId is required.');
  }

  const normalizedReason = normalizeNullableText(reason);
  if (!normalizedReason) {
    throw new Error('A reversal reason is required.');
  }

  await invokePendingRpc('create_benefit_reversal', {
    p_transaction_id: transactionId,
    p_reason: normalizedReason,
    p_source_reference: normalizeNullableText(sourceReference),
  });
}

export async function cancelBenefitTransaction(
  transactionId: string,
  reason: string,
): Promise<void> {
  if (!transactionId) {
    throw new Error('transactionId is required.');
  }

  const normalizedReason = normalizeNullableText(reason);
  if (!normalizedReason) {
    throw new Error('A cancellation reason is required.');
  }

  await invokePendingRpc('void_benefit_transaction', {
    p_transaction_id: transactionId,
    p_reason: normalizedReason,
  });
}
