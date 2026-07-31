import { useEffect, useState, type FormEvent } from 'react';
import {
  Constants,
  type Database,
} from '../../lib/database.types';
import {
  type BenefitGrantRecord,
  type CreateBenefitGrantInput,
  type UpdateBenefitGrantAccountingInput,
  type UpdateBenefitGrantMetadataInput,
} from '../../services/benefitsService';

type BenefitPool = Database['public']['Enums']['benefit_pool'];
type QuantityKind = Database['public']['Enums']['quantity_kind'];

const POOL_OPTIONS = Constants.public.Enums.benefit_pool;
const QUANTITY_KIND_OPTIONS = Constants.public.Enums.quantity_kind;

const POOL_LABELS: Record<BenefitPool, string> = {
  shared: 'Shared',
  golf: 'Golf',
};

export const QUANTITY_KIND_LABELS: Record<QuantityKind, string> = {
  currency: 'Currency',
  count: 'Count',
  nights: 'Nights',
  weeks: 'Weeks',
  rounds: 'Rounds',
};

const optionalText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Dates come from <input type="date"> as either '' or 'YYYY-MM-DD'; string
// comparison is safe for ordering both here and in the service layer.
const optionalDate = (value: string): string | null =>
  value.length > 0 ? value : null;

function validateDateOrder(
  releaseDate: string | null,
  expirationDate: string | null,
): string | null {
  if (releaseDate && expirationDate && expirationDate < releaseDate) {
    return 'Expiration date cannot be before release date.';
  }

  return null;
}

// -----------------------------------------------------------------------
// Create mode
// -----------------------------------------------------------------------

type CreateFormState = {
  name: string;
  pool: BenefitPool | '';
  quantityKind: QuantityKind | '';
  originalQuantity: string;
  releaseDate: string;
  expirationDate: string;
  restrictions: string;
};

const initialCreateFormState: CreateFormState = {
  name: '',
  pool: '',
  quantityKind: '',
  originalQuantity: '',
  releaseDate: '',
  expirationDate: '',
  restrictions: '',
};

type CreateBenefitGrantFormProps = {
  mode: 'create';
  formId: string;
  open: boolean;
  membershipId: string;
  onSubmit: (input: CreateBenefitGrantInput) => Promise<void>;
  onFormStateChange: (state: {
    canSubmit: boolean;
    submitting: boolean;
  }) => void;
};

