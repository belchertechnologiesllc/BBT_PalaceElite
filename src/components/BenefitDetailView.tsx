import type {
  BenefitCostModel,
  BenefitDetailItemRecord,
  BenefitDetailSection,
  BenefitDetailSourceType,
  BenefitDetailView as BenefitDetailViewData,
  BenefitStayPlan,
} from '../services/benefitDetailsService';
import type { BenefitGrantRecord, BenefitPool } from '../services/benefitsService';
import { QUANTITY_KIND_LABELS } from './forms/BenefitGrantForm';
import { formatDate } from '../pages/BenefitsPage';

const POOL_LABELS: Record<BenefitPool, string> = {
  shared: 'Shared',
  golf: 'Golf',
};

const COST_MODEL_LABELS: Record<BenefitCostModel, string> = {
  complimentary: 'Complimentary',
  discounted: 'Discounted',
  credit: 'Credit',
  mixed: 'Mixed',
};

const STAY_PLAN_LABELS: Record<BenefitStayPlan, string> = {
  all_inclusive: 'All-Inclusive',
  european_plan: 'European Plan',
  property_dependent: 'Depends on property',
  not_applicable: 'Not applicable',
};

// Label order here is presentation only -- it never drives sort order.
// benefit_detail_section's Postgres enum declaration order (see
// supabase/migrations/20260731200000_add_benefit_detail_enums.sql) is what
// getBenefitDetail() already sorts by; this component preserves whatever
// order the service returns rather than re-deriving one from this map.
const SECTION_LABELS: Record<BenefitDetailSection, string> = {
  included: 'What is included',
  excluded: 'What is not included',
  eligible_properties: 'Eligible properties',
  season_rules: 'Season and date rules',
  occupancy_rules: 'Occupancy rules',
  fees_and_costs: 'Fees and out-of-pocket costs',
  redemption_steps: 'How to use this benefit',
  confirmation_questions: 'Confirm before use',
  operational_notes: 'Operational notes',
};

const SOURCE_TYPE_LABELS: Record<BenefitDetailSourceType, string> = {
  contract: 'From the contract',
  operational: 'Operational information',
  inference: 'Interpretation',
  confirm_before_use: 'Confirm before use',
};

type AttributeEntry = {
  label: string;
  value: string;
};

function formatNullableBoolean(value: boolean | null): string | null {
  if (value === null) {
    return null;
  }

  return value ? 'Yes' : 'No';
}

function buildAllocationEntries(grant: BenefitGrantRecord): AttributeEntry[] {
  const entries: AttributeEntry[] = [
    { label: 'Pool', value: POOL_LABELS[grant.pool] },
    { label: 'Original quantity', value: String(grant.originalQuantity) },
    { label: 'Quantity kind', value: QUANTITY_KIND_LABELS[grant.quantityKind] },
  ];

  const releaseDate = formatDate(grant.releaseDate);
  if (releaseDate) {
    entries.push({ label: 'Release date', value: releaseDate });
  }

  const expirationDate = formatDate(grant.expirationDate);
  if (expirationDate) {
    entries.push({ label: 'Expiration date', value: expirationDate });
  }

  if (grant.restrictions) {
    entries.push({ label: 'Existing restrictions', value: grant.restrictions });
  }

  return entries;
}

// Only non-null typed attributes are included -- null means "not recorded",
// never rendered as a false-sounding default (see BENEFIT-DETAILS/STEP-5).
function buildTypedAttributeEntries(
  detail: BenefitDetailViewData['detail'],
): AttributeEntry[] {
  const entries: AttributeEntry[] = [];

  if (detail.costModel !== null) {
    entries.push({ label: 'Cost model', value: COST_MODEL_LABELS[detail.costModel] });
  }

  if (detail.stayPlan !== null) {
    entries.push({ label: 'Stay plan', value: STAY_PLAN_LABELS[detail.stayPlan] });
  }

  if (detail.minimumNights !== null) {
    entries.push({ label: 'Minimum nights', value: String(detail.minimumNights) });
  }

  if (detail.maximumNights !== null) {
    entries.push({ label: 'Maximum nights', value: String(detail.maximumNights) });
  }

  if (detail.guestsIncluded !== null) {
    entries.push({ label: 'Guests included', value: String(detail.guestsIncluded) });
  }

  if (detail.discountPercentages !== null && detail.discountPercentages.length > 0) {
    entries.push({
      label: 'Discount percentages',
      value: detail.discountPercentages.map((value) => `${value}%`).join(', '),
    });
  }

  const serviceFeeRequired = formatNullableBoolean(detail.serviceFeeRequired);
  if (serviceFeeRequired !== null) {
    entries.push({ label: 'Service fee required', value: serviceFeeRequired });
  }

  const goldSeasonOnly = formatNullableBoolean(detail.goldSeasonOnly);
  if (goldSeasonOnly !== null) {
    entries.push({ label: 'Gold Season only', value: goldSeasonOnly });
  }

  if (detail.contractQuantityText) {
    entries.push({ label: 'Contract quantity text', value: detail.contractQuantityText });
  }

  if (detail.contractExpirationText) {
    entries.push({ label: 'Contract expiration text', value: detail.contractExpirationText });
  }

  if (detail.contractSourceReference) {
    entries.push({
      label: 'Contract source reference',
      value: detail.contractSourceReference,
    });
  }

  return entries;
}

