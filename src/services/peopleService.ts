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
