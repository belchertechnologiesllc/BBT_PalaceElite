import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getDashboardData,
  type DashboardData,
  type QuantityKind,
} from '../services/dashboardService';
import type { NavigationItem } from '../types/navigation';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);

const QUANTITY_LABELS: Record<Exclude<QuantityKind, 'currency'>, [string, string]> = {
  weeks: ['week', 'weeks'],
  nights: ['night', 'nights'],
  rounds: ['round', 'rounds'],
  count: ['item', 'items'],
};

function formatQuantity(kind: QuantityKind, value: number, signed = false): string {
  if (kind === 'currency') {
    const formatted = formatCurrency(Math.abs(value));
    if (!signed || value === 0) return value < 0 ? `−${formatted}` : formatted;
    return `${value > 0 ? '+' : '−'}${formatted}`;
  }

  const magnitude = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(magnitude);
  const [singular, plural] = QUANTITY_LABELS[kind];
  const label = magnitude === 1 ? singular : plural;
  const sign = signed && value !== 0 ? (value > 0 ? '+' : '−') : value < 0 ? '−' : '';
  return `${sign}${formatted} ${label}`;
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function DashboardPage({ onNavigate }: { onNavigate: (item: NavigationItem) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrorMessage(null);
      try {
        const result = await getDashboardData();
        if (!cancelled) setData(result);
      } catch (error) {
        if (!cancelled) {
          setData(null);
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load the dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const nextExpiration = data?.expirations[0] ?? null;
  const reconciliationOk = (data?.summary.unreconciledBenefits ?? 0) === 0;
  const totalOwnership = useMemo(
    () => data?.ownershipPositions.reduce((sum, row) => sum + row.ownershipPercentage, 0) ?? 0,
    [data],
  );

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        subtitle="Live membership balances, accounting health, expirations, and recent activity."
      />

      {loading && <section className="panel members-status"><p>Loading dashboard…</p></section>}
      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load dashboard</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
        </section>
      )}

      {!loading && !errorMessage && data && (
        <>
          <section className="metrics-grid dashboard-metrics" aria-label="Membership summary">
            <article className="metric-card">
              <span>Purchase price</span>
              <strong>{formatCurrency(data.membership.purchasePrice)}</strong>
              <small>{data.summary.activeMembers} active members across {data.summary.activeOwnershipUnits} ownership units</small>
            </article>
            <article className={`metric-card ${data.summary.pendingApprovals > 0 ? 'warning' : ''}`}>
              <span>Awaiting approval</span>
              <strong>{data.summary.pendingApprovals}</strong>
              <small>{data.summary.approvedTransactions30d} approved ledger entries in the last 30 days</small>
            </article>
            <article className={`metric-card ${nextExpiration ? 'warning' : ''}`}>
              <span>Next known expiration</span>
              <strong>{nextExpiration ? formatDate(nextExpiration.expirationDate) : 'None scheduled'}</strong>
              <small>{nextExpiration ? nextExpiration.benefitName : 'No active benefit has a future expiration date'}</small>
            </article>
            <article className={`metric-card ${reconciliationOk ? '' : 'warning'}`}>
              <span>Accounting control</span>
              <strong>{reconciliationOk ? 'Reconciled' : `${data.summary.unreconciledBenefits} review`}</strong>
              <small>{reconciliationOk ? 'All grant totals match ownership-unit positions' : 'Open Accounting to investigate differences'}</small>
            </article>
          </section>

          <section className="dashboard-quick-actions" aria-label="Quick actions">
            <button type="button" onClick={() => onNavigate('Transactions')}><strong>Add transaction</strong><span>Record benefit activity</span></button>
            <button type="button" onClick={() => onNavigate('Accounting')}><strong>Review accounting</strong><span>Owner positions & reconciliation</span></button>
            <button type="button" onClick={() => onNavigate('Reports')}><strong>Run reports</strong><span>CSV, Excel & PDF exports</span></button>
            <button type="button" onClick={() => onNavigate('Benefits')}><strong>Benefit catalog</strong><span>Inventory & restrictions</span></button>
          </section>

          <section className="panel">
            <div className="panel-heading dashboard-panel-heading">
              <div>
                <p className="eyebrow">Ownership</p>
                <h3>Family equity position</h3>
                <p>Live ownership configuration and current Golf positions. Shared activity counts are ledger-derived.</p>
              </div>
              <span className={`dashboard-control-badge ${Math.abs(totalOwnership - 100) < 0.0001 ? 'ok' : 'review'}`}>{totalOwnership.toFixed(4)}% ownership</span>
            </div>
            <div className="table-wrap">
              <table className="dashboard-ownership-table">
                <thead><tr><th>Ownership unit</th><th>Members</th><th>Ownership</th><th>Shared activity</th><th>Golf position</th></tr></thead>
                <tbody>
                  {data.ownershipPositions.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong></td>
                      <td>{row.membersDescription || `${row.activeMemberCount} active member${row.activeMemberCount === 1 ? '' : 's'}`}</td>
                      <td>{row.ownershipPercentage.toFixed(4)}%</td>
                      <td>{row.participatesInSharedPool ? `${row.sharedActivityCount} approved ledger entr${row.sharedActivityCount === 1 ? 'y' : 'ies'}` : 'Not participating'}</td>
                      <td>{row.participatesInGolfPool ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(row.golfRoundsPosition ?? 0)} rounds | ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(row.golfNightsPosition ?? 0)} nights` : 'Not participating'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dashboard-two-column">
            <section className="panel">
              <div className="panel-heading dashboard-panel-heading"><div><p className="eyebrow">Ledger</p><h3>Recent activity</h3><p>Latest transaction entries, including pending and corrective history.</p></div><button type="button" className="secondary-button" onClick={() => onNavigate('Transactions')}>View all</button></div>
              {data.recentActivity.length === 0 ? <div className="members-status"><p>No transaction activity yet.</p></div> : (
                <div className="table-wrap"><table className="dashboard-activity-table"><thead><tr><th>Date</th><th>Activity</th><th>Owner</th><th>Change</th><th>Status</th></tr></thead><tbody>
                  {data.recentActivity.map((row) => <tr key={row.id}><td>{formatDate(row.effectiveDate)}</td><td><strong>{row.benefitName}</strong><small>{row.transactionType}</small></td><td>{row.ownershipUnitName}</td><td className={row.quantityDelta < 0 ? 'quantity-negative' : row.quantityDelta > 0 ? 'quantity-positive' : ''}>{formatQuantity(row.quantityKind, row.quantityDelta, true)}</td><td><span className={`transaction-status transaction-status-${row.status}`}>{row.status}</span></td></tr>)}
                </tbody></table></div>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading dashboard-panel-heading"><div><p className="eyebrow">Expiration watch</p><h3>Upcoming expirations</h3><p>{data.summary.futureExpirations} active benefit{data.summary.futureExpirations === 1 ? '' : 's'} with a future expiration date.</p></div></div>
              {data.expirations.length === 0 ? <div className="members-status"><p>No future expirations are recorded.</p></div> : (
                <div className="dashboard-expiration-list">
                  {data.expirations.slice(0, 5).map((row) => <article key={row.benefitGrantId}><div><strong>{row.benefitName}</strong><span className={`pool-tag ${row.pool}`}>{row.pool === 'shared' ? 'Shared' : 'Golf'}</span></div><div><strong>{formatDate(row.expirationDate)}</strong><small>{formatQuantity(row.quantityKind, row.remainingQuantity)} remaining</small></div></article>)}
                </div>
              )}
            </section>
          </section>

          <section className="panel">
            <div className="panel-heading dashboard-panel-heading"><div><p className="eyebrow">Inventory</p><h3>Available membership benefits</h3><p>Authoritative remaining quantities from the approved append-only ledger.</p></div></div>
            <div className="benefit-grid">
              {data.benefits.map((benefit) => (
                <article className="benefit-card" key={benefit.id}>
                  <div className="benefit-title-row"><h4>{benefit.name}</h4><span className={`pool-tag ${benefit.pool}`}>{benefit.pool === 'shared' ? 'Shared' : 'Golf'}</span></div>
                  <dl><div><dt>Remaining</dt><dd>{formatQuantity(benefit.quantityKind, benefit.remainingQuantity)}</dd></div><div><dt>Original</dt><dd>{formatQuantity(benefit.quantityKind, benefit.originalQuantity)}</dd></div><div><dt>Expires</dt><dd>{benefit.expirationDate ? formatDate(benefit.expirationDate) : 'No expiration'}</dd></div></dl>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
