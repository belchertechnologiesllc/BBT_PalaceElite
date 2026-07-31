import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  type CreatePersonInput,
  type PersonRecord,
} from '../../services/peopleService';
import {
  getActiveOwnershipUnits,
  type OwnershipUnitOption,
} from '../../services/ownershipUnitsService';

type PersonFormProps = {
  formId: string;
  open: boolean;
  mode: 'create' | 'edit';
  person?: PersonRecord | null;
  onSubmit: (formData: CreatePersonInput) => Promise<void> | void;
  onFormStateChange: (state: {
    canSubmit: boolean;
    submitting: boolean;
  }) => void;
};

type PersonFormState = {
  firstName: string;
  lastName: string;
  preferredName: string;
  ownershipUnitId: string;
  relationshipToPrimary: string;
  personRole: string;
  participatesInSharedPool: boolean;
  participatesInGolfPool: boolean;
  isActive: boolean;
};

const initialFormState: PersonFormState = {
  firstName: '',
  lastName: '',
  preferredName: '',
  ownershipUnitId: '',
  relationshipToPrimary: '',
  personRole: 'family_member',
  participatesInSharedPool: true,
  participatesInGolfPool: false,
  isActive: true,
};

const getInitialFormState = (
  mode: 'create' | 'edit',
  person?: PersonRecord | null,
): PersonFormState => {
  if (mode === 'edit' && person) {
    return {
      firstName: person.first_name,
      lastName: person.last_name,
      preferredName: person.preferred_name ?? '',
      ownershipUnitId: person.ownership_unit_id,
      relationshipToPrimary:
        person.relationship_to_primary ?? '',
      personRole: person.person_role,
      participatesInSharedPool:
        person.participates_in_shared_pool,
      participatesInGolfPool:
        person.participates_in_golf_pool,
      isActive: person.is_active,
    };
  }

  return initialFormState;
};

