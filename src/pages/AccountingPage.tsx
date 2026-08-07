import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getAccountingSnapshot,
  type AccountingSnapshot,
  type AccountingUnitBalance,
} from '../services/accountingService';
import type { BenefitPool, QuantityKind } from '../services/benefitsService';

function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatQuantity(kind: QuantityKind, value: number): string {
  const rounded = Math.abs(value) < 0.0000005 ? 0 : value;

  if (kind === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(rounded);
  }

  const labels: Record<Exclude<QuantityKind, 'currency'>, [string, string]> = {
    count: ['item', 'items'],
    nights: ['night', 'nights'],
    weeks: ['week', 'weeks'],
    rounds: ['round', 'rounds'],
  };
  const magnitude = Math.abs(rounded);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(magnitude) ? 0 : 0,
    maximumFractionDigits: 4,
  }).format(magnitude);
  const [singular, plural] = labels[kind];
  const noun = magnitude === 1 ? singular : plural;
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${formatted} ${noun}`;
}

function signedQuantity(kind: QuantityKind, value: number): string {
  if (Math.abs(value) < 0.0000005) return '—';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${formatQuantity(kind, Math.abs(value))}`;
}

function benefitGroups(rows: AccountingUnitBalance[], pool: BenefitPool) {
  const grouped = new Map<string, AccountingUnitBalance[]>();

  rows
    .filter((row) => row.pool === pool)
    .forEach((row) => {
      const current = grouped.get(row.benefitGrantId) ?? [];
      current.push(row);
      grouped.set(row.benefitGrantId, current);
    });

  return [...grouped.values()].map((group) => ({
    benefitGrantId: group[0].benefitGrantId,
    benefitName: group[0].benefitName,
    quantityKind: group[0].quantityKind,
    rows: group.filter(
      (row) =>
        row.allocationPercentage > 0 ||
        Math.abs(row.ledgerDelta) > 0.0000005 ||
        Math.abs(row.remainingQuantity) > 0.0000005,
    ),
  }));
}

