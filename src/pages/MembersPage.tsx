import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from 'react';
import {
  createPerson,
  getActivePeople,
  reorderPeopleWithinOwnershipUnit,
  updatePerson,
  type CreatePersonInput,
  type OwnershipUnitRecord,
  type PersonRecord,
} from '../services/peopleService';
import { PageHeader } from '../components/layout/PageHeader';
import { SlideOver } from '../components/forms/SlideOver';
import { PersonForm } from '../components/forms/PersonForm';

const ADD_PERSON_FORM_ID = 'add-person-form';
const EDIT_PERSON_FORM_ID = 'edit-person-form';

type OwnershipUnitGroup = {
  unit: OwnershipUnitRecord;
  people: PersonRecord[];
};

const formatRole = (role: string) =>
  role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

function PoolBadge({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <span className={`eligibility-badge ${active ? 'active' : 'inactive'}`}>
      {label}: {active ? 'Yes' : 'No'}
    </span>
  );
}

export function MembersPage() {
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [addPersonFormState, setAddPersonFormState] = useState({
    canSubmit: false,
    submitting: false,
  });
  const [editPersonFormState, setEditPersonFormState] = useState({
    canSubmit: false,
    submitting: false,
  });
  const [selectedPerson, setSelectedPerson] =
    useState<PersonRecord | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Keyed by ownership_unit.id. A unit only appears here once its card
  // order has been changed locally but not yet saved; absence means "use
  // the persisted order from `people` as-is."
  const [orderDrafts, setOrderDrafts] = useState<
    Record<string, PersonRecord[]>
  >({});
  const [draggedPersonId, setDraggedPersonId] = useState<string | null>(
    null,
  );
  const [savingOrderUnitId, setSavingOrderUnitId] = useState<string | null>(
    null,
  );
  const [orderError, setOrderError] = useState<string | null>(null);

  const loadPeople = useCallback(async () => {
  setLoading(true);
  setErrorMessage(null);

  try {
    const records = await getActivePeople();
    setPeople(records);
  } catch (error) {
    setPeople([]);
    setErrorMessage(
      error instanceof Error
        ? error.message
        : 'Unable to load members.',
    );
  } finally {
    setLoading(false);
  }
}, []);

  const handleCreatePerson = useCallback(
    async (formData: CreatePersonInput) => {
      await createPerson(formData);

      const personName = [
        formData.firstName.trim(),
        formData.lastName.trim(),
      ].join(' ');

      setIsAddPersonOpen(false);
      setSuccessToast(`${personName} added successfully.`);
      await loadPeople();
    },
    [loadPeople],
  );

  const handleUpdatePerson = useCallback(
    async (formData: CreatePersonInput) => {
      if (!selectedPerson) {
        return;
      }

      await updatePerson({ id: selectedPerson.id, ...formData });

      const personName = [
        formData.firstName.trim(),
        formData.lastName.trim(),
      ].join(' ');

      setSelectedPerson(null);
      setSuccessToast(`${personName} updated successfully.`);
      await loadPeople();
    },
    [loadPeople, selectedPerson],
  );

  const handleSaveOrder = useCallback(
    async (unitId: string) => {
      const draft = orderDrafts[unitId];

      if (!draft) {
        return;
      }

      setSavingOrderUnitId(unitId);
      setOrderError(null);

      try {
        await reorderPeopleWithinOwnershipUnit(
          unitId,
          draft.map((person) => person.id),
        );

        setOrderDrafts((current) => {
          const next = { ...current };
          delete next[unitId];
          return next;
        });
        setSuccessToast('Member order saved.');
        await loadPeople();
      } catch (error) {
        setOrderError(
          error instanceof Error
            ? error.message
            : 'Unable to save member order.',
        );
      } finally {
        setSavingOrderUnitId(null);
      }
    },
    [orderDrafts, loadPeople],
  );

  function handleResetOrder(unitId: string) {
    setOrderDrafts((current) => {
      const next = { ...current };
      delete next[unitId];
      return next;
    });
  }

  function moveMember(
    unitId: string,
    currentOrder: PersonRecord[],
    index: number,
    direction: -1 | 1,
  ) {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= currentOrder.length) {
      return;
    }

    const next = [...currentOrder];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

    setOrderDrafts((current) => ({ ...current, [unitId]: next }));
  }

  function handleDragStart(personId: string) {
    setDraggedPersonId(personId);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
  }

  function handleDrop(
    unitId: string,
    currentOrder: PersonRecord[],
    targetIndex: number,
  ) {
    if (!draggedPersonId) {
      return;
    }

    const sourceIndex = currentOrder.findIndex(
      (person) => person.id === draggedPersonId,
    );

    if (sourceIndex === -1 || sourceIndex === targetIndex) {
      setDraggedPersonId(null);
      return;
    }

    const next = [...currentOrder];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);

    setOrderDrafts((current) => ({ ...current, [unitId]: next }));
    setDraggedPersonId(null);
  }

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  // Discard any pending, unsaved reorder drafts whenever the underlying
  // list reloads for an unrelated reason (e.g. adding or editing a
  // different person). A stale draft could otherwise drift out of sync
  // with the active-people set the reorder function validates against,
  // turning into a confusing save failure later instead of just asking
  // the admin to redo a still-in-progress reorder.
  useEffect(() => {
    setOrderDrafts({});
  }, [people]);

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

  const ownershipUnits = useMemo<OwnershipUnitGroup[]>(() => {
    const groups = new Map<string, OwnershipUnitGroup>();

    for (const person of people) {
      const unit = person.ownership_unit;

      const existingGroup = groups.get(unit.id);

      if (existingGroup) {
        existingGroup.people.push(person);
      } else {
        groups.set(unit.id, {
          unit,
          people: [person],
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.unit.name.localeCompare(b.unit.name),
    );
  }, [people]);

  return (
    <>
      <PageHeader
        eyebrow="Membership Structure"
        title="Members"
        subtitle="Ownership units, family members, account linkage, and benefit-pool eligibility."
        actions={
          <button
            type="button"
            className="primary-button"
            onClick={() => setIsAddPersonOpen(true)}
          >
            Add person
          </button>
        }
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

      <SlideOver
        open={isAddPersonOpen}
        title="Add Person"
        width="md"
        onClose={() => setIsAddPersonOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIsAddPersonOpen(false)}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              form={ADD_PERSON_FORM_ID}
              disabled={!addPersonFormState.canSubmit}
            >
              {addPersonFormState.submitting
                ? 'Saving...'
                : 'Save person'}
            </button>
          </>
        }
      >
        <PersonForm
          formId={ADD_PERSON_FORM_ID}
          open={isAddPersonOpen}
          mode="create"
          person={null}
          onSubmit={handleCreatePerson}
          onFormStateChange={setAddPersonFormState}
        />
      </SlideOver>

      <SlideOver
        open={Boolean(selectedPerson)}
        title="Edit Person"
        width="md"
        onClose={() => setSelectedPerson(null)}
        footer={
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedPerson(null)}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              form={EDIT_PERSON_FORM_ID}
              disabled={!editPersonFormState.canSubmit}
            >
              {editPersonFormState.submitting
                ? 'Saving...'
                : 'Save changes'}
            </button>
          </>
        }
      >
        <PersonForm
          formId={EDIT_PERSON_FORM_ID}
          open={Boolean(selectedPerson)}
          mode="edit"
          person={selectedPerson}
          onSubmit={handleUpdatePerson}
          onFormStateChange={setEditPersonFormState}
        />
      </SlideOver>

      {loading && (
        <section className="panel members-status">
          <p>Loading members...</p>
        </section>
      )}

      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load members</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
        </section>
      )}

      {orderError && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to save member order</p>
          <p>{orderError}</p>
        </section>
      )}

      {!loading && !errorMessage && ownershipUnits.length === 0 && (
        <section className="panel members-status">
          <p className="eyebrow">No records</p>
          <h3>No members are available</h3>
          <p>
            Confirm that the signed-in account has access to an ownership unit.
          </p>
        </section>
      )}

      {!loading &&
        !errorMessage &&
        ownershipUnits.map(({ unit, people: unitPeople }) => {
          const orderDraft = orderDrafts[unit.id];
          const displayedPeople = orderDraft ?? unitPeople;
          const hasOrderDraft = Boolean(orderDraft);
          const isSavingThisUnit = savingOrderUnitId === unit.id;

          return (
            <section className="panel ownership-unit-panel" key={unit.id}>
              <div className="panel-heading ownership-unit-heading">
                <div>
                  <p className="eyebrow">Ownership Unit</p>
                  <h3>{unit.name}</h3>
                  <p>
                    {unitPeople.length}{' '}
                    {unitPeople.length === 1 ? 'person' : 'people'}
                  </p>
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

              {hasOrderDraft && (
                <div className="form-message" role="status">
                  <span>
                    Member order has unsaved changes for this unit.
                  </span>

                  <div className="page-heading-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isSavingThisUnit}
                      onClick={() => handleResetOrder(unit.id)}
                    >
                      Reset order
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      disabled={isSavingThisUnit}
                      onClick={() => void handleSaveOrder(unit.id)}
                    >
                      {isSavingThisUnit ? 'Saving order...' : 'Save order'}
                    </button>
                  </div>
                </div>
              )}

              <div className="member-card-grid">
                {displayedPeople.map((person, index) => {
                  const displayName =
                    person.preferred_name?.trim() ||
                    `${person.first_name} ${person.last_name}`;

                  return (
                    <article
                      className="member-card"
                      key={person.id}
                      draggable
                      onDragStart={() => handleDragStart(person.id)}
                      onDragOver={handleDragOver}
                      onDrop={() =>
                        handleDrop(unit.id, displayedPeople, index)
                      }
                    >
                      <div className="member-card-header">
                        <span
                          className="member-drag-handle"
                          aria-hidden="true"
                          title="Drag to reorder"
                        >
                          ⠿
                        </span>

                        <div
                          className="member-avatar"
                          aria-hidden="true"
                        >
                          {displayName.charAt(0).toUpperCase()}
                        </div>

                        <div>
                          <h4>{displayName}</h4>
                          <p>{formatRole(person.person_role)}</p>
                        </div>
                      </div>

                      <dl className="member-details">
                        <div>
                          <dt>Legal name</dt>
                          <dd>
                            {person.first_name} {person.last_name}
                          </dd>
                        </div>

                        <div>
                          <dt>Relationship</dt>
                          <dd>
                            {person.relationship_to_primary || 'Not specified'}
                          </dd>
                        </div>

                        <div>
                          <dt>Application login</dt>
                          <dd>
                            {person.profile_id ? 'Linked' : 'Not linked'}
                          </dd>
                        </div>
                      </dl>

                      <div className="member-eligibility">
                        <PoolBadge
                          label="Shared"
                          active={person.participates_in_shared_pool}
                        />

                        <PoolBadge
                          label="Golf"
                          active={person.participates_in_golf_pool}
                        />
                      </div>

                      <div className="member-order-controls">
                        <button
                          type="button"
                          className="secondary-button"
                          aria-label={`Move ${displayName} up`}
                          disabled={index === 0}
                          onClick={() =>
                            moveMember(unit.id, displayedPeople, index, -1)
                          }
                        >
                          Move up
                        </button>

                        <button
                          type="button"
                          className="secondary-button"
                          aria-label={`Move ${displayName} down`}
                          disabled={index === displayedPeople.length - 1}
                          onClick={() =>
                            moveMember(unit.id, displayedPeople, index, 1)
                          }
                        >
                          Move down
                        </button>
                      </div>

                      <button
                        type="button"
                        className="secondary-button button-block"
                        onClick={() => setSelectedPerson(person)}
                      >
                        Edit Member
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
    </>
  );
}