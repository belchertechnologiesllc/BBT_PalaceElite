import { useEffect, useMemo, useState } from 'react';
import {
  getDashboardData,
  type DashboardBenefitRow,
  type DashboardData,
  type QuantityKind,
} from '../services/dashboardService';
import { formatDate } from './BenefitsPage';

// -----------------------------------------------------------------------
// Family equity position -- intentionally still static.
//
// Per-unit "shared value received" and golf rounds/nights "used" require
// aggregating public.benefit_transactions by ownership_unit_id and pool,
// which has no corresponding UI/service anywhere in this app yet (no
// transaction-entry workflow exists -- the "Add transaction" button below
// is already disabled for exactly this reason). Wiring live ownership
// unit *names* here while leaving invented numeric caps (the "/10
// rounds", "/4 nights" denominators below are not backed by any real
// per-unit limit in the schema) would be more misleading than leaving
// this table static and clearly out of scope until that workflow exists.
// See docs/claude-reports/DASHBOARD-LIVE-BENEFITS.md for the full
// live-vs-static classification.
type OwnershipUnit = {
  name: string;
  members: string;
  sharedValue: number;
  golfRoundsUsed: number | null;
  golfNightsUsed: number | null;
};

const units: OwnershipUnit[] = [
  {
    name: 'Belcher',
    members: 'Anthony, Kristin, and children',
    sharedValue: 0,
    golfRoundsUsed: 0,
    golfNightsUsed: 0,
  },
  {
    name: 'Belcher Sr.',
    members: 'Mike and Theresa',
    sharedValue: 0,
    golfRoundsUsed: 0,
    golfNightsUsed: 0,
  },
  {
    name: 'Tatro',
    members: 'Larry, Angie, and Spencer',
    sharedValue: 0,
    golfRoundsUsed: null,
    golfNightsUsed: null,
  },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);

// Singular/plural unit words for each quantity_kind except 'currency'
// (formatted as money, not counted). 'count' has no single natural noun
// tied to it (unlike weeks/nights/rounds) since it's used for whatever a
// benefit's administrator chose as a plain countable allocation -- "use"/
// "uses" is a deliberately generic, non-benefit-specific label, not a
// per-benefit-name branch.
const QUANTITY_UNIT_WORDS: Record<
  Exclude<QuantityKind, 'currency'>,
  { singular: string; plural: string }
> = {
  weeks: { singular: 'week', plural: 'weeks' },
  nights: { singular: 'night', plural: 'nights' },
  rounds: { singular: 'round', plural: 'rounds' },
  count: { singular: 'use', plural: 'uses' },
};

function formatBenefitQuantity(kind: QuantityKind, value: number): string {
  if (kind === 'currency') {
    return formatCurrency(value);
  }

  const words = QUANTITY_UNIT_WORDS[kind];
  const word = value === 1 ? words.singular : words.plural;
  return `${value} ${word}`;
}

function formatExpiration(expirationDate: string | null): string {
  if (!expirationDate) {
    return 'No date listed';
  }

  return formatDate(expirationDate) ?? 'No date listed';
}

