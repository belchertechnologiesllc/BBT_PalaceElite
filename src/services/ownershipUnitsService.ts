import { supabase } from '../lib/supabase';

export type OwnershipUnitOption = {
  id: string;
  membership_id: string;
  name: string;
  members_description: string | null;
  ownership_percentage: number;
  participates_in_golf_pool: boolean;
};

export async function getActiveOwnershipUnits(): Promise<
  OwnershipUnitOption[]
> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('ownership_units')
    .select(`
      id,
      membership_id,
      name,
      members_description,
      ownership_percentage,
      participates_in_golf_pool
    `)
    .is('archived_at', null)
    .order('name');

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

// -----------------------------------------------------------------------
// Ownership Administration (admin-facing read/update)
// -----------------------------------------------------------------------

export type OwnershipUnitMember = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  person_role: string;
};

export type OwnershipUnitRecord = {
  id: string;
  membership_id: string;
  name: string;
  members_description: string | null;
  ownership_percentage: number;
  participates_in_golf_pool: boolean;
  archived_at: string | null;
  created_at: string;
  assigned_active_members: OwnershipUnitMember[];
};

// Only the columns an administrator is allowed to change. id, membership_id,
// created_at, and archived_at are intentionally absent so the type system
// rejects attempts to send them.
export type UpdateOwnershipUnitInput = {
  name: string;
  members_description: string | null;
  ownership_percentage: number;
  participates_in_golf_pool: boolean;
};

export type UpdatedOwnershipUnit = Omit<
  OwnershipUnitRecord,
  'assigned_active_members'
>;

export type UpdateOwnershipUnitResult = {
  ownershipUnit: UpdatedOwnershipUnit;
  membershipOwnershipPercentageTotal: number;
  ownershipPercentageWarning: string | null;
};

const normalizeNullableText = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function getOwnershipUnits(): Promise<OwnershipUnitRecord[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('ownership_units')
    .select(`
      id,
      membership_id,
      name,
      members_description,
      ownership_percentage,
      participates_in_golf_pool,
      archived_at,
      created_at,
      assigned_active_members:people!people_ownership_unit_id_fkey (
        id,
        first_name,
        last_name,
        preferred_name,
        person_role
      )
    `)
    .is('archived_at', null)
    .eq('assigned_active_members.is_active', true)
    .order('name')
    .order('last_name', { referencedTable: 'assigned_active_members' })
    .order('first_name', { referencedTable: 'assigned_active_members' });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function updateOwnershipUnit(
  id: string,
  input: UpdateOwnershipUnitInput,
): Promise<UpdateOwnershipUnitResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const trimmedName = input.name.trim();

  if (trimmedName.length === 0) {
    throw new Error('Ownership unit name is required.');
  }

  if (
    !Number.isFinite(input.ownership_percentage) ||
    input.ownership_percentage <= 0 ||
    input.ownership_percentage > 100
  ) {
    throw new Error(
      'Ownership percentage must be greater than 0 and no greater than 100.',
    );
  }

  const { data: updatedUnit, error: updateError } = await supabase
    .from('ownership_units')
    .update({
      name: trimmedName,
      members_description: normalizeNullableText(
        input.members_description,
      ),
      ownership_percentage: input.ownership_percentage,
      participates_in_golf_pool: input.participates_in_golf_pool,
    })
    .eq('id', id)
    .is('archived_at', null)
    .select(`
      id,
      membership_id,
      name,
      members_description,
      ownership_percentage,
      participates_in_golf_pool,
      archived_at,
      created_at
    `)
    .single();

  if (updateError) {
    throw new Error(
      updateError.code === 'PGRST116'
        ? 'Ownership unit was not found, is archived, or you do not have permission to update it.'
        : updateError.message,
    );
  }

  if (!updatedUnit) {
    throw new Error('Ownership unit was not found or could not be updated.');
  }

  const { data: membershipUnits, error: totalsError } = await supabase
    .from('ownership_units')
    .select('ownership_percentage')
    .eq('membership_id', updatedUnit.membership_id)
    .is('archived_at', null);

  if (totalsError) {
    throw new Error(totalsError.message);
  }

  const rawTotal = (membershipUnits ?? []).reduce(
    (total, unit) => total + unit.ownership_percentage,
    0,
  );

  // Round to the same 4-decimal precision as the numeric(7,4) column so
  // binary floating-point summation error doesn't produce a false warning.
  const membershipOwnershipPercentageTotal =
    Math.round(rawTotal * 10000) / 10000;

  const ownershipPercentageWarning =
    membershipOwnershipPercentageTotal === 100
      ? null
      : `Ownership percentages for this membership total ${membershipOwnershipPercentageTotal}%, not 100%.`;

  return {
    ownershipUnit: updatedUnit,
    membershipOwnershipPercentageTotal,
    ownershipPercentageWarning,
  };
}
