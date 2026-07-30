import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getActivePeople,
  type OwnershipUnitRecord,
  type PersonRecord,
} from '../services/peopleService';
import { PageHeader } from '../components/layout/PageHeader';
import { SlideOver } from '../components/forms/SlideOver';
import {
  ADD_PERSON_FORM_ID,
  PersonForm,
} from '../components/forms/PersonForm';

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
  const [selectedPerson, setSelectedPerson] =
    useState<PersonRecord | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

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

  const handlePersonSaved = useCallback(
    async (personName: string) => {
      setIsAddPersonOpen(false);
      setSuccessToast(`${personName} added successfully.`);
      await loadPeople();
    },
    [loadPeople],
  );

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

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
            onClick={() => setIsAddPersonOpen(true)}
          >
            Add person
          </button>
        }
      />

      <SlideOver
        open={isAddPersonOpen}
        title="Add Person"
        width="md"
        onClose={() => setIsAddPersonOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsAddPersonOpen(false)}
            >
              Cancel
            </button>

            <button
              type="submit"
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
          open={isAddPersonOpen}
          onSaved={handlePersonSaved}
          onFormStateChange={setAddPersonFormState}
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

      {!loading && !errorMessage && ownershipUnits.length === 0 && (
        <section className="panel members-status">
          <p className="eyebrow">No records</p>
          <h3>No members are available</h3>
          <p>
            Confirm that the signed-in account has access to an ownership unit.
          </p>
        </section>
      )}

      {selectedPerson && (
        <section className="panel members-status">
          <p>
            Selected for editing: {selectedPerson.first_name}{' '}
            {selectedPerson.last_name}
          </p>
        </section>
      )}

      {!loading &&
        !errorMessage &&
        ownershipUnits.map(({ unit, people: unitPeople }) => (
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

            <div className="member-card-grid">
              {unitPeople.map((person) => {
                const displayName =
                  person.preferred_name?.trim() ||
                  `${person.first_name} ${person.last_name}`;

                return (
                  <article className="member-card" key={person.id}>
                    <div className="member-card-header">
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

                    <button
                      type="button"
                      onClick={() => setSelectedPerson(person)}
                    >
                      Edit
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
    </>
  );
}