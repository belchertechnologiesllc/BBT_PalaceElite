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
