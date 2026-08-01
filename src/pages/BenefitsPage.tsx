import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  createBenefitGrant,
  getBenefitAdministrationContext,
  getBenefitCatalog,
  updateBenefitGrantAccounting,
  updateBenefitGrantMetadata,
  type BenefitGrantRecord,
  type BenefitMembershipSummary,
  type CreateBenefitGrantInput,
  type UpdateBenefitGrantAccountingInput,
  type UpdateBenefitGrantMetadataInput,
} from '../services/benefitsService';
import {
  getBenefitDetail,
  type BenefitDetailView as BenefitDetailViewData,
} from '../services/benefitDetailsService';
import { PageHeader } from '../components/layout/PageHeader';
import { SlideOver } from '../components/forms/SlideOver';
import {
  BenefitGrantForm,
  QUANTITY_KIND_LABELS,
} from '../components/forms/BenefitGrantForm';
import { BenefitDetailView } from '../components/BenefitDetailView';

const CREATE_BENEFIT_FORM_ID = 'create-benefit-grant-form';

export function formatDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  // value is a plain 'YYYY-MM-DD' date string from Postgres; parse as UTC
  // so the displayed date never shifts a day based on the viewer's
  // timezone.
  const parsed = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function BenefitGrantCard({
  grant,
  onEdit,
  onViewDetails,
}: {
  grant: BenefitGrantRecord;
  onEdit: (grant: BenefitGrantRecord) => void;
  onViewDetails: (grant: BenefitGrantRecord) => void;
}) {
  const releaseDate = formatDate(grant.releaseDate);
  const expirationDate = formatDate(grant.expirationDate);

  // The main content region is a div with role="button" (not a native
  // <button>) because its content includes flow content (a heading, a
  // <dl>) that a native button element cannot validly contain. Keyboard
  // semantics (tabIndex, Enter/Space activation) are provided explicitly
  // below so it remains fully operable, not just clickable. "Edit benefit"
  // is a separate sibling control, never nested inside this region, so
  // there is no nested-interactive-element violation either way.
  const handleViewDetailsKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onViewDetails(grant);
    }
  };

  return (
    <article className="benefit-card">
      <div
        className="benefit-card-trigger"
        role="button"
        tabIndex={0}
        aria-label={`View details for ${grant.name}`}
        onClick={() => onViewDetails(grant)}
        onKeyDown={handleViewDetailsKeyDown}
      >
        <div className="benefit-title-row">
          <h4>{grant.name}</h4>

          {grant.hasRecordedUsage && (
            <span className="locked-tag" title="Accounting fields are locked">
              Locked
            </span>
          )}
        </div>

        <dl>
          <div>
            <dt>Quantity</dt>
            <dd>{grant.originalQuantity}</dd>
          </div>

          <div>
            <dt>Quantity unit</dt>
            <dd>{QUANTITY_KIND_LABELS[grant.quantityKind]}</dd>
          </div>

          {releaseDate && (
            <div>
              <dt>Release date</dt>
              <dd>{releaseDate}</dd>
            </div>
          )}

          {expirationDate && (
            <div>
              <dt>Expiration date</dt>
              <dd>{expirationDate}</dd>
            </div>
          )}

          {grant.restrictions && (
            <div>
              <dt>Restrictions</dt>
              <dd>{grant.restrictions}</dd>
            </div>
          )}
        </dl>

        <span className="benefit-card-view-hint" aria-hidden="true">
          View details
        </span>
      </div>

      <button
        type="button"
        className="secondary-button button-block"
        onClick={() => onEdit(grant)}
      >
        Edit benefit
      </button>
    </article>
  );
}