// Preserves the order items already arrive in (section, then displayOrder,
// then id, as guaranteed by getBenefitDetail()) -- groups adjacent items by
// section without re-sorting sections.
function groupItemsBySection(
  items: BenefitDetailItemRecord[],
): { section: BenefitDetailSection; items: BenefitDetailItemRecord[] }[] {
  const groups: { section: BenefitDetailSection; items: BenefitDetailItemRecord[] }[] = [];

  for (const item of items) {
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.section === item.section) {
      lastGroup.items.push(item);
    } else {
      groups.push({ section: item.section, items: [item] });
    }
  }

  return groups;
}

function AttributeGrid({ entries }: { entries: AttributeEntry[] }) {
  return (
    <dl className="benefit-detail-attribute-grid">
      {entries.map((entry) => (
        <div key={entry.label}>
          <dt>{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type BenefitDetailViewProps = {
  grant: BenefitGrantRecord;
  detailView: BenefitDetailViewData | null;
  isLoading: boolean;
  errorMessage: string | null;
};

// Purely presentational: receives everything through props, performs no
// Supabase/service calls, and never identifies grant by name or
// benefitCode to special-case its rendering -- every fact shown here comes
// from the grant/detailView data passed in.
export function BenefitDetailView({
  grant,
  detailView,
  isLoading,
  errorMessage,
}: BenefitDetailViewProps) {
  const allocationEntries = buildAllocationEntries(grant);

  return (
    <div className="benefit-detail-view">
      <section className="benefit-detail-section">
        <h3>Current allocation</h3>
        <AttributeGrid entries={allocationEntries} />
      </section>

      {isLoading && (
        <p className="benefit-detail-status" role="status">
          Loading structured benefit details...
        </p>
      )}

      {!isLoading && errorMessage && (
        <div className="benefit-detail-status benefit-detail-error" role="alert">
          <p>{errorMessage}</p>
        </div>
      )}

      {!isLoading && !errorMessage && detailView === null && (
        <p className="benefit-detail-empty">
          No structured contract details have been authored for this benefit
          yet.
        </p>
      )}

      {!isLoading && !errorMessage && detailView !== null && (
        <>
          {detailView.detail.plainLanguageSummary && (
            <section className="benefit-detail-section">
              <h3>Summary</h3>
              <p>{detailView.detail.plainLanguageSummary}</p>
            </section>
          )}

          {(() => {
            const typedAttributeEntries = buildTypedAttributeEntries(
              detailView.detail,
            );

            return (
              typedAttributeEntries.length > 0 && (
                <section className="benefit-detail-section">
                  <h3>Typed attributes</h3>
                  <AttributeGrid entries={typedAttributeEntries} />
                </section>
              )
            );
          })()}

          <section className="benefit-detail-section">
            <h3>Detail sections</h3>

            {detailView.items.length === 0 ? (
              <p className="benefit-detail-empty">
                No additional detail sections have been authored.
              </p>
            ) : (
              groupItemsBySection(detailView.items).map((group) => (
                <div key={group.section} className="benefit-detail-item-group">
                  <h4>{SECTION_LABELS[group.section]}</h4>

                  <ul className="benefit-detail-item-list">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <span className="benefit-detail-item-statement">
                          {item.statement}
                        </span>
                        <span
                          className={`source-badge source-badge-${item.sourceType}`}
                        >
                          {SOURCE_TYPE_LABELS[item.sourceType]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
