import { supabase } from '../lib/supabase';
import {
  resolveAccessibleMembership,
  type BenefitPool,
  type QuantityKind,
} from './benefitsService';

export type AccountingUnitBalance = {
  benefitGrantId: string;
  benefitName: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  ownershipUnitId: string;
  ownershipUnitName: string;
  allocationPercentage: number;
  allocatedQuantity: number;
  ledgerDelta: number;
  remainingQuantity: number;
};

export type AccountingReconciliation = {
  benefitGrantId: string;
  benefitName: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: number;
  grantRemainingQuantity: number;
  unitAllocatedQuantity: number;
  unitRemainingQuantity: number;
  originalReconciliationDifference: number;
  remainingReconciliationDifference: number;
  isReconciled: boolean;
};

export type AccountingSnapshot = {
  membership: {
    id: string;
    name: string;
  };
  asOf: string;
  unitBalances: AccountingUnitBalance[];
  reconciliation: AccountingReconciliation[];
};

type AccountingSnapshotPayload = {
  membership_id: string;
  as_of: string;
  unit_balances: Array<{
    benefit_grant_id: string;
    benefit_name: string;
    pool: BenefitPool;
    quantity_kind: QuantityKind;
    ownership_unit_id: string;
    ownership_unit_name: string;
    allocation_percentage: number | string;
    allocated_quantity: number | string;
    ledger_delta: number | string;
    remaining_quantity: number | string;
  }>;
  reconciliation: Array<{
    benefit_grant_id: string;
    benefit_name: string;
    pool: BenefitPool;
    quantity_kind: QuantityKind;
    original_quantity: number | string;
    grant_remaining_quantity: number | string;
    unit_allocated_quantity: number | string;
    unit_remaining_quantity: number | string;
    original_reconciliation_difference: number | string;
    remaining_reconciliation_difference: number | string;
    is_reconciled: boolean;
  }>;
};

type PendingRpcClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function requireSupabase(): NonNullable<typeof supabase> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  return supabase;
}

function asFiniteNumber(value: number | string, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(`Accounting snapshot returned an invalid ${label}.`);
  }

  return numeric;
}

function assertPayload(value: unknown): AccountingSnapshotPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Accounting snapshot returned an invalid response.');
  }

  const payload = value as Partial<AccountingSnapshotPayload>;

  if (
    typeof payload.membership_id !== 'string' ||
    typeof payload.as_of !== 'string' ||
    !Array.isArray(payload.unit_balances) ||
    !Array.isArray(payload.reconciliation)
  ) {
    throw new Error('Accounting snapshot returned an incomplete response.');
  }

  return payload as AccountingSnapshotPayload;
}

export async function getAccountingSnapshot(
  asOf: string,
): Promise<AccountingSnapshot> {
  if (!asOf) {
    throw new Error('An as-of date is required.');
  }

  const client = requireSupabase();
  const membership = await resolveAccessibleMembership();

  // The RPC is introduced by the Issue #12 migration. Keep this cast narrow
  // until generated database types are refreshed after the migration reaches
  // the hosted project. Calling through the client object (rather than an
  // unbound rpc function reference) preserves Supabase's internal context.
  const pendingClient = client as unknown as PendingRpcClient;
  const { data, error } = await pendingClient.rpc(
    'get_benefit_accounting_snapshot',
    {
      p_membership_id: membership.id,
      p_as_of: asOf,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = assertPayload(data);

  if (payload.membership_id !== membership.id) {
    throw new Error('Accounting snapshot membership did not match the active membership.');
  }

  return {
    membership,
    asOf: payload.as_of,
    unitBalances: payload.unit_balances.map((row) => ({
      benefitGrantId: row.benefit_grant_id,
      benefitName: row.benefit_name,
      pool: row.pool,
      quantityKind: row.quantity_kind,
      ownershipUnitId: row.ownership_unit_id,
      ownershipUnitName: row.ownership_unit_name,
      allocationPercentage: asFiniteNumber(row.allocation_percentage, 'allocation percentage'),
      allocatedQuantity: asFiniteNumber(row.allocated_quantity, 'allocated quantity'),
      ledgerDelta: asFiniteNumber(row.ledger_delta, 'ledger delta'),
      remainingQuantity: asFiniteNumber(row.remaining_quantity, 'remaining quantity'),
    })),
    reconciliation: payload.reconciliation.map((row) => ({
      benefitGrantId: row.benefit_grant_id,
      benefitName: row.benefit_name,
      pool: row.pool,
      quantityKind: row.quantity_kind,
      originalQuantity: asFiniteNumber(row.original_quantity, 'original quantity'),
      grantRemainingQuantity: asFiniteNumber(row.grant_remaining_quantity, 'grant remaining quantity'),
      unitAllocatedQuantity: asFiniteNumber(row.unit_allocated_quantity, 'unit allocated quantity'),
      unitRemainingQuantity: asFiniteNumber(row.unit_remaining_quantity, 'unit remaining quantity'),
      originalReconciliationDifference: asFiniteNumber(
        row.original_reconciliation_difference,
        'original reconciliation difference',
      ),
      remainingReconciliationDifference: asFiniteNumber(
        row.remaining_reconciliation_difference,
        'remaining reconciliation difference',
      ),
      isReconciled: row.is_reconciled === true,
    })),
  };
}
