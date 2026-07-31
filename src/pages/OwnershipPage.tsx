import { useCallback, useEffect, useState } from 'react';
import {
  getOwnershipUnits,
  updateOwnershipUnit,
  type OwnershipUnitRecord,
  type UpdateOwnershipUnitInput,
} from '../services/ownershipUnitsService';
import { PageHeader } from '../components/layout/PageHeader';
import { SlideOver } from '../components/forms/SlideOver';
import { OwnershipUnitForm } from '../components/forms/OwnershipUnitForm';

const EDIT_OWNERSHIP_UNIT_FORM_ID = 'edit-ownership-unit-form';

const memberDisplayName = (member: {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}) => member.preferred_name?.trim() || `${member.first_name} ${member.last_name}`;

const formatRole = (role: string) =>
  role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function OwnershipPage() {
  const [units, setUnits] = useState<OwnershipUnitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [percentageWarning, setPercentageWarning] = useState<string | null>(
    null,
  );

  const [selectedOwnershipUnit, setSelectedOwnershipUnit] =
    useState<OwnershipUnitRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const records = await getOwnershipUnits();
      setUnits(records);
    } catch (error) {
      setUnits([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load ownership units.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpdateOwnershipUnit = useCallback(
    async (formData: UpdateOwnershipUnitInput) => {
      if (!selectedOwnershipUnit) {
        return;
      }

      setSubmitting(true);

      try {
        const result = await updateOwnershipUnit(
          selectedOwnershipUnit.id,
          formData,
        );

        setSelectedOwnershipUnit(null);
        setPercentageWarning(result.ownershipPercentageWarning);
        setSuccessToast(`${result.ownershipUnit.name} updated successfully.`);
        await loadUnits();
      } finally {
        setSubmitting(false);
      }
    },
    [selectedOwnershipUnit, loadUnits],
  );

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    if (!successToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuccessToast(null);
    }, 3500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [successToast]);

  return (
    <>
      <PageHeader
        eyebrow="Membership Structure"
        title="Ownership"
        subtitle="Ownership units, ownership percentages, and benefit-pool configuration."
      />

      {successToast && (
        <div className="success-toast" role="status">
          <span>{successToast}</span>
          <button
            type="button"
            className="success-toast-close"
            aria-label="Dismiss"
            onClick={() => setSuccessToast(null)}
          >
            ✕
          </button>
        </div>
      )}

      {percentageWarning && (
        <section className="panel members-status" role="status">
          <p className="eyebrow">Ownership percentages</p>
          <p>{percentageWarning}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPercentageWarning(null)}
          >
            Dismiss
          </button>
        </section>
      )}

      <SlideOver
        open={Boolean(selectedOwnershipUnit)}
        title="Edit Ownership Unit"
        width="md"
        onClose={() => setSelectedOwnershipUnit(null)}
        footer={
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedOwnershipUnit(null)}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              form={EDIT_OWNERSHIP_UNIT_FORM_ID}
              disabled={!canSubmit}
            >
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </>
        }
      >
        <OwnershipUnitForm
          formId={EDIT_OWNERSHIP_UNIT_FORM_ID}
          ownershipUnit={selectedOwnershipUnit}
          submitting={submitting}
          onSubmit={handleUpdateOwnershipUnit}
          onValidityChange={setCanSubmit}
        />
      </SlideOver>

      {loading && (
        <section className="panel members-status">
          <p>Loading ownership units...</p>
        </section>
      )}

      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load ownership units</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
        </section>
      )}

      {!loading && !errorMessage && units.length === 0 && (
        <section className="panel members-status">
          <p className="eyebrow">No records</p>
          <h3>No ownership units are available</h3>
          <p>
            Confirm that the signed-in account has access to a membership.
          </p>
        </section>
      )}

      {!loading &&
        !errorMessage &&
        units.map((unit) => (
          <section className="panel ownership-unit-panel" key={unit.id}>
            <div className="panel-heading ownership-unit-heading">
              <div>
                <p className="eyebrow">Ownership Unit</p>
                <h3>{unit.name}</h3>
                <p>{unit.members_description || 'No description provided.'}</p>
              </div>

              <span
                className={`pool-tag ${
                  unit.participates_in_golf_pool ? 'golf' : 'shared'
                }`}
              >
                {unit.participates_in_golf_pool
                  ? 'Shared + Golf'
                  : 'Shared Only'}
              </span>
            </div>

            <div className="ownership-unit-body">
              <dl className="member-details">
                <div>
                  <dt>Ownership percentage</dt>
                  <dd>{unit.ownership_percentage}%</dd>
                </div>
              </dl>

              <div className="assigned-members">
                <p className="eyebrow">Assigned active members</p>

                {unit.assigned_active_members.length === 0 ? (
                  <p>No active members are currently assigned.</p>
                ) : (
                  <ul className="assigned-members-list">
                    {unit.assigned_active_members.map((member) => (
                      <li key={member.id}>
                        <span>{memberDisplayName(member)}</span>
                        <span className="member-role-tag">
                          {formatRole(member.person_role)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="ownership-unit-footer">
              <button
                type="button"
                className="secondary-button button-block"
                onClick={() => setSelectedOwnershipUnit(unit)}
              >
                Edit Ownership Unit
              </button>
            </div>
          </section>
        ))}
    </>
  );
}