function BenefitPoolSection({
  title,
  description,
  poolClassName,
  grants,
  emptyMessage,
  onEdit,
  onViewDetails,
}: {
  title: string;
  description: string;
  poolClassName: 'shared' | 'golf';
  grants: BenefitGrantRecord[];
  emptyMessage: string;
  onEdit: (grant: BenefitGrantRecord) => void;
  onViewDetails: (grant: BenefitGrantRecord) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Pool</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

        <span className={`pool-tag ${poolClassName}`}>
          {grants.length} {grants.length === 1 ? 'benefit' : 'benefits'}
        </span>
      </div>

      {grants.length === 0 ? (
        <div className="members-status">
          <p className="eyebrow">No records</p>
          <h3>{emptyMessage}</h3>
          <p>Use "Add benefit" to create one.</p>
        </div>
      ) : (
        <div className="benefit-grid">
          {grants.map((grant) => (
            <BenefitGrantCard
              key={grant.id}
              grant={grant}
              onEdit={onEdit}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function BenefitsPage() {
  const [membership, setMembership] =
    useState<BenefitMembershipSummary | null>(null);
  const [grants, setGrants] = useState<BenefitGrantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFormState, setCreateFormState] = useState({
    canSubmit: false,
    submitting: false,
  });

  const [selectedGrant, setSelectedGrant] =
    useState<BenefitGrantRecord | null>(null);

  const [detailGrant, setDetailGrant] = useState<BenefitGrantRecord | null>(
    null,
  );
  const [detailView, setDetailView] = useState<BenefitDetailViewData | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(
    null,
  );

  // Guards against a rapid A-to-B (or A-then-close) selection change: only
  // the response matching the request id current at the time it resolves
  // is applied to state. Incremented both when a new request starts and
  // when the SlideOver closes, so a still-in-flight response after close
  // can never reopen it or apply stale data.
  const detailRequestIdRef = useRef(0);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const context = await getBenefitAdministrationContext();
      setMembership(context.membership);
      setGrants(context.grants);
    } catch (error) {
      setMembership(null);
      setGrants([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load the benefit catalog.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Used after a mutation, once the membership is already known -- avoids
  // re-running the zero/one/many-memberships check on every save, since the
  // accessible membership set does not change mid-session.
  const refreshCatalog = useCallback(async () => {
    if (!membership) {
      return;
    }

    const records = await getBenefitCatalog(membership.id);
    setGrants(records);
  }, [membership]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

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

  const handleCreateSubmit = useCallback(
    async (input: CreateBenefitGrantInput) => {
      const created = await createBenefitGrant(input);
      setIsCreateOpen(false);
      setSuccessToast(`${created.name} added to the catalog.`);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  const handleSaveDetails = useCallback(
    async (input: UpdateBenefitGrantMetadataInput) => {
      const updated = await updateBenefitGrantMetadata(input);
      // Keep the SlideOver open after a partial save: the allocation
      // section in the same panel may still need attention, and closing
      // here would force an awkward reopen to finish that second save.
      setSelectedGrant(updated);
      setSuccessToast(`${updated.name} details saved.`);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  const handleSaveAllocation = useCallback(
    async (input: UpdateBenefitGrantAccountingInput) => {
      const updated = await updateBenefitGrantAccounting(input);
      setSelectedGrant(updated);
      setSuccessToast(`${updated.name} allocation saved.`);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  const handleCloseDetails = useCallback(() => {
    // Invalidate any in-flight request first: if it resolves after this
    // point, its requestId will no longer match and its response is
    // ignored (see the effect-free check inside handleViewDetails below).
    detailRequestIdRef.current += 1;
    setDetailGrant(null);
    setDetailView(null);
    setDetailErrorMessage(null);
    setDetailLoading(false);
  }, []);

  const handleViewDetails = useCallback((grant: BenefitGrantRecord) => {
    // Only one benefit SlideOver may be open at a time: opening details
    // closes Edit first.
    setSelectedGrant(null);

    setDetailGrant(grant);
    setDetailView(null);
    setDetailErrorMessage(null);
    setDetailLoading(true);

    const requestId = ++detailRequestIdRef.current;

    getBenefitDetail(grant.id)
      .then((view) => {
        if (detailRequestIdRef.current !== requestId) {
          // Superseded by a later selection, or the SlideOver was closed
          // before this resolved -- discard.
          return;
        }

        setDetailView(view);
        setDetailLoading(false);
      })
      .catch((error: unknown) => {
        if (detailRequestIdRef.current !== requestId) {
          return;
        }

        setDetailErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load benefit details.',
        );
        setDetailLoading(false);
      });
  }, []);

  const handleEdit = useCallback(
    (grant: BenefitGrantRecord) => {
      // Only one benefit SlideOver may be open at a time: opening Edit
      // closes Details first.
      handleCloseDetails();
      setSelectedGrant(grant);
    },
    [handleCloseDetails],
  );

  const sharedGrants = useMemo(
    () => grants.filter((grant) => grant.pool === 'shared'),
    [grants],
  );

  const golfGrants = useMemo(
    () => grants.filter((grant) => grant.pool === 'golf'),
    [grants],
  );

  return (
    <>
      <PageHeader
        eyebrow="Membership Structure"
        title="Benefits"
        subtitle="Shared and Golf benefits are administered independently and never combined."
        actions={
          <button
            type="button"
            className="primary-button"
            disabled={!membership}
            onClick={() => setIsCreateOpen(true)}
          >
            Add benefit
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
        open={isCreateOpen}
        title="Add Benefit"
        width="md"
        onClose={() => setIsCreateOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              form={CREATE_BENEFIT_FORM_ID}
              disabled={!createFormState.canSubmit}
            >
              {createFormState.submitting ? 'Saving...' : 'Save benefit'}
            </button>
          </>
        }
      >
        {membership && (
          <BenefitGrantForm
            mode="create"
            formId={CREATE_BENEFIT_FORM_ID}
            open={isCreateOpen}
            membershipId={membership.id}
            onSubmit={handleCreateSubmit}
            onFormStateChange={setCreateFormState}
          />
        )}
      </SlideOver>

      <SlideOver
        open={Boolean(selectedGrant)}
        title="Edit Benefit"
        width="md"
        onClose={() => setSelectedGrant(null)}
      >
        {selectedGrant && (
          <BenefitGrantForm
            mode="edit"
            open={Boolean(selectedGrant)}
            grant={selectedGrant}
            onSaveDetails={handleSaveDetails}
            onSaveAllocation={handleSaveAllocation}
          />
        )}
      </SlideOver>

      <SlideOver
        open={Boolean(detailGrant)}
        title={detailGrant ? detailGrant.name : 'Benefit Details'}
        width="lg"
        onClose={handleCloseDetails}
      >
        {detailGrant && (
          <>
            <p className="eyebrow">Benefit details</p>
            <BenefitDetailView
              grant={detailGrant}
              detailView={detailView}
              isLoading={detailLoading}
              errorMessage={detailErrorMessage}
            />
          </>
        )}
      </SlideOver>

      {loading && (
        <section className="panel members-status">
          <p>Loading benefits...</p>
        </section>
      )}

      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load benefits</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
        </section>
      )}

      {!loading && !errorMessage && membership && (
        <>
          <BenefitPoolSection
            title="Shared Benefits"
            description="Available to every ownership unit that participates in the Shared pool."
            poolClassName="shared"
            grants={sharedGrants}
            emptyMessage="No active shared benefits."
            onEdit={handleEdit}
            onViewDetails={handleViewDetails}
          />

          <BenefitPoolSection
            title="Golf Benefits"
            description="Available only to ownership units that participate in the Golf pool."
            poolClassName="golf"
            grants={golfGrants}
            emptyMessage="No active golf benefits."
            onEdit={handleEdit}
            onViewDetails={handleViewDetails}
          />
        </>
      )}
    </>
  );
}