const optionalText = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function PersonForm({
  formId,
  open,
  mode,
  person,
  onSubmit,
  onFormStateChange,
}: PersonFormProps) {
  const [form, setForm] = useState<PersonFormState>(() =>
    getInitialFormState(mode, person),
  );
  const [ownershipUnits, setOwnershipUnits] = useState<
    OwnershipUnitOption[]
  >([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedUnit = useMemo(
    () =>
      ownershipUnits.find(
        (unit) => unit.id === form.ownershipUnitId,
      ) ?? null,
    [form.ownershipUnitId, ownershipUnits],
  );

  const canSubmit =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    Boolean(selectedUnit) &&
    !loadingUnits &&
    !submitting;

  useEffect(() => {
    onFormStateChange({
      canSubmit,
      submitting,
    });
  }, [canSubmit, submitting, onFormStateChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadOwnershipUnits() {
      setLoadingUnits(true);
      setUnitError(null);

      try {
        const records = await getActiveOwnershipUnits();

        if (!cancelled) {
          setOwnershipUnits(records);
        }
      } catch (error) {
        if (!cancelled) {
          setOwnershipUnits([]);
          setUnitError(
            error instanceof Error
              ? error.message
              : 'Unable to load ownership units.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingUnits(false);
        }
      }
    }

    void loadOwnershipUnits();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setForm(getInitialFormState(mode, person));
      setSubmitError(null);
    }
  }, [open, mode, person]);

  function updateField<K extends keyof PersonFormState>(
    field: K,
    value: PersonFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleOwnershipUnitChange(ownershipUnitId: string) {
    const unit =
      ownershipUnits.find(
        (record) => record.id === ownershipUnitId,
      ) ?? null;

    setForm((current) => ({
      ...current,
      ownershipUnitId,
      participatesInGolfPool:
        unit?.participates_in_golf_pool === true
          ? current.participatesInGolfPool
          : false,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedUnit || !canSubmit) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const formData: CreatePersonInput = {
        firstName: form.firstName,
        lastName: form.lastName,
        preferredName: optionalText(form.preferredName),
        relationshipToPrimary: optionalText(
          form.relationshipToPrimary,
        ),
        personRole: form.personRole,
        membershipId: selectedUnit.membership_id,
        ownershipUnitId: selectedUnit.id,
        participatesInSharedPool:
          form.participatesInSharedPool,
        participatesInGolfPool:
          selectedUnit.participates_in_golf_pool &&
          form.participatesInGolfPool,
        isActive: form.isActive,
      };

      await onSubmit(formData);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Unable to save the person.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      id={formId}
      className="person-form"
      onSubmit={handleSubmit}
    >
      <div className="form-grid two-column">
        <label className="form-field">
          <span>First name</span>
          <input
            type="text"
            autoComplete="given-name"
            required
            value={form.firstName}
            onChange={(event) =>
              updateField('firstName', event.target.value)
            }
          />
        </label>

        <label className="form-field">
          <span>Last name</span>
          <input
            type="text"
            autoComplete="family-name"
            required
            value={form.lastName}
            onChange={(event) =>
              updateField('lastName', event.target.value)
            }
          />
        </label>
      </div>

      <label className="form-field">
        <span>Preferred name</span>
        <input
          type="text"
          autoComplete="nickname"
          value={form.preferredName}
          onChange={(event) =>
            updateField('preferredName', event.target.value)
          }
        />
        <small>Optional</small>
      </label>

      <label className="form-field">
        <span>Ownership unit</span>
        <select
          required
          disabled={loadingUnits || Boolean(unitError)}
          value={form.ownershipUnitId}
          onChange={(event) =>
            handleOwnershipUnitChange(event.target.value)
          }
        >
          <option value="" disabled>
            {loadingUnits
              ? 'Loading ownership units...'
              : 'Select an ownership unit'}
          </option>

          {ownershipUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </label>

      {selectedUnit && (
        <div className="form-message">
          <strong>{selectedUnit.name}</strong>
          <span>
            Ownership: {selectedUnit.ownership_percentage}%
          </span>
        </div>
      )}

      {unitError && (
        <div className="form-message error-state" role="alert">
          <strong>Unable to load ownership units</strong>
          <span>{unitError}</span>
        </div>
      )}

      <div className="form-grid two-column">
        <label className="form-field">
          <span>Relationship</span>
  <select
    value={form.relationshipToPrimary}
    onChange={(event) =>
      updateField(
        'relationshipToPrimary',
        event.target.value,
      )
    }
  >
    <option value="">Select relationship</option>
    <option value="Self">Self</option>
    <option value="Spouse">Spouse</option>
    <option value="Child">Child</option>
    <option value="Adult Child">Adult Child</option>
    <option value="Parent">Parent</option>
    <option value="Sibling">Sibling</option>
    <option value="Other">Other</option>
  </select>
        </label>

        <label className="form-field">
          <span>Person Role</span>
          <select
            value={form.personRole}
            onChange={(event) =>
              updateField('personRole', event.target.value)
            }
          >
    <option value="primary_owner">Primary Owner</option>
    <option value="co_owner">Co-Owner</option>
    <option value="spouse">Spouse</option>
    <option value="child">Child</option>
    <option value="adult_child">Adult Child</option>
    <option value="family_member">Family Member</option>
    <option value="guest">Guest</option>
    <option value="other">Other</option>
  </select>
        </label>
      </div>

      <fieldset className="form-fieldset">
        <legend>Benefit-pool eligibility</legend>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.participatesInSharedPool}
            onChange={(event) =>
              updateField(
                'participatesInSharedPool',
                event.target.checked,
              )
            }
          />
          <span>
            <strong>Shared benefits</strong>
            <small>Eligible to use shared-pool benefits.</small>
          </span>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.participatesInGolfPool}
            disabled={!selectedUnit?.participates_in_golf_pool}
            onChange={(event) =>
              updateField(
                'participatesInGolfPool',
                event.target.checked,
              )
            }
          />
          <span>
            <strong>Golf benefits</strong>
            <small>
              {selectedUnit?.participates_in_golf_pool
                ? 'Eligible for golf-pool participation.'
                : 'The selected ownership unit does not participate in the golf pool.'}
            </small>
          </span>
        </label>
      </fieldset>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(event) =>
            updateField('isActive', event.target.checked)
          }
        />
        <span>
          <strong>Active person</strong>
          <small>Included in normal membership workflows.</small>
        </span>
      </label>

      {submitError && (
        <div className="form-message error-state" role="alert">
          <strong>Unable to save person</strong>
          <span>{submitError}</span>
        </div>
      )}
    </form>
  );
}