import { supabase } from '../lib/supabase';
import { Constants, type Database } from '../lib/database.types';

export type BenefitPool = Database['public']['Enums']['benefit_pool'];
export type QuantityKind = Database['public']['Enums']['quantity_kind'];

export type BenefitMembershipSummary = {
  id: string;
  name: string;
};

export type BenefitAdministrationContext = {
  membership: BenefitMembershipSummary;
  grants: BenefitGrantRecord[];
};

export type BenefitGrantRecord = {
  id: string;
  membershipId: string;
  name: string;
  benefitCode: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: number;
  releaseDate: string | null;
  expirationDate: string | null;
  restrictions: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  createdAt: string;
  hasRecordedUsage: boolean;
};

export type CreateBenefitGrantInput = {
  membershipId: string;
  name: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: number;
  releaseDate?: string | null;
  expirationDate?: string | null;
  restrictions?: string | null;
};

// id and archived-status/restrictions/pool/etc. are intentionally absent so
// the type system rejects attempts to send accounting or archival fields
// through this method.
export type UpdateBenefitGrantMetadataInput = {
  id: string;
  name: string;
  restrictions: string | null;
};

// membershipId, name, restrictions, createdAt, and archival fields are
// intentionally absent so the type system rejects attempts to send them
// through this method.
export type UpdateBenefitGrantAccountingInput = {
  id: string;
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: number;
  releaseDate?: string | null;
  expirationDate?: string | null;
};

// -----------------------------------------------------------------------
// Internal helpers (not exported -- the UI has no need for these directly)
// -----------------------------------------------------------------------

type BenefitGrantRow = Database['public']['Tables']['benefit_grants']['Row'];

const BENEFIT_GRANT_COLUMNS = `
  id,
  membership_id,
  name,
  benefit_code,
  pool,
  quantity_kind,
  original_quantity,
  release_date,
  expiration_date,
  restrictions,
  archived_at,
  archived_reason,
  created_at
`;

function mapBenefitGrantRow(
  row: BenefitGrantRow,
  hasRecordedUsage: boolean,
): BenefitGrantRecord {
  return {
    id: row.id,
    membershipId: row.membership_id,
    name: row.name,
    benefitCode: row.benefit_code,
    pool: row.pool,
    quantityKind: row.quantity_kind,
    originalQuantity: row.original_quantity,
    releaseDate: row.release_date,
    expirationDate: row.expiration_date,
    restrictions: row.restrictions,
    archivedAt: row.archived_at,
    archivedReason: row.archived_reason,
    createdAt: row.created_at,
    hasRecordedUsage,
  };
}

function normalizeRequiredText(value: string, fieldLabel: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${fieldLabel} is required.`);
  }

  return trimmed;
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Dates arrive as plain 'YYYY-MM-DD' strings (the shape Supabase returns for
// a `date` column); blank optional-date input from a form is treated the
// same as omitted, not as an explicit clear-to-null vs. leave-unset
// distinction, since benefit_grants has no separate "unset" semantics for
// these columns beyond NULL.
function normalizeNullableDate(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertValidPool(pool: BenefitPool): void {
  if (!Constants.public.Enums.benefit_pool.includes(pool)) {
    throw new Error(
      `Pool must be one of: ${Constants.public.Enums.benefit_pool.join(', ')}.`,
    );
  }
}

function assertValidQuantityKind(quantityKind: QuantityKind): void {
  if (!Constants.public.Enums.quantity_kind.includes(quantityKind)) {
    throw new Error(
      `Quantity kind must be one of: ${Constants.public.Enums.quantity_kind.join(', ')}.`,
    );
  }
}

function assertValidOriginalQuantity(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      'Original quantity must be a finite number greater than or equal to 0.',
    );
  }
}

// Enforced only at this service layer today -- no database constraint backs
// this (confirmed during ISSUE-10 / STEP-2 discovery; not added as a
// migration in STEP-3 per that step's authorized scope). A grant with only
// one of the two dates set is left unvalidated on purpose, since either
// date alone is a normal, valid state.
function assertValidDateOrder(
  releaseDate: string | null,
  expirationDate: string | null,
): void {
  if (releaseDate && expirationDate && expirationDate < releaseDate) {
    throw new Error('Expiration date cannot be before release date.');
  }
}

function toPgrstAwareError(
  error: { code?: string; message: string },
  notFoundMessage: string,
): Error {
  return new Error(
    error.code === 'PGRST116' ? notFoundMessage : error.message,
  );
}

// Bounded two-query usage lookup: one query for the catalog, one query here
// scoped to only the grant ids actually being returned/updated -- never one
// query per grant, and never inferred from public.benefit_balances (a
// voided-but-referenced grant must still report hasRecordedUsage = true,
// which a balance-derived check would miss). Every transaction status
// counts, so no status filter is applied. Reservations are never consulted:
// public.reservations has no benefit_grant_id column and cannot reference a
// grant at all.
async function fetchUsageFlags(grantIds: string[]): Promise<Set<string>> {
  if (grantIds.length === 0) {
    return new Set();
  }

  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('benefit_transactions')
    .select('benefit_grant_id')
    .in('benefit_grant_id', grantIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Set((data ?? []).map((row) => row.benefit_grant_id));
}

// -----------------------------------------------------------------------
// Public service methods
// -----------------------------------------------------------------------

export async function getBenefitCatalog(
  membershipId: string,
): Promise<BenefitGrantRecord[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (!membershipId) {
    throw new Error('membershipId is required.');
  }

  const { data: grants, error: grantsError } = await supabase
    .from('benefit_grants')
    .select(BENEFIT_GRANT_COLUMNS)
    .eq('membership_id', membershipId)
    .is('archived_at', null)
    // public.benefit_pool is declared `enum ('shared', 'golf')`, so Postgres
    // sorts by that declaration order, not alphabetically -- ordering by
    // the column itself already yields Shared before Golf. If the enum is
    // ever redeclared with a different member order, this sort silently
    // changes with it.
    .order('pool', { ascending: true })
    .order('release_date', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .order('id', { ascending: true });

  if (grantsError) {
    throw new Error(grantsError.message);
  }

  const grantRows = grants ?? [];

  if (grantRows.length === 0) {
    return [];
  }

  const usage = await fetchUsageFlags(grantRows.map((row) => row.id));

  return grantRows.map((row) => mapBenefitGrantRow(row, usage.has(row.id)));
}

export async function createBenefitGrant(
  input: CreateBenefitGrantInput,
): Promise<BenefitGrantRecord> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (!input.membershipId) {
    throw new Error('membershipId is required.');
  }

  const name = normalizeRequiredText(input.name, 'Benefit name');
  assertValidPool(input.pool);
  assertValidQuantityKind(input.quantityKind);
  assertValidOriginalQuantity(input.originalQuantity);

  const releaseDate = normalizeNullableDate(input.releaseDate);
  const expirationDate = normalizeNullableDate(input.expirationDate);
  assertValidDateOrder(releaseDate, expirationDate);

  const restrictions = normalizeNullableText(input.restrictions);

  const { data, error } = await supabase
    .from('benefit_grants')
    .insert({
      membership_id: input.membershipId,
      name,
      pool: input.pool,
      quantity_kind: input.quantityKind,
      original_quantity: input.originalQuantity,
      release_date: releaseDate,
      expiration_date: expirationDate,
      restrictions,
    })
    .select(BENEFIT_GRANT_COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error('Benefit grant was not created.');
  }

  // A brand-new grant cannot yet have any referencing benefit_transactions
  // row, so this is known false without a round trip.
  return mapBenefitGrantRow(data, false);
}

export async function updateBenefitGrantMetadata(
  input: UpdateBenefitGrantMetadataInput,
): Promise<BenefitGrantRecord> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (!input.id) {
    throw new Error('id is required.');
  }

  const name = normalizeRequiredText(input.name, 'Benefit name');
  const restrictions = normalizeNullableText(input.restrictions);

  const { data, error } = await supabase
    .from('benefit_grants')
    .update({ name, restrictions })
    .eq('id', input.id)
    .select(BENEFIT_GRANT_COLUMNS)
    .single();

  if (error) {
    throw toPgrstAwareError(
      error,
      'Benefit grant was not found or you do not have permission to update it.',
    );
  }

  if (!data) {
    throw new Error('Benefit grant was not found or could not be updated.');
  }

  const usage = await fetchUsageFlags([data.id]);
  return mapBenefitGrantRow(data, usage.has(data.id));
}

export async function updateBenefitGrantAccounting(
  input: UpdateBenefitGrantAccountingInput,
): Promise<BenefitGrantRecord> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (!input.id) {
    throw new Error('id is required.');
  }

  assertValidPool(input.pool);
  assertValidQuantityKind(input.quantityKind);
  assertValidOriginalQuantity(input.originalQuantity);

  const releaseDate = normalizeNullableDate(input.releaseDate);
  const expirationDate = normalizeNullableDate(input.expirationDate);
  assertValidDateOrder(releaseDate, expirationDate);

  // No pre-check of hasRecordedUsage is performed here: the
  // enforce_benefit_grant_immutability_trg trigger added in
  // 20260731190000_protect_benefit_grant_accounting_fields.sql is the sole
  // authority on whether this update is allowed. Its raised message is
  // forwarded to the caller verbatim below, not reinterpreted or swallowed.
  const { data, error } = await supabase
    .from('benefit_grants')
    .update({
      pool: input.pool,
      quantity_kind: input.quantityKind,
      original_quantity: input.originalQuantity,
      release_date: releaseDate,
      expiration_date: expirationDate,
    })
    .eq('id', input.id)
    .select(BENEFIT_GRANT_COLUMNS)
    .single();

  if (error) {
    throw toPgrstAwareError(
      error,
      'Benefit grant was not found or you do not have permission to update it.',
    );
  }

  if (!data) {
    throw new Error('Benefit grant was not found or could not be updated.');
  }

  const usage = await fetchUsageFlags([data.id]);
  return mapBenefitGrantRow(data, usage.has(data.id));
}

// This app has no membership-selection context or singleton anywhere yet
// (confirmed absent during ISSUE-10 / STEP-4). Rather than invent one or
// hard-code the seeded membership's id/name, this resolver asks RLS which
// membership(s) the current user can actually see and fails loudly if that
// isn't exactly one -- the current UI has no membership-switcher to fall
// back on, so silently picking the first result would hide a real
// multi-membership scenario from the caller. `.limit(2)` is enough to tell
// zero / one / more-than-one apart without fetching every accessible row.
export async function getBenefitAdministrationContext(): Promise<BenefitAdministrationContext> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from('memberships')
    .select('id, name')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(2);

  if (membershipsError) {
    throw new Error(membershipsError.message);
  }

  const accessibleMemberships = memberships ?? [];

  if (accessibleMemberships.length === 0) {
    throw new Error(
      'No membership is accessible to your account. Contact a membership administrator.',
    );
  }

  if (accessibleMemberships.length > 1) {
    throw new Error(
      'Multiple memberships are accessible to your account, but the current Palace Elite UI supports only one membership at a time and membership selection has not yet been implemented.',
    );
  }

  const membership = accessibleMemberships[0];
  const grants = await getBenefitCatalog(membership.id);

  return { membership, grants };
}
