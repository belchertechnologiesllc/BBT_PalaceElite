import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getBenefitTransactionContext } from './transactionsService';

export type Reservation = {
  id?: string;
  membership_id: string;
  ownership_unit_id: string;
  resort: string;
  check_in: string;
  check_out: string;
  room_type: string | null;
  confirmation_number: string | null;
  adults: number;
  minors: number;
  rate_type: string | null;
  total_cost: number | null;
  amount_per_room: number | null;
  notes: string | null;
  benefit_grant_id: string | null;
  benefit_quantity: number | null;
  status: 'tentative' | 'confirmed' | 'completed' | 'cancelled';
};

export type TripRoom = {
  party: string;
  unit: string;
  adults: number;
  minors: number;
  price: number;
  adultCharge: number;
  minorCharge: number;
  credits: number;
  paid: number;
};

export type TripPlan = {
  resort: string;
  check_in: string;
  check_out: string;
  rate: string;
  benefit: string;
  quantity: number;
  rooms: TripRoom[];
};

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase as unknown as SupabaseClient;
}

export async function getReservations(membershipId: string) {
  const { data, error } = await client().from('reservations').select('*')
    .eq('membership_id', membershipId).order('check_in');
  if (error) throw new Error(error.message);
  return data as Reservation[];
}

export async function getTravelContext() {
  const context = await getBenefitTransactionContext();
  const reservations = await getReservations(context.membership.id);
  return { ...context, reservations };
}

export async function saveReservation(reservation: Reservation) {
  const { error } = await client().rpc('save_reservation', { p_data: reservation });
  if (error) throw new Error(error.message);
}

export async function getTripPlan(membershipId: string) {
  const { data, error } = await client().from('trip_plans').select('plan')
    .eq('membership_id', membershipId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.plan as TripPlan | undefined;
}

export async function saveTripPlan(membershipId: string, plan: TripPlan) {
  const { error } = await client().from('trip_plans').upsert({ membership_id: membershipId, plan });
  if (error) throw new Error(error.message);
}

export async function reseedContract(membershipId: string, confirmation: string) {
  const { error } = await client().rpc('reseed_membership_contract', {
    p_membership: membershipId, p_confirmation: confirmation,
  });
  if (error) throw new Error(error.message);
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nights = (from: string, to: string) => Math.max(0,
  (Date.parse(to) - Date.parse(from)) / 86_400_000 || 0);
export const dollars = (amount: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(amount);

export function includesGoldSeasonBlackout(from: string, to: string) {
  if (!nights(from, to)) return false;
  const year = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  for (let y = year - 1; y <= endYear; y++) {
    if (from < `${y + 1}-01-02` && to > `${y}-12-24`) return true;
  }
  return false;
}

export function roomBalance(room: TripRoom) {
  const cents = (value: number) => Math.round(value * 100);
  const gross = cents(room.price) + room.adults * cents(room.adultCharge)
    + room.minors * cents(room.minorCharge);
  const total = Math.max(0, gross - cents(room.credits));
  return { total, paid: cents(room.paid), balance: total - cents(room.paid) };
}

export async function getVerificationFlags(grantIds: string[]) {
  const { data, error } = await client().from('benefit_grant_details')
    .select('benefit_grant_id,verification_pending').in('benefit_grant_id', grantIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map(row => [row.benefit_grant_id as string, row.verification_pending as boolean]));
}

export async function setVerificationFlag(grantId: string, pending: boolean) {
  const { error } = await client().from('benefit_grant_details')
    .upsert({ benefit_grant_id: grantId, verification_pending: pending }, { onConflict: 'benefit_grant_id' })
    .select('benefit_grant_id').single();
  if (error) throw new Error(error.message);
}