// Earliest upcoming (today or later) expiration among live benefits, with
// every benefit name that shares that exact date -- never a single
// hard-coded name. ISO 'YYYY-MM-DD' strings sort lexicographically in
// chronological order, so plain string comparison is sufficient.
function findNextExpiration(
  benefits: DashboardBenefitRow[],
): { date: string; names: string[] } | null {
  const todayIso = new Date().toISOString().slice(0, 10);

  const upcoming = benefits.filter(
    (benefit): benefit is DashboardBenefitRow & { expirationDate: string } =>
      benefit.expirationDate !== null && benefit.expirationDate >= todayIso,
  );

  if (upcoming.length === 0) {
    return null;
  }

  const earliestDate = upcoming.reduce(
    (earliest, benefit) =>
      benefit.expirationDate < earliest ? benefit.expirationDate : earliest,
    upcoming[0].expirationDate,
  );

  const names = upcoming
    .filter((benefit) => benefit.expirationDate === earliestDate)
    .map((benefit) => benefit.name);

  return { date: earliestDate, names };
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // An AbortController (rather than just a "cancelled" boolean guard) is
  // used here specifically because React 18 StrictMode intentionally
  // double-invokes effects in development -- without a real abort signal
  // wired into the underlying Supabase/PostgREST fetch calls, the first
  // invocation's in-flight requests would still hit the network even
  // though their results are discarded, showing up as spurious aborted
  // requests during local development. Aborting them outright avoids that
  // noise entirely, not just the stale-state-update it would otherwise
  // cause.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setErrorMessage(null);

      try {
        const result = await getDashboardData(controller.signal);
        setData(result);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to load the dashboard.',
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, []);

  // Static pending the transaction/reservation workflow -- see the
  // `units` comment above.
  const totalSharedValue = useMemo(
    () => units.reduce((sum, unit) => sum + unit.sharedValue, 0),
    [],
  );

  const perUnitPurchasePrice =
    data && data.ownershipUnits.length > 0
      ? data.membership.purchasePrice / data.ownershipUnits.length
      : null;

  const nextExpiration = useMemo(
    () => (data ? findNextExpiration(data.benefits) : null),
    [data],
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Dashboard</h2>
          <p className="subtitle">
            Current membership position and benefit availability.
          </p>
        </div>
      </section>

      {loading && (
        <section className="panel members-status">
          <p>Loading dashboard...</p>
        </section>
      )}

      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load dashboard</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
        </section>
      )}

      {!loading && !errorMessage && data && (
        <>
          <section className="metrics-grid" aria-label="Membership summary">
            <article className="metric-card">
              <span>Purchase price</span>
              <strong>{formatCurrency(data.membership.purchasePrice)}</strong>
              <small>
                {perUnitPurchasePrice !== null
                  ? `${formatCurrency(perUnitPurchasePrice)} per ownership unit`
                  : 'No ownership units on record'}
              </small>
            </article>

            <article className="metric-card">
              <span>Shared value recorded</span>
              <strong>{formatCurrency(totalSharedValue)}</strong>
              <small>Economic value, not cash owed</small>
            </article>

            <article className="metric-card warning">
              <span>Next known expiration</span>
              <strong>
                {nextExpiration ? formatDate(nextExpiration.date) : 'None scheduled'}
              </strong>
              <small>
                {nextExpiration
                  ? nextExpiration.names.join(', ')
                  : 'No benefits have a recorded expiration date'}
              </small>
            </article>

            <article className="metric-card">
              <span>Open reservations</span>
              <strong>{data.openReservationsCount}</strong>
              <small>
                {data.openReservationsCount === 0
                  ? 'No trips entered yet'
                  : `${data.openReservationsCount} ${data.openReservationsCount === 1 ? 'trip' : 'trips'} on the books`}
              </small>
            </article>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Ownership</p>
                <h3>Family equity position</h3>
              </div>

              <button type="button" disabled>
                Add transaction
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ownership unit</th>
                    <th>Members</th>
                    <th>Shared value received</th>
                    <th>Golf allocation</th>
                  </tr>
                </thead>

                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.name}>
                      <td>
                        <strong>{unit.name}</strong>
                      </td>
                      <td>{unit.members}</td>
                      <td>{formatCurrency(unit.sharedValue)}</td>
                      <td>
                        {unit.golfRoundsUsed === null
                          ? 'Not participating'
                          : `${unit.golfRoundsUsed}/10 rounds | ${unit.golfNightsUsed}/4 nights`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Inventory</p>
                <h3>Available membership benefits</h3>
              </div>
            </div>

            {data.benefits.length === 0 ? (
              <div className="members-status">
                <p className="eyebrow">No records</p>
                <h3>No benefits found for this membership.</h3>
                <p>Contact a membership administrator if this seems wrong.</p>
              </div>
            ) : (
              <div className="benefit-grid">
                {data.benefits.map((benefit) => (
                  <article className="benefit-card" key={benefit.id}>
                    <div className="benefit-title-row">
                      <h4>{benefit.name}</h4>
                      <span className={`pool-tag ${benefit.pool}`}>
                        {benefit.pool === 'shared' ? 'Shared' : 'Golf'}
                      </span>
                    </div>

                    <dl>
                      <div>
                        <dt>Remaining</dt>
                        <dd>
                          {formatBenefitQuantity(
                            benefit.quantityKind,
                            benefit.remainingQuantity,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Original</dt>
                        <dd>
                          {formatBenefitQuantity(
                            benefit.quantityKind,
                            benefit.originalQuantity,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        <dd>{formatExpiration(benefit.expirationDate)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
