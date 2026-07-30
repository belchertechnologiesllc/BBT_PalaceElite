import { supabase } from '../lib/supabase';

export type OwnershipUnitRecord = {
  id: string;
  name: string;
  participates_in_golf_pool: boolean;
};

export type PersonRecord = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  relationship_to_primary: string | null;
  person_role: string;
  profile_id: string | null;
  participates_in_shared_pool: boolean;
  participates_in_golf_pool: boolean;
  ownership_unit_id: string;
  ownership_unit: OwnershipUnitRecord;
};

export async function getActivePeople(): Promise<PersonRecord[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('people')
    .select(`
      id,
      first_name,
      last_name,
      preferred_name,
      relationship_to_primary,
      person_role,
      profile_id,
      participates_in_shared_pool,
      participates_in_golf_pool,
      ownership_unit_id,
      ownership_unit:ownership_units!people_ownership_unit_id_fkey (
        id,
        name,
        participates_in_golf_pool
      )
    `)
    .is('archived_at', null)
    .order('last_name')
    .order('first_name');

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export type CreatePersonInput = {
  firstName: string;
  lastName: string;
  preferredName: string | null;
  relationshipToPrimary: string | null;
  personRole: string;
  membershipId: string;
  ownershipUnitId: string;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
  isActive: boolean;
};

export type UpdatePersonInput = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  relationshipToPrimary: string | null;
  personRole: string;
  ownershipUnitId: string;
  membershipId: string;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
  isActive: boolean;
};

export async function createPerson(
  input: CreatePersonInput,
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase
    .from('people')
    .insert({
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      preferred_name: input.preferredName,
      relationship_to_primary: input.relationshipToPrimary,
      person_role: input.personRole,
      membership_id: input.membershipId,
      ownership_unit_id: input.ownershipUnitId,
      participates_in_shared_pool: input.participatesInSharedPool,
      participates_in_golf_pool: input.participatesInGolfPool,
      is_active: input.isActive,
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updatePerson(
  input: UpdatePersonInput,
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase
    .from('people')
    .update({
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      preferred_name: input.preferredName,
      relationship_to_primary: input.relationshipToPrimary,
      person_role: input.personRole,
      membership_id: input.membershipId,
      ownership_unit_id: input.ownershipUnitId,
      participates_in_shared_pool: input.participatesInSharedPool,
      participates_in_golf_pool: input.participatesInGolfPool,
      is_active: input.isActive,
    })
    .eq('id', input.id);

  if (error) {
    throw new Error(error.message);
  }
}
