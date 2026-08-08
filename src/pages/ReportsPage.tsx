import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import {
  exportCsv,
  exportExcel,
  exportPdf,
  type ExportColumn,
} from '../services/exportService';
import {
  getReportingSnapshot,
  type AuditReportRow,
  type BenefitUsageReportRow,
  type MemberReportRow,
  type OwnershipReportRow,
  type PoolActivityReportRow,
  type ReportingSnapshot,
} from '../services/reportingService';
import type { QuantityKind } from '../services/benefitsService';

type ReportTab = 'members' | 'ownership' | 'benefit-usage' | 'pool-activity' | 'audit';

const REPORT_TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'members', label: 'Members' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'benefit-usage', label: 'Benefit usage' },
  { id: 'pool-activity', label: 'Pool activity' },
  { id: 'audit', label: 'Audit' },
];

function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgoLocal(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatQuantity(kind: QuantityKind, value: number): string {
  if (kind === 'currency') return formatCurrency(value);
  const labels: Record<Exclude<QuantityKind, 'currency'>, [string, string]> = {
    count: ['item', 'items'],
    nights: ['night', 'nights'],
    weeks: ['week', 'weeks'],
    rounds: ['round', 'rounds'],
  };
  const absolute = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(absolute);
  const [singular, plural] = labels[kind];
  const label = absolute === 1 ? singular : plural;
  return `${value < 0 ? '−' : value > 0 ? '+' : ''}${formatted} ${label}`;
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function jsonText(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const MEMBER_COLUMNS: ExportColumn<MemberReportRow>[] = [
  { header: 'First name', value: (row) => row.firstName },
  { header: 'Last name', value: (row) => row.lastName },
  { header: 'Preferred name', value: (row) => row.preferredName },
  { header: 'Ownership unit', value: (row) => row.ownershipUnitName },
  { header: 'Relationship', value: (row) => row.relationshipToPrimary },
  { header: 'Role', value: (row) => row.personRole },
  { header: 'Date of birth', value: (row) => row.dateOfBirth },
  { header: 'Shared pool', value: (row) => yesNo(row.participatesInSharedPool) },
  { header: 'Golf pool', value: (row) => yesNo(row.participatesInGolfPool) },
  { header: 'Active', value: (row) => yesNo(row.isActive && !row.archivedAt) },
];

const OWNERSHIP_COLUMNS: ExportColumn<OwnershipReportRow>[] = [
  { header: 'Ownership unit', value: (row) => row.name },
  { header: 'Ownership %', value: (row) => row.ownershipPercentage },
  { header: 'Active members', value: (row) => row.activeMemberCount },
  { header: 'Members', value: (row) => row.activeMembers },
  { header: 'Shared pool', value: (row) => yesNo(row.participatesInSharedPool) },
  { header: 'Golf pool', value: (row) => yesNo(row.participatesInGolfPool) },
  { header: 'Archived', value: (row) => yesNo(Boolean(row.archivedAt)) },
];

const USAGE_COLUMNS: ExportColumn<BenefitUsageReportRow>[] = [
  { header: 'Effective date', value: (row) => row.effectiveDate },
  { header: 'Type', value: (row) => row.transactionType },
  { header: 'Status', value: (row) => row.status },
  { header: 'Benefit', value: (row) => row.benefitName },
  { header: 'Pool', value: (row) => row.pool },
  { header: 'Ownership unit', value: (row) => row.ownershipUnitName },
  { header: 'Quantity kind', value: (row) => row.quantityKind },
  { header: 'Quantity change', value: (row) => row.quantityDelta },
  { header: 'Face value', value: (row) => row.faceValue },
  { header: 'Economic value', value: (row) => row.economicValue },
  { header: 'Notes', value: (row) => row.notes },
  { header: 'Source', value: (row) => row.sourceReference },
  { header: 'Approved at', value: (row) => row.approvedAt },
  { header: 'Voided at', value: (row) => row.voidedAt },
  { header: 'Transaction ID', value: (row) => row.id },
];

const POOL_COLUMNS: ExportColumn<PoolActivityReportRow>[] = [
  { header: 'Pool', value: (row) => row.pool },
  { header: 'Ownership unit', value: (row) => row.ownershipUnitName },
  { header: 'Quantity kind', value: (row) => row.quantityKind },
  { header: 'Approved transaction count', value: (row) => row.transactionCount },
  { header: 'Net quantity change', value: (row) => row.netQuantityDelta },
  { header: 'Use quantity', value: (row) => row.useQuantity },
  { header: 'Economic value recorded', value: (row) => row.economicValueRecorded },
];

const AUDIT_COLUMNS: ExportColumn<AuditReportRow>[] = [
  { header: 'Timestamp', value: (row) => row.createdAt },
  { header: 'Actor', value: (row) => row.actorName || row.actorId },
  { header: 'Action', value: (row) => row.action },
  { header: 'Entity type', value: (row) => row.entityType },
  { header: 'Entity ID', value: (row) => row.entityId },
  { header: 'Previous data', value: (row) => jsonText(row.previousData) },
  { header: 'New data', value: (row) => jsonText(row.newData) },
  { header: 'Audit ID', value: (row) => row.id },
];

function ReportExportButtons<T>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: T[];
  columns: ExportColumn<T>[];
}) {
  return (
    <div className="report-export-actions" aria-label={`${title} exports`}>
      <button type="button" className="secondary-button" disabled={rows.length === 0} onClick={() => exportCsv(title, rows, columns)}>CSV</button>
      <button type="button" className="secondary-button" disabled={rows.length === 0} onClick={() => exportExcel(title, rows, columns)}>Excel</button>
      <button type="button" className="secondary-button" disabled={rows.length === 0} onClick={() => exportPdf(title, rows, columns)}>PDF</button>
    </div>
  );
}

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('members');
  const [fromDate, setFromDate] = useState(daysAgoLocal(90));
  const [toDate, setToDate] = useState(todayLocal());
  const [snapshot, setSnapshot] = useState<ReportingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadReports(start: string, end: string) {
    setLoading(true);
    setErrorMessage(null);
    try {
      setSnapshot(await getReportingSnapshot(start, end));
    } catch (error) {
      setSnapshot(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports(fromDate, toDate);
    // Initial load only. Date changes apply when the user submits the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadReports(fromDate, toDate);
  }

  const dateRangeLabel = snapshot ? `${snapshot.fromDate}-to-${snapshot.toDate}` : `${fromDate}-to-${toDate}`;
  const activeCount = useMemo(
    () => snapshot?.members.filter((member) => member.isActive && !member.archivedAt).length ?? 0,
    [snapshot],
  );

  return (
    <>
      <PageHeader
        eyebrow="Reporting"
        title="Reports & exports"
        subtitle="Operational reports derived from the membership, ownership, benefit ledger, pool accounting, and audit history."
      />

      <section className="panel report-filter-panel">
        <div className="panel-heading reports-filter-heading">
          <div>
            <p className="eyebrow">Report controls</p>
            <h3>Activity date range</h3>
            <p>The date range applies to benefit usage, pool activity, and audit history. Member and ownership reports show the current roster.</p>
          </div>
          <form className="report-date-form" onSubmit={handleFilter}>
            <label className="form-field"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} required /></label>
            <label className="form-field"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} required /></label>
            <button type="submit" disabled={loading || !fromDate || !toDate}>{loading ? 'Loading…' : 'Run reports'}</button>
          </form>
        </div>
      </section>

      {loading && !snapshot && <section className="panel members-status"><p>Loading reports…</p></section>}
      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load reports</p><h3>Supabase returned an error</h3><p>{errorMessage}</p>
          <button type="button" className="secondary-button" onClick={() => void loadReports(fromDate, toDate)}>Try again</button>
        </section>
      )}

      {snapshot && !errorMessage && (
        <>
          <section className="metrics-grid reports-metrics" aria-label="Reporting summary">
            <article className="metric-card"><span>Active members</span><strong>{activeCount}</strong><small>{snapshot.ownership.length} ownership units</small></article>
            <article className="metric-card"><span>Ledger rows in range</span><strong>{snapshot.benefitUsage.length}</strong><small>{formatDate(snapshot.fromDate)} – {formatDate(snapshot.toDate)}</small></article>
            <article className="metric-card"><span>Pool activity groups</span><strong>{snapshot.poolActivity.length}</strong><small>Separated by pool, owner, and unit type</small></article>
            <article className="metric-card"><span>Audit access</span><strong>{snapshot.isAdmin ? 'Admin' : 'Restricted'}</strong><small>{snapshot.isAdmin ? `${snapshot.audit.length} audit events in range` : 'Audit report requires membership admin'}</small></article>
          </section>

          <div className="report-tabs" role="tablist" aria-label="Report type">
            {REPORT_TABS.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'report-tab active' : 'report-tab'} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
            ))}
          </div>

          {activeTab === 'members' && (
            <ReportPanel title="Member report" description="Current people roster, ownership assignment, role, and Shared/Golf eligibility." actions={<ReportExportButtons title="Palace Elite Member Report" rows={snapshot.members} columns={MEMBER_COLUMNS} />}>
              <div className="table-wrap"><table><thead><tr><th>Member</th><th>Ownership</th><th>Relationship</th><th>Role</th><th>Shared</th><th>Golf</th><th>Status</th></tr></thead><tbody>
                {snapshot.members.map((row) => <tr key={row.id}><td><strong>{row.preferredName || row.firstName} {row.lastName}</strong><small className="report-cell-subtext">{row.dateOfBirth ? `DOB ${formatDate(row.dateOfBirth)}` : ''}</small></td><td>{row.ownershipUnitName}</td><td>{row.relationshipToPrimary || '—'}</td><td>{row.personRole}</td><td>{yesNo(row.participatesInSharedPool)}</td><td>{yesNo(row.participatesInGolfPool)}</td><td><span className={`accounting-status ${row.isActive && !row.archivedAt ? 'accounting-status-ok' : 'accounting-status-review'}`}>{row.isActive && !row.archivedAt ? 'Active' : 'Inactive'}</span></td></tr>)}
              </tbody></table></div>
            </ReportPanel>
          )}

          {activeTab === 'ownership' && (
            <ReportPanel title="Ownership report" description="Ownership percentages, active members, and pool participation configuration." actions={<ReportExportButtons title="Palace Elite Ownership Report" rows={snapshot.ownership} columns={OWNERSHIP_COLUMNS} />}>
              <div className="table-wrap"><table><thead><tr><th>Ownership unit</th><th>Ownership</th><th>Active members</th><th>Members</th><th>Shared</th><th>Golf</th></tr></thead><tbody>
                {snapshot.ownership.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.ownershipPercentage.toFixed(4)}%</td><td>{row.activeMemberCount}</td><td>{row.activeMembers || row.membersDescription || '—'}</td><td>{yesNo(row.participatesInSharedPool)}</td><td>{yesNo(row.participatesInGolfPool)}</td></tr>)}
              </tbody></table></div>
            </ReportPanel>
          )}

          {activeTab === 'benefit-usage' && (
            <ReportPanel title="Benefit usage report" description="Ledger activity other than transfers. Adjustments, corrections, reversals, earns, and imports remain visible so usage history stays reconstructable." actions={<ReportExportButtons title={`Palace Elite Benefit Usage ${dateRangeLabel}`} rows={snapshot.benefitUsage} columns={USAGE_COLUMNS} />}>
              {snapshot.benefitUsage.length === 0 ? <EmptyReport /> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Benefit</th><th>Owner</th><th>Change</th><th>Status</th><th>Audit detail</th></tr></thead><tbody>
                {snapshot.benefitUsage.map((row) => <tr key={row.id}><td>{formatDate(row.effectiveDate)}</td><td><span className="transaction-type-tag">{row.transactionType}</span></td><td><strong>{row.benefitName}</strong><small className="report-cell-subtext">{row.pool === 'shared' ? 'Shared' : 'Golf'}</small></td><td>{row.ownershipUnitName}</td><td className={row.quantityDelta < 0 ? 'quantity-negative' : row.quantityDelta > 0 ? 'quantity-positive' : ''}>{formatQuantity(row.quantityKind, row.quantityDelta)}</td><td>{row.status}</td><td>{row.notes || row.sourceReference || '—'}</td></tr>)}
              </tbody></table></div>}
            </ReportPanel>
          )}

          {activeTab === 'pool-activity' && (
            <ReportPanel title="Pool activity report" description="Approved activity grouped without mixing Shared and Golf pools or unlike quantity units." actions={<ReportExportButtons title={`Palace Elite Pool Activity ${dateRangeLabel}`} rows={snapshot.poolActivity} columns={POOL_COLUMNS} />}>
              {snapshot.poolActivity.length === 0 ? <EmptyReport /> : <div className="table-wrap"><table><thead><tr><th>Pool</th><th>Ownership unit</th><th>Unit type</th><th>Approved entries</th><th>Use quantity</th><th>Net change</th><th>Economic value</th></tr></thead><tbody>
                {snapshot.poolActivity.map((row) => <tr key={`${row.pool}-${row.ownershipUnitName}-${row.quantityKind}`}><td><span className={`pool-tag ${row.pool}`}>{row.pool === 'shared' ? 'Shared' : 'Golf'}</span></td><td><strong>{row.ownershipUnitName}</strong></td><td>{row.quantityKind}</td><td>{row.transactionCount}</td><td>{formatQuantity(row.quantityKind, row.useQuantity).replace(/^\+/, '')}</td><td className={row.netQuantityDelta < 0 ? 'quantity-negative' : row.netQuantityDelta > 0 ? 'quantity-positive' : ''}>{formatQuantity(row.quantityKind, row.netQuantityDelta)}</td><td>{formatCurrency(row.economicValueRecorded)}</td></tr>)}
              </tbody></table></div>}
            </ReportPanel>
          )}

          {activeTab === 'audit' && (
            snapshot.isAdmin ? (
              <ReportPanel title="Audit report" description="Append-only membership audit events. Export files include the previous and new JSON snapshots for forensic review." actions={<ReportExportButtons title={`Palace Elite Audit ${dateRangeLabel}`} rows={snapshot.audit} columns={AUDIT_COLUMNS} />}>
                {snapshot.audit.length === 0 ? <EmptyReport /> : <div className="table-wrap"><table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
                  {snapshot.audit.map((row) => <tr key={row.id}><td>{formatDateTime(row.createdAt)}</td><td>{row.actorName || row.actorId || 'System'}</td><td><strong>{row.action}</strong></td><td>{row.entityType}<small className="report-cell-subtext">{row.entityId || ''}</small></td><td><details><summary>View change</summary><pre className="audit-json">{jsonText({ previous: row.previousData, current: row.newData })}</pre></details></td></tr>)}
                </tbody></table></div>}
              </ReportPanel>
            ) : (
              <section className="panel members-status"><p className="eyebrow">Admin only</p><h3>Audit report access is restricted.</h3><p>The existing audit-log RLS policy only permits membership administrators to read membership audit history.</p></section>
            )
          )}
        </>
      )}
    </>
  );
}

function ReportPanel({ title, description, actions, children }: { title: string; description: string; actions: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel report-panel"><div className="panel-heading report-panel-heading"><div><p className="eyebrow">Report</p><h3>{title}</h3><p>{description}</p></div>{actions}</div>{children}</section>;
}

function EmptyReport() {
  return <div className="members-status"><p className="eyebrow">No activity</p><h3>No rows matched this report range.</h3><p>Adjust the date range and run the reports again.</p></div>;
}
