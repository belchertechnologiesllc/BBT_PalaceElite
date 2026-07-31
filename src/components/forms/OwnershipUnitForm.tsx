import {
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import type {
  OwnershipUnitRecord,
  UpdateOwnershipUnitInput,
} from '../../services/ownershipUnitsService';

type OwnershipUnitFormProps = {
  formId: string;
  ownershipUnit: OwnershipUnitRecord | null;
  submitting: boolean;
  onSubmit: (formData: UpdateOwnershipUnitInput) => Promise<void> | void;
  onValidityChange: (canSubmit: boolean) => void;
};

// UpdateOwnershipUnitInput.ownership_percentage is a `number`, but a
// controlled text input needs to hold whatever the user has typed so far
// (including transiently invalid values like "" or "33."), so it can't be
// bound directly to that type. Field names otherwise match
// UpdateOwnershipUnitInput exactly (including its snake_case, which differs
// from PersonForm's camelCase input types) so translating between the two
// stays a single, obvious step at submit time.
type OwnershipUnitFormState = {
  name: string;
  members_description: string;
  ownership_percentage: string;
  participates_in_golf_pool: boolean;
};

const initialFormState: OwnershipUnitFormState = {
  name: '',
  members_description: '',
  ownership_percentage: '',
  participates_in_golf_pool: false,
};

const getInitialFormState = (
  ownershipUnit: OwnershipUnitRecord | null,
): OwnershipUnitFormState => {
  if (!ownershipUnit) {
    return initialFormState;
  }

  return {
    name: ownershipUnit.name,
    members_description: ownershipUnit.members_description ?? '',
    ownership_percentage: String(ownershipUnit.ownership_percentage),
    participates_in_golf_pool: ownershipUnit.participates_in_golf_pool,
  };
};

const optionalText = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const memberDisplayName = (member: {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}) => member.preferred_name?.trim() || `${member.first_name} ${member.last_name}`;

export function OwnershipUnitForm({
  formId,
  ownershipUnit,
  submitting,
  onSubmit,
  onValidityChange,
}: OwnershipUnitFormProps) {
  const [form, setForm] = useState<OwnershipUnitFormState>(() =>
    getInitialFormState(ownershipUnit),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Resets on the unit's id rather than the ownershipUnit reference itself,
  // so a background refetch of the same unit (e.g. after an unrelated save
  // elsewhere) doesn't silently overwrite in-progress edits.
  useEffect(() => {
    setForm(getInitialFormState(ownershipUnit));
    setSubmitError(null);
  }, [ownershipUnit?.id]);

  const trimmedName = form.name.trim();
  const parsedPercentage = Number(form.ownership_percentage.trim());
  const isPercentageNumeric =
    form.ownership_percentage.trim().length > 0 &&
    Number.isFinite(parsedPercentage);
  const isPercentageInRange =
    isPercentageNumeric && parsedPercentage > 0 && parsedPercentage <= 100;

  const canSubmit =
    Boolean(ownershipUnit) &&
    trimmedName.length > 0 &&
    isPercentageInRange &&
    !submitting;

  useEffect(() => {
    onValidityChange(canSubmit);
  }, [canSubmit, onValidityChange]);

  function updateField<K extends keyof OwnershipUnitFormState>(
    field: K,
    value: OwnershipUnitFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ownershipUnit || !canSubmit) {
      return;
    }

    setSubmitError(null);

    try {
      const formData: UpdateOwnershipUnitInput = {
        name: trimmedName,
        members_description: optionalText(form.members_description),
        ownership_percentage: parsedPercentage,
        participates_in_golf_pool: form.participates_in_golf_pool,
      };

      await onSubmit(formData);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Unable to save the ownership unit.',
      );
    }
  }

  return (
    <form id={formId} className="person-form" onSubmit={handleSubmit}>
      <label className="form-field">
        <span>Name</span>
        <input
          type="text"
          required
          value={form.name}
          disabled={!ownershipUnit}
          onChange={(event) => updateField('name', event.target.value)}
        />
      </label>

      <label className="form-field">
        <span>Members description</span>
        <input
          type="text"
          value={form.members_description}
          disabled={!ownershipUnit}
          onChange={(event) =>
            updateField('members_description', event.target.value)
          }
        />
        <small>Optional. Free-text description of who this unit represents.</small>
      </label>

      <label className="form-field">
        <span>Ownership percentage</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.0001"
          min="0"
          max="100"
          required
          value={form.ownership_percentage}
          disabled={!ownershipUnit}
          onChange={(event) =>
            updateField('ownership_percentage', event.target.value)
          }
        />
        <small>Must be greater than 0 and no greater than 100.</small>
      </label>

      <fieldset className="form-fieldset">
        <legend>Benefit-pool eligibility</legend>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.participates_in_golf_pool}
            disabled={!ownershipUnit}
            onChange={(event) =>
              updateField('participates_in_golf_pool', event.target.checked)
            }
          />
          <span>
            <strong>Golf pool participation</strong>
            <small>
              Golf-pool participation should only be enabled for ownership
              units eligible under Palace Elite rules.
            </small>
          </span>
        </label>

        <p className="form-message">
          <small>
            Shared-pool participation is not configured at the
            ownership-unit level.
          </small>
        </p>
      </fieldset>

      {ownershipUnit && (
        <div className="form-message">
          <p className="eyebrow">Assigned active members</p>

          {ownershipUnit.assigned_active_members.length === 0 ? (
            <span>No active members are currently assigned to this unit.</span>
          ) : (
            <ul>
              {ownershipUnit.assigned_active_members.map((member) => (
                <li key={member.id}>
                  {memberDisplayName(member)} ({member.person_role})
                </li>
              ))}
            </ul>
          )}

          <small>
            Membership: {ownershipUnit.membership_id}
          </small>

          {ownershipUnit.archived_at && (
            <small>Archived at {ownershipUnit.archived_at}.</small>
          )}
        </div>
      )}

      {submitError && (
        <div className="form-message error-state" role="alert">
          <strong>Unable to save ownership unit</strong>
          <span>{submitError}</span>
        </div>
      )}
    </form>
  );
}