function CreateBenefitGrantFields({
  formId,
  open,
  membershipId,
  onSubmit,
  onFormStateChange,
}: CreateBenefitGrantFormProps) {
  const [form, setForm] = useState<CreateFormState>(initialCreateFormState);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialCreateFormState);
      setSubmitError(null);
    }
  }, [open]);

  const parsedQuantity = Number(form.originalQuantity);
  const dateOrderError = validateDateOrder(
    optionalDate(form.releaseDate),
    optionalDate(form.expirationDate),
  );

  const canSubmit =
    form.name.trim().length > 0 &&
    form.pool !== '' &&
    form.quantityKind !== '' &&
    form.originalQuantity.trim().length > 0 &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity >= 0 &&
    dateOrderError === null &&
    !submitting;

  useEffect(() => {
    onFormStateChange({ canSubmit, submitting });
  }, [canSubmit, submitting, onFormStateChange]);

  function updateField<K extends keyof CreateFormState>(
    field: K,
    value: CreateFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || form.pool === '' || form.quantityKind === '') {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        membershipId,
        name: form.name,
        pool: form.pool,
        quantityKind: form.quantityKind,
        originalQuantity: parsedQuantity,
        releaseDate: optionalDate(form.releaseDate),
        expirationDate: optionalDate(form.expirationDate),
        restrictions: optionalText(form.restrictions),
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Unable to save the benefit.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form id={formId} className="benefit-grant-form" onSubmit={handleSubmit}>
      <label className="form-field">
        <span>Name</span>
        <input
          type="text"
          required
          value={form.name}
          onChange={(event) => updateField('name', event.target.value)}
        />
      </label>

      <div className="form-grid two-column">
        <label className="form-field">
          <span>Pool</span>
          <select
            required
            value={form.pool}
            onChange={(event) =>
              updateField('pool', event.target.value as BenefitPool)
            }
          >
            <option value="" disabled>
              Select a pool
            </option>
            {POOL_OPTIONS.map((pool) => (
              <option key={pool} value={pool}>
                {POOL_LABELS[pool]}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Quantity unit</span>
          <select
            required
            value={form.quantityKind}
            onChange={(event) =>
              updateField(
                'quantityKind',
                event.target.value as QuantityKind,
              )
            }
          >
            <option value="" disabled>
              Select a unit
            </option>
            {QUANTITY_KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {QUANTITY_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="form-field">
        <span>Original quantity</span>
        <input
          type="number"
          min="0"
          step="any"
          required
          value={form.originalQuantity}
          onChange={(event) =>
            updateField('originalQuantity', event.target.value)
          }
        />
        <small>Zero is a valid quantity.</small>
      </label>

      <div className="form-grid two-column">
        <label className="form-field">
          <span>Release date</span>
          <input
            type="date"
            value={form.releaseDate}
            onChange={(event) =>
              updateField('releaseDate', event.target.value)
            }
          />
          <small>Optional</small>
        </label>

        <label className="form-field">
          <span>Expiration date</span>
          <input
            type="date"
            value={form.expirationDate}
            onChange={(event) =>
              updateField('expirationDate', event.target.value)
            }
          />
          <small>Optional</small>
        </label>
      </div>

      {dateOrderError && (
        <div className="form-message error-state" role="alert">
          <span>{dateOrderError}</span>
        </div>
      )}

      <label className="form-field">
        <span>Restrictions</span>
        <textarea
          rows={3}
          value={form.restrictions}
          onChange={(event) =>
            updateField('restrictions', event.target.value)
          }
        />
        <small>Optional</small>
      </label>

      {submitError && (
        <div className="form-message error-state" role="alert">
          <strong>Unable to save benefit</strong>
          <span>{submitError}</span>
        </div>
      )}
    </form>
  );
}

// -----------------------------------------------------------------------
// Edit mode -- two independent sections/actions, per the service's own
// metadata/accounting split. Never combined into one save so a partial
// failure can't leave one half applied and the other silently dropped.
// -----------------------------------------------------------------------

type DetailsFormState = {
  name: string;
  restrictions: string;
};

type AllocationFormState = {
  pool: BenefitPool;
  quantityKind: QuantityKind;
  originalQuantity: string;
  releaseDate: string;
  expirationDate: string;
};

const detailsStateFromGrant = (grant: BenefitGrantRecord): DetailsFormState => ({
  name: grant.name,
  restrictions: grant.restrictions ?? '',
});

const allocationStateFromGrant = (
  grant: BenefitGrantRecord,
): AllocationFormState => ({
  pool: grant.pool,
  quantityKind: grant.quantityKind,
  originalQuantity: String(grant.originalQuantity),
  releaseDate: grant.releaseDate ?? '',
  expirationDate: grant.expirationDate ?? '',
});

type EditBenefitGrantFormProps = {
  mode: 'edit';
  open: boolean;
  grant: BenefitGrantRecord;
  onSaveDetails: (input: UpdateBenefitGrantMetadataInput) => Promise<void>;
  onSaveAllocation: (
    input: UpdateBenefitGrantAccountingInput,
  ) => Promise<void>;
};

function EditBenefitGrantFields({
  open,
  grant,
  onSaveDetails,
  onSaveAllocation,
}: EditBenefitGrantFormProps) {
  const [detailsForm, setDetailsForm] = useState<DetailsFormState>(() =>
    detailsStateFromGrant(grant),
  );
  const [detailsSubmitting, setDetailsSubmitting] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [allocationForm, setAllocationForm] = useState<AllocationFormState>(
    () => allocationStateFromGrant(grant),
  );
  const [allocationSubmitting, setAllocationSubmitting] = useState(false);
  const [allocationError, setAllocationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (open) {
      setDetailsForm(detailsStateFromGrant(grant));
      setDetailsError(null);
      setAllocationForm(allocationStateFromGrant(grant));
      setAllocationError(null);
    }
    // Deliberately keyed on grant.id, not the grant object itself: the page
    // passes back a freshly-updated record after each successful partial
    // save (see BenefitsPage's handleSaveDetails/handleSaveAllocation), and
    // re-running this effect on every such update would wipe out
    // in-progress edits in the *other*, not-yet-saved section.
  }, [open, grant.id]);

  const parsedAllocationQuantity = Number(allocationForm.originalQuantity);
  const allocationDateOrderError = validateDateOrder(
    optionalDate(allocationForm.releaseDate),
    optionalDate(allocationForm.expirationDate),
  );

  const detailsCanSubmit =
    detailsForm.name.trim().length > 0 && !detailsSubmitting;

  const allocationCanSubmit =
    !grant.hasRecordedUsage &&
    allocationForm.originalQuantity.trim().length > 0 &&
    Number.isFinite(parsedAllocationQuantity) &&
    parsedAllocationQuantity >= 0 &&
    allocationDateOrderError === null &&
    !allocationSubmitting;

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!detailsCanSubmit) {
      return;
    }

    setDetailsSubmitting(true);
    setDetailsError(null);

    try {
      await onSaveDetails({
        id: grant.id,
        name: detailsForm.name,
        restrictions: optionalText(detailsForm.restrictions),
      });
    } catch (error) {
      setDetailsError(
        error instanceof Error
          ? error.message
          : 'Unable to save benefit details.',
      );
    } finally {
      setDetailsSubmitting(false);
    }
  }

  async function handleAllocationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!allocationCanSubmit) {
      return;
    }

    setAllocationSubmitting(true);
    setAllocationError(null);

    try {
      await onSaveAllocation({
        id: grant.id,
        pool: allocationForm.pool,
        quantityKind: allocationForm.quantityKind,
        originalQuantity: parsedAllocationQuantity,
        releaseDate: optionalDate(allocationForm.releaseDate),
        expirationDate: optionalDate(allocationForm.expirationDate),
      });
    } catch (error) {
      // If the page's view of hasRecordedUsage was stale (a transaction was
      // recorded elsewhere after this SlideOver opened), the
      // enforce_benefit_grant_immutability_trg trigger rejects this update
      // and its exact message is surfaced here, not swallowed or
      // reinterpreted.
      setAllocationError(
        error instanceof Error
          ? error.message
          : 'Unable to save allocation.',
      );
    } finally {
      setAllocationSubmitting(false);
    }
  }

  return (
    <div className="benefit-grant-edit">
      <form
        className="benefit-grant-form"
        onSubmit={(event) => void handleDetailsSubmit(event)}
      >
        <h3>Benefit details</h3>

        <label className="form-field">
          <span>Name</span>
          <input
            type="text"
            required
            value={detailsForm.name}
            onChange={(event) =>
              setDetailsForm((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
        </label>

        <label className="form-field">
          <span>Restrictions</span>
          <textarea
            rows={3}
            value={detailsForm.restrictions}
            onChange={(event) =>
              setDetailsForm((current) => ({
                ...current,
                restrictions: event.target.value,
              }))
            }
          />
          <small>Optional</small>
        </label>

        {detailsError && (
          <div className="form-message error-state" role="alert">
            <strong>Unable to save benefit details</strong>
            <span>{detailsError}</span>
          </div>
        )}

        <button
          type="submit"
          className="primary-button button-block"
          disabled={!detailsCanSubmit}
        >
          {detailsSubmitting ? 'Saving...' : 'Save details'}
        </button>
      </form>

      <form
        className="benefit-grant-form"
        onSubmit={(event) => void handleAllocationSubmit(event)}
      >
        <h3>Allocation and accounting</h3>

        {grant.hasRecordedUsage && (
          <div className="form-message locked-state" role="status">
            <strong>Accounting fields are locked</strong>
            <span>
              This benefit has recorded transaction activity, so its pool,
              quantity unit, original quantity, release date, and
              expiration date can no longer be changed. Name and
              restrictions remain editable.
            </span>
          </div>
        )}

        <div className="form-grid two-column">
          <label className="form-field">
            <span>Pool</span>
            <select
              required
              disabled={grant.hasRecordedUsage}
              value={allocationForm.pool}
              onChange={(event) =>
                setAllocationForm((current) => ({
                  ...current,
                  pool: event.target.value as BenefitPool,
                }))
              }
            >
              {POOL_OPTIONS.map((pool) => (
                <option key={pool} value={pool}>
                  {POOL_LABELS[pool]}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Quantity unit</span>
            <select
              required
              disabled={grant.hasRecordedUsage}
              value={allocationForm.quantityKind}
              onChange={(event) =>
                setAllocationForm((current) => ({
                  ...current,
                  quantityKind: event.target.value as QuantityKind,
                }))
              }
            >
              {QUANTITY_KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {QUANTITY_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="form-field">
          <span>Original quantity</span>
          <input
            type="number"
            min="0"
            step="any"
            required
            disabled={grant.hasRecordedUsage}
            value={allocationForm.originalQuantity}
            onChange={(event) =>
              setAllocationForm((current) => ({
                ...current,
                originalQuantity: event.target.value,
              }))
            }
          />
          <small>Zero is a valid quantity.</small>
        </label>

        <div className="form-grid two-column">
          <label className="form-field">
            <span>Release date</span>
            <input
              type="date"
              disabled={grant.hasRecordedUsage}
              value={allocationForm.releaseDate}
              onChange={(event) =>
                setAllocationForm((current) => ({
                  ...current,
                  releaseDate: event.target.value,
                }))
              }
            />
            <small>Optional</small>
          </label>

          <label className="form-field">
            <span>Expiration date</span>
            <input
              type="date"
              disabled={grant.hasRecordedUsage}
              value={allocationForm.expirationDate}
              onChange={(event) =>
                setAllocationForm((current) => ({
                  ...current,
                  expirationDate: event.target.value,
                }))
              }
            />
            <small>Optional</small>
          </label>
        </div>

        {!grant.hasRecordedUsage && allocationDateOrderError && (
          <div className="form-message error-state" role="alert">
            <span>{allocationDateOrderError}</span>
          </div>
        )}

        {allocationError && (
          <div className="form-message error-state" role="alert">
            <strong>Unable to save allocation</strong>
            <span>{allocationError}</span>
          </div>
        )}

        {!grant.hasRecordedUsage && (
          <button
            type="submit"
            className="primary-button button-block"
            disabled={!allocationCanSubmit}
          >
            {allocationSubmitting ? 'Saving...' : 'Save allocation'}
          </button>
        )}
      </form>
    </div>
  );
}

// -----------------------------------------------------------------------
// Public component
// -----------------------------------------------------------------------

export type BenefitGrantFormProps =
  | CreateBenefitGrantFormProps
  | EditBenefitGrantFormProps;

export function BenefitGrantForm(props: BenefitGrantFormProps) {
  if (props.mode === 'create') {
    return <CreateBenefitGrantFields {...props} />;
  }

  return <EditBenefitGrantFields {...props} />;
}
