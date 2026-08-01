import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

export type BenefitCostModel = Database['public']['Enums']['benefit_cost_model'];
export type BenefitStayPlan = Database['public']['Enums']['benefit_stay_plan'];
export type BenefitDetailSourceType =
  Database['public']['Enums']['benefit_detail_source_type'];
export type BenefitDetailSection =
  Database['public']['Enums']['benefit_detail_section'];

export type BenefitGrantDetailRecord = {
  id: string;
  benefitGrantId: string;
  plainLanguageSummary: string | null;
  costModel: BenefitCostModel | null;
  stayPlan: BenefitStayPlan | null;
  minimumNights: number | null;
  maximumNights: number | null;
  guestsIncluded: number | null;
  discountPercentages: number[] | null;
  serviceFeeRequired: boolean | null;
  goldSeasonOnly: boolean | null;
  contractQuantityText: string | null;
  contractExpirationText: string | null;
  contractSourceReference: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BenefitDetailItemRecord = {
  id: string;
  benefitGrantId: string;
  section: BenefitDetailSection;
  statement: string;
  sourceType: BenefitDetailSourceType;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BenefitDetailView = {
  detail: BenefitGrantDetailRecord;
  items: BenefitDetailItemRecord[];
};

// -----------------------------------------------------------------------
// Internal helpers (not exported -- the UI has no need for these directly)
// -----------------------------------------------------------------------

type BenefitGrantDetailRow =
  Database['public']['Tables']['benefit_grant_details']['Row'];
type BenefitDetailItemRow =
  Database['public']['Tables']['benefit_detail_items']['Row'];

const BENEFIT_GRANT_DETAIL_COLUMNS = `
  id,
  benefit_grant_id,
  plain_language_summary,
  cost_model,
  stay_plan,
  minimum_nights,
  maximum_nights,
  guests_included,
  discount_percentages,
  service_fee_required,
  gold_season_only,
  contract_quantity_text,
  contract_expiration_text,
  contract_source_reference,
  created_at,
  updated_at
`;

const BENEFIT_DETAIL_ITEM_COLUMNS = `
  id,
  benefit_grant_id,
  section,
  statement,
  source_type,
  display_order,
  created_at,
  updated_at
`;

function mapBenefitGrantDetailRow(
  row: BenefitGrantDetailRow,
): BenefitGrantDetailRecord {
  return {
    id: row.id,
    benefitGrantId: row.benefit_grant_id,
    plainLanguageSummary: row.plain_language_summary,
    costModel: row.cost_model,
    stayPlan: row.stay_plan,
    minimumNights: row.minimum_nights,
    maximumNights: row.maximum_nights,
    guestsIncluded: row.guests_included,
    discountPercentages: row.discount_percentages,
    serviceFeeRequired: row.service_fee_required,
    goldSeasonOnly: row.gold_season_only,
    contractQuantityText: row.contract_quantity_text,
    contractExpirationText: row.contract_expiration_text,
    contractSourceReference: row.contract_source_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBenefitDetailItemRow(
  row: BenefitDetailItemRow,
): BenefitDetailItemRecord {
  return {
    id: row.id,
    benefitGrantId: row.benefit_grant_id,
    section: row.section,
    statement: row.statement,
    sourceType: row.source_type,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Mirrors benefit_detail_section's Postgres enum declaration order (see
// supabase/migrations/20260731200000_add_benefit_detail_enums.sql). That
// declaration order is what makes a plain `order by section` in SQL yield
// the intended reading order; PostgREST does not expose enum ordinal
// ordering to a `.order('section')` call over the REST API (it would sort
// the text representation alphabetically instead), so this explicit map is
// the "one section-order map" fallback described by this service's
// requirements, applied client-side after fetching all items unordered by
// section and re-sorting with displayOrder/id as tie-breakers.
const SECTION_ORDER: Record<BenefitDetailSection, number> = {
  included: 0,
  excluded: 1,
  eligible_properties: 2,
  season_rules: 3,
  occupancy_rules: 4,
  fees_and_costs: 5,
  redemption_steps: 6,
  confirmation_questions: 7,
  operational_notes: 8,
};

function compareItems(
  a: BenefitDetailItemRecord,
  b: BenefitDetailItemRecord,
): number {
  const sectionDelta = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
  if (sectionDelta !== 0) {
    return sectionDelta;
  }

  const displayOrderDelta = a.displayOrder - b.displayOrder;
  if (displayOrderDelta !== 0) {
    return displayOrderDelta;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// -----------------------------------------------------------------------
// Public service methods
// -----------------------------------------------------------------------

// Read-only. Two queries for one selected benefit: one for its (optional)
// structured summary row, one for its ordered items. Both are scoped to the
// exact benefitGrantId, so this never becomes an N+1 pattern regardless of
// how many benefits the caller loops over.
export async function getBenefitDetail(
  benefitGrantId: string,
): Promise<BenefitDetailView | null> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (!benefitGrantId || benefitGrantId.trim().length === 0) {
    throw new Error('benefitGrantId is required.');
  }

  const { data: detailRow, error: detailError } = await supabase
    .from('benefit_grant_details')
    .select(BENEFIT_GRANT_DETAIL_COLUMNS)
    .eq('benefit_grant_id', benefitGrantId)
    .maybeSingle();

  if (detailError) {
    throw new Error(detailError.message);
  }

  if (!detailRow) {
    return null;
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('benefit_detail_items')
    .select(BENEFIT_DETAIL_ITEM_COLUMNS)
    .eq('benefit_grant_id', benefitGrantId)
    .order('display_order', { ascending: true })
    .order('id', { ascending: true });

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  const items = (itemRows ?? [])
    .map(mapBenefitDetailItemRow)
    .sort(compareItems);

  return {
    detail: mapBenefitGrantDetailRow(detailRow),
    items,
  };
}