export function AccountingPage() {
  const [snapshot, setSnapshot] = useState<AccountingSnapshot | null>(null);
  const [requestedDate, setRequestedDate] = useState(todayLocal());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (asOf: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      setSnapshot(await getAccountingSnapshot(asOf));
    } catch (error) {
      setSnapshot(null);
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to load accounting balances.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot(todayLocal());
  }, [loadSnapshot]);

  const sharedGroups = useMemo(
    () => (snapshot ? benefitGroups(snapshot.unitBalances, 'shared') : []),
    [snapshot],
  );
  const golfGroups = useMemo(
    () => (snapshot ? benefitGroups(snapshot.unitBalances, 'golf') : []),
    [snapshot],
  );

  const reconciledCount = snapshot?.reconciliation.filter((row) => row.isReconciled).length ?? 0;
  const reconciliationCount = snapshot?.reconciliation.length ?? 0;
  const outOfBalanceCount = reconciliationCount - reconciledCount;

  function handleAsOfSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestedDate) return;
    void loadSnapshot(requestedDate);
  }

  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Balances & reconciliation"
        subtitle="Track each ownership unit’s equity position while keeping Shared and Golf benefit pools independent."
      />

      <section className="panel accounting-asof-panel">
        <div className="panel-heading accounting-filter-heading">
          <div>
            <p className="eyebrow">Historical position</p>
            <h3>Balance as of date</h3>
            <p>Approved ledger activity is reconstructed using its effective, approval, and void dates.</p>
          </div>
          <form className="accounting-date-form" onSubmit={handleAsOfSubmit}>
            <label className="form-field">
              <span>As of</span>
              <input
                type="date"
                value={requestedDate}
                onChange={(event) => setRequestedDate(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="secondary-button" disabled={loading || !requestedDate}>
              {loading ? 'Loading...' : 'Load position'}
            </button>
          </form>
        </div>
      </section>

      {loading && !snapshot && (
        <section className="panel members-status"><p>Loading accounting balances...</p></section>
      )}

      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load accounting</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
          <button type="button" className="secondary-button" onClick={() => void loadSnapshot(requestedDate)}>Try again</button>
        </section>
      )}

      {snapshot && !errorMessage && (
        <>
          <section className="metrics-grid accounting-metrics" aria-label="Accounting summary">
            <article className={`metric-card ${outOfBalanceCount > 0 ? 'warning' : ''}`}>
              <span>Reconciled benefits</span>
              <strong>{reconciledCount}/{reconciliationCount}</strong>
              <small>{outOfBalanceCount === 0 ? 'Grant totals match unit positions' : `${outOfBalanceCount} benefit${outOfBalanceCount === 1 ? '' : 's'} need review`}</small>
            </article>
            <article className="metric-card">
              <span>Shared benefits</span>
              <strong>{sharedGroups.length}</strong>
              <small>Belcher, Belcher Sr., and Tatro accounting</small>
            </article>
            <article className="metric-card">
              <span>Golf benefits</span>
              <strong>{golfGroups.length}</strong>
              <small>Golf-participating ownership units only</small>
            </article>
            <article className="metric-card">
              <span>Position date</span>
              <strong>{formatDate(snapshot.asOf)}</strong>
              <small>Historical reconstruction from the append-only ledger</small>
            </article>
          </section>

          <section className="accounting-note" role="note">
            <strong>Accounting position, not a booking cap.</strong>
            <span>A negative unit position is allowed and means that unit has used more than its allocated share. Use transfers or corrective ledger entries to reconcile; prior history is never rewritten.</span>
          </section>

          <AccountingPoolSection title="Shared pool" pool="shared" groups={sharedGroups} />
          <AccountingPoolSection title="Golf pool" pool="golf" groups={golfGroups} />

          <section className="panel">
            <div className="panel-heading transaction-panel-heading">
              <div>
                <p className="eyebrow">Control total</p>
                <h3>Reconciliation</h3>
                <p>For every grant, the membership-level balance must equal the sum of ownership-unit positions.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="accounting-reconciliation-table">
                <thead>
                  <tr><th>Benefit</th><th>Pool</th><th>Grant remaining</th><th>Units remaining</th><th>Difference</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {snapshot.reconciliation.map((row) => (
                    <tr key={row.benefitGrantId}>
                      <td><strong>{row.benefitName}</strong></td>
                      <td><span className={`pool-tag ${row.pool}`}>{row.pool === 'shared' ? 'Shared' : 'Golf'}</span></td>
                      <td>{formatQuantity(row.quantityKind, row.grantRemainingQuantity)}</td>
                      <td>{formatQuantity(row.quantityKind, row.unitRemainingQuantity)}</td>
                      <td className={Math.abs(row.remainingReconciliationDifference) < 0.0000005 ? '' : 'quantity-negative'}>
                        {signedQuantity(row.quantityKind, row.remainingReconciliationDifference)}
                      </td>
                      <td><span className={`accounting-status ${row.isReconciled ? 'accounting-status-ok' : 'accounting-status-review'}`}>{row.isReconciled ? 'Reconciled' : 'Review'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

type AccountingPoolSectionProps = {
  title: string;
  pool: BenefitPool;
  groups: ReturnType<typeof benefitGroups>;
};

function AccountingPoolSection({ title, pool, groups }: AccountingPoolSectionProps) {
  return (
    <section className="panel accounting-pool-panel">
      <div className="panel-heading transaction-panel-heading">
        <div>
          <p className="eyebrow">{pool === 'shared' ? 'Shared accounting' : 'Golf accounting'}</p>
          <h3>{title}</h3>
          <p>{pool === 'shared' ? 'Ownership positions across all Shared-pool participants.' : 'A separate ledger position for Golf-pool participants; Tatro is not allocated Golf inventory.'}</p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="members-status"><p>No {title.toLowerCase()} benefits are available.</p></div>
      ) : (
        <div className="accounting-benefit-list">
          {groups.map((group) => (
            <article className="accounting-benefit" key={group.benefitGrantId}>
              <div className="accounting-benefit-heading">
                <div>
                  <h4>{group.benefitName}</h4>
                  <span className={`pool-tag ${pool}`}>{pool === 'shared' ? 'Shared' : 'Golf'}</span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="accounting-unit-table">
                  <thead><tr><th>Ownership unit</th><th>Allocation</th><th>Original share</th><th>Ledger change</th><th>Position</th></tr></thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.ownershipUnitId}>
                        <td><strong>{row.ownershipUnitName}</strong></td>
                        <td>{new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(row.allocationPercentage)}%</td>
                        <td>{formatQuantity(group.quantityKind, row.allocatedQuantity)}</td>
                        <td className={row.ledgerDelta < 0 ? 'quantity-negative' : row.ledgerDelta > 0 ? 'quantity-positive' : ''}>{signedQuantity(group.quantityKind, row.ledgerDelta)}</td>
                        <td className={row.remainingQuantity < 0 ? 'quantity-negative' : ''}><strong>{formatQuantity(group.quantityKind, row.remainingQuantity)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
