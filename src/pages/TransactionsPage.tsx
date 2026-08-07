import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { SlideOver } from '../components/forms/SlideOver';
import {
  approveBenefitTransaction,
  cancelBenefitTransaction,
  createBenefitTransaction,
  createBenefitTransfer,
  getBenefitTransactionContext,
  reverseBenefitTransaction,
  type BenefitTransactionContext,
  type BenefitTransactionRecord,
  type BenefitTransactionType,
  type TransactionDirection,
  type TransactionOwnershipUnit,
} from '../services/transactionsService';
import type { BenefitGrantRecord, QuantityKind } from '../services/benefitsService';

const TRANSACTION_FORM_ID = 'benefit-transaction-form';
const REASON_FORM_ID = 'benefit-transaction-reason-form';

const TYPE_LABELS: Record<BenefitTransactionType, string> = {
  earn: 'Earn',
  use: 'Use',
  adjustment: 'Adjustment',
  transfer: 'Transfer',
  correction: 'Correction',
  reversal: 'Reversal',
  import: 'Import',
};

const STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  voided: 'Cancelled',
} as const;

type FormType = Exclude<BenefitTransactionType, 'reversal'>;

type TransactionFormState = {
  transactionType: FormType;
  benefitGrantId: string;
  ownershipUnitId: string;
  toOwnershipUnitId: string;
  quantity: string;
  direction: TransactionDirection;
  effectiveDate: string;
  notes: string;
  sourceReference: string;
};

type ReasonAction = {
  kind: 'reverse' | 'cancel';
  transaction: BenefitTransactionRecord;
} | null;

function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialForm(grantId = '', unitId = ''): TransactionFormState {
  return {
    transactionType: 'use',
    benefitGrantId: grantId,
    ownershipUnitId: unitId,
    toOwnershipUnitId: '',
    quantity: '',
    direction: 'decrease',
    effectiveDate: todayLocal(),
    notes: '',
    sourceReference: '',
  };
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

function quantityLabel(kind: QuantityKind, value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const magnitude = Math.abs(value);

  if (kind === 'currency') {
    return `${sign}${new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(magnitude)}`;
  }

  const labels: Record<Exclude<QuantityKind, 'currency'>, [string, string]> = {
    count: ['item', 'items'],
    nights: ['night', 'nights'],
    weeks: ['week', 'weeks'],
    rounds: ['round', 'rounds'],
  };
  const [singular, plural] = labels[kind];
  return `${sign}${magnitude} ${magnitude === 1 ? singular : plural}`;
}

function isUnitEligible(unit: TransactionOwnershipUnit, grant: BenefitGrantRecord): boolean {
  return grant.pool === 'shared'
    ? unit.participatesInSharedPool
    : unit.participatesInGolfPool;
}

export function TransactionsPage() {
  const [context, setContext] = useState<BenefitTransactionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [correctionSource, setCorrectionSource] = useState<BenefitTransactionRecord | null>(null);
  const [form, setForm] = useState<TransactionFormState>(initialForm());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      setContext(await getBenefitTransactionContext());
    } catch (error) {
      setContext(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load transactions.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshContext = useCallback(async () => {
    setContext(await getBenefitTransactionContext());
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!successToast) return;
    const timeoutId = window.setTimeout(() => setSuccessToast(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [successToast]);

  const selectedGrant = useMemo(
    () => context?.grants.find((grant) => grant.id === form.benefitGrantId) ?? null,
    [context, form.benefitGrantId],
  );

  const eligibleUnits = useMemo(() => {
    if (!context || !selectedGrant) return [];
    return context.ownershipUnits.filter((unit) => isUnitEligible(unit, selectedGrant));
  }, [context, selectedGrant]);

  const approvedCount = context?.transactions.filter((row) => row.status === 'approved').length ?? 0;
  const awaitingCount = context?.transactions.filter((row) => row.status === 'draft' || row.status === 'submitted').length ?? 0;

  function openCreate() {
    if (!context) return;
    const firstGrant = context.grants[0];
    const firstUnit = firstGrant
      ? context.ownershipUnits.find((unit) => isUnitEligible(unit, firstGrant))
      : undefined;
    setCorrectionSource(null);
    setForm(initialForm(firstGrant?.id ?? '', firstUnit?.id ?? ''));
    setFormError(null);
    setIsCreateOpen(true);
  }

  function openCorrection(transaction: BenefitTransactionRecord) {
    setCorrectionSource(transaction);
    setForm({
      ...initialForm(transaction.benefitGrantId, transaction.ownershipUnitId),
      transactionType: 'correction',
      direction: 'increase',
    });
    setFormError(null);
    setIsCreateOpen(true);
  }

  function closeCreate() {
    if (submitting) return;
    setIsCreateOpen(false);
    setCorrectionSource(null);
    setFormError(null);
  }

  function changeGrant(grantId: string) {
    if (!context) return;
    const grant = context.grants.find((candidate) => candidate.id === grantId);
    const firstEligible = grant
      ? context.ownershipUnits.find((unit) => isUnitEligible(unit, grant))
      : undefined;
    setForm((current) => ({
      ...current,
      benefitGrantId: grantId,
      ownershipUnitId: firstEligible?.id ?? '',
      toOwnershipUnitId: '',
    }));
  }

  function changeType(transactionType: FormType) {
    setForm((current) => ({
      ...current,
      transactionType,
      direction: transactionType === 'earn' ? 'increase' : 'decrease',
      toOwnershipUnitId: '',
    }));
  }

  const parsedQuantity = Number(form.quantity);
  const requiresDirection = ['adjustment', 'correction', 'import'].includes(form.transactionType);
  const requiresNotes = ['adjustment', 'correction'].includes(form.transactionType);
  const canSubmit =
    Boolean(context && selectedGrant && form.ownershipUnitId && form.effectiveDate) &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (!requiresNotes || form.notes.trim().length > 0) &&
    (form.transactionType !== 'import' || form.sourceReference.trim().length > 0) &&
    (form.transactionType !== 'transfer' || (
      form.toOwnershipUnitId.length > 0 && form.toOwnershipUnitId !== form.ownershipUnitId
    )) &&
    !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !canSubmit) return;

    setSubmitting(true);
    setFormError(null);
    try {
      if (form.transactionType === 'transfer') {
        await createBenefitTransfer({
          membershipId: context.membership.id,
          benefitGrantId: form.benefitGrantId,
          fromOwnershipUnitId: form.ownershipUnitId,
          toOwnershipUnitId: form.toOwnershipUnitId,
          quantity: parsedQuantity,
          effectiveDate: form.effectiveDate,
          notes: form.notes,
          sourceReference: form.sourceReference,
        });
      } else {
        await createBenefitTransaction({
          membershipId: context.membership.id,
          ownershipUnitId: form.ownershipUnitId,
          benefitGrantId: form.benefitGrantId,
          transactionType: form.transactionType,
          quantity: parsedQuantity,
          direction: requiresDirection ? form.direction : undefined,
          effectiveDate: form.effectiveDate,
          notes: form.notes,
          sourceReference: form.sourceReference,
          relatedTransactionId: correctionSource?.id ?? null,
        });
      }

      setIsCreateOpen(false);
      setCorrectionSource(null);
      setSuccessToast('Transaction submitted for approval.');
      await refreshContext();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save the transaction.');
    } finally {
      setSubmitting(false);
    }
  }

  async function approve(transaction: BenefitTransactionRecord) {
    setActionBusyId(transaction.id);
    setErrorMessage(null);
    try {
      await approveBenefitTransaction(transaction.id);
      setSuccessToast('Transaction approved.');
      await refreshContext();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to approve transaction.');
    } finally {
      setActionBusyId(null);
    }
  }

  function openReasonAction(kind: 'reverse' | 'cancel', transaction: BenefitTransactionRecord) {
    setReasonAction({ kind, transaction });
    setReason('');
    setReasonError(null);
  }

  function closeReasonAction() {
    if (actionBusyId) return;
    setReasonAction(null);
    setReason('');
    setReasonError(null);
  }

  async function submitReasonAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonAction || reason.trim().length === 0) return;

    const transaction = reasonAction.transaction;
    setActionBusyId(transaction.id);
    setReasonError(null);
    try {
      if (reasonAction.kind === 'reverse') {
        await reverseBenefitTransaction(transaction.id, reason);
        setSuccessToast('Reversal submitted for approval.');
      } else {
        await cancelBenefitTransaction(transaction.id, reason);
        setSuccessToast('Pending transaction cancelled.');
      }
      setReasonAction(null);
      setReason('');
      await refreshContext();
    } catch (error) {
      setReasonError(error instanceof Error ? error.message : 'Unable to update transaction.');
    } finally {
      setActionBusyId(null);
    }
  }

  const eventOptions: Array<{ value: FormType; label: string }> = context?.isAdmin
    ? [
        { value: 'use', label: 'Use benefit' },
        { value: 'earn', label: 'Earn / add benefit' },
        { value: 'adjustment', label: 'Adjustment' },
        { value: 'import', label: 'Import historical activity' },
        { value: 'transfer', label: 'Transfer between owners' },
      ]
    : [{ value: 'use', label: 'Use benefit' }];

  return (
    <>
      <PageHeader
        eyebrow="Benefit Accounting"
        title="Transactions"
        subtitle="Record benefit activity without rewriting history. Shared and Golf accounting remain separate."
        actions={
          <button type="button" className="primary-button" disabled={!context} onClick={openCreate}>
            Add transaction
          </button>
        }
      />

      {successToast && (
        <div className="success-toast" role="status">
          <span>{successToast}</span>
          <button type="button" className="success-toast-close" aria-label="Dismiss" onClick={() => setSuccessToast(null)}>✕</button>
        </div>
      )}

      <SlideOver
        open={isCreateOpen}
        title={correctionSource ? 'Correct transaction' : 'Add transaction'}
        width="md"
        onClose={closeCreate}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={closeCreate} disabled={submitting}>Cancel</button>
            <button type="submit" className="primary-button" form={TRANSACTION_FORM_ID} disabled={!canSubmit}>
              {submitting ? 'Submitting...' : 'Submit for approval'}
            </button>
          </>
        }
      >
        <form id={TRANSACTION_FORM_ID} className="transaction-form" onSubmit={handleSubmit}>
          {correctionSource ? (
            <div className="form-message transaction-source-summary">
              <strong>Correcting {TYPE_LABELS[correctionSource.transactionType]}</strong>
              <span>{correctionSource.benefitName} · {correctionSource.ownershipUnitName} · {quantityLabel(correctionSource.quantityKind, correctionSource.quantityDelta)}</span>
              <small>The original approved row stays intact. This correction adds a new compensating ledger entry.</small>
            </div>
          ) : (
            <label className="form-field">
              <span>Transaction type</span>
              <select value={form.transactionType} onChange={(event) => changeType(event.target.value as FormType)}>
                {eventOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}

          <label className="form-field">
            <span>Benefit</span>
            <select value={form.benefitGrantId} disabled={Boolean(correctionSource)} onChange={(event) => changeGrant(event.target.value)} required>
              <option value="" disabled>Select a benefit</option>
              {context?.grants.map((grant) => (
                <option key={grant.id} value={grant.id}>{grant.name} ({grant.pool === 'shared' ? 'Shared' : 'Golf'})</option>
              ))}
            </select>
          </label>

          <div className="form-grid two-column">
            <label className="form-field">
              <span>{form.transactionType === 'transfer' ? 'From owner' : 'Ownership unit'}</span>
              <select value={form.ownershipUnitId} disabled={Boolean(correctionSource)} onChange={(event) => setForm((current) => ({ ...current, ownershipUnitId: event.target.value, toOwnershipUnitId: current.toOwnershipUnitId === event.target.value ? '' : current.toOwnershipUnitId }))} required>
                <option value="" disabled>Select an owner</option>
                {eligibleUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>

            {form.transactionType === 'transfer' ? (
              <label className="form-field">
                <span>To owner</span>
                <select value={form.toOwnershipUnitId} onChange={(event) => setForm((current) => ({ ...current, toOwnershipUnitId: event.target.value }))} required>
                  <option value="" disabled>Select an owner</option>
                  {eligibleUnits.filter((unit) => unit.id !== form.ownershipUnitId).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="form-field">
                <span>Effective date</span>
                <input type="date" value={form.effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} required />
              </label>
            )}
          </div>

          {form.transactionType === 'transfer' && (
            <label className="form-field">
              <span>Effective date</span>
              <input type="date" value={form.effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} required />
            </label>
          )}

          <div className={`form-grid ${requiresDirection ? 'two-column' : ''}`}>
            {requiresDirection && (
              <label className="form-field">
                <span>Direction</span>
                <select value={form.direction} onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value as TransactionDirection }))}>
                  <option value="increase">Increase balance</option>
                  <option value="decrease">Decrease balance</option>
                </select>
              </label>
            )}
            <label className="form-field">
              <span>Quantity{selectedGrant ? ` (${selectedGrant.quantityKind})` : ''}</span>
              <input type="number" min="0" step="any" inputMode="decimal" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} required />
            </label>
          </div>

          <label className="form-field">
            <span>Notes{requiresNotes ? ' (required)' : ''}</span>
            <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} required={requiresNotes} placeholder={form.transactionType === 'correction' ? 'Explain what is being corrected and why.' : 'Optional context for the audit trail'} />
          </label>

          <label className="form-field">
            <span>Source reference{form.transactionType === 'import' ? ' (required)' : ''}</span>
            <input type="text" value={form.sourceReference} onChange={(event) => setForm((current) => ({ ...current, sourceReference: event.target.value }))} required={form.transactionType === 'import'} placeholder="Reservation, statement, invoice, or import reference" />
          </label>

          {formError && <p className="error-message" role="alert">{formError}</p>}
        </form>
      </SlideOver>

      <SlideOver
        open={Boolean(reasonAction)}
        title={reasonAction?.kind === 'reverse' ? 'Reverse transaction' : 'Cancel pending transaction'}
        width="sm"
        onClose={closeReasonAction}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={closeReasonAction} disabled={Boolean(actionBusyId)}>Keep transaction</button>
            <button type="submit" className="primary-button" form={REASON_FORM_ID} disabled={reason.trim().length === 0 || Boolean(actionBusyId)}>
              {actionBusyId ? 'Saving...' : reasonAction?.kind === 'reverse' ? 'Create reversal' : 'Cancel transaction'}
            </button>
          </>
        }
      >
        <form id={REASON_FORM_ID} className="transaction-form" onSubmit={submitReasonAction}>
          {reasonAction && (
            <div className="form-message transaction-source-summary">
              <strong>{reasonAction.transaction.benefitName}</strong>
              <span>{reasonAction.transaction.ownershipUnitName} · {quantityLabel(reasonAction.transaction.quantityKind, reasonAction.transaction.quantityDelta)}</span>
            </div>
          )}
          <label className="form-field">
            <span>Reason</span>
            <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Describe why this ledger action is necessary." />
          </label>
          {reasonAction?.kind === 'reverse' && <p className="transaction-help">The approved transaction will remain in history. A new inverse transaction will be created and must be approved.</p>}
          {reasonError && <p className="error-message" role="alert">{reasonError}</p>}
        </form>
      </SlideOver>

      {loading && <section className="panel members-status"><p>Loading transactions...</p></section>}

      {!loading && errorMessage && (
        <section className="panel members-status error-state" role="alert">
          <p className="eyebrow">Unable to load transactions</p>
          <h3>Supabase returned an error</h3>
          <p>{errorMessage}</p>
          <button type="button" className="secondary-button" onClick={() => void loadContext()}>Try again</button>
        </section>
      )}

      {!loading && !errorMessage && context && (
        <>
          <section className="metrics-grid transaction-metrics" aria-label="Transaction summary">
            <article className="metric-card"><span>Approved</span><strong>{approvedCount}</strong><small>Ledger entries affecting balances</small></article>
            <article className={`metric-card ${awaitingCount > 0 ? 'warning' : ''}`}><span>Awaiting approval</span><strong>{awaitingCount}</strong><small>Submitted or draft entries</small></article>
            <article className="metric-card"><span>Total history</span><strong>{context.transactions.length}</strong><small>Includes cancelled and corrective entries</small></article>
          </section>

          <section className="panel">
            <div className="panel-heading transaction-panel-heading">
              <div>
                <p className="eyebrow">Ledger</p>
                <h3>Benefit activity</h3>
                <p>Approved entries change balances. Corrections and reversals are appended rather than editing prior accounting.</p>
              </div>
            </div>

            {context.transactions.length === 0 ? (
              <div className="members-status transaction-empty">
                <p className="eyebrow">No transactions</p>
                <h3>No benefit activity has been recorded yet.</h3>
                <p>Use “Add transaction” to submit the first benefit use or administrative ledger entry.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="transaction-table">
                  <thead><tr><th>Date</th><th>Type</th><th>Benefit</th><th>Owner</th><th>Change</th><th>Status</th><th>Audit detail</th><th>Actions</th></tr></thead>
                  <tbody>
                    {context.transactions.map((transaction) => {
                      const pending = transaction.status === 'draft' || transaction.status === 'submitted';
                      const busy = actionBusyId === transaction.id;
                      return (
                        <tr key={transaction.id}>
                          <td className="transaction-nowrap">{formatDate(transaction.effectiveDate)}</td>
                          <td><span className={`transaction-type transaction-type-${transaction.transactionType}`}>{TYPE_LABELS[transaction.transactionType]}</span></td>
                          <td><strong>{transaction.benefitName}</strong><span className={`pool-tag ${transaction.benefitPool}`}>{transaction.benefitPool === 'shared' ? 'Shared' : 'Golf'}</span></td>
                          <td>{transaction.ownershipUnitName}</td>
                          <td className={transaction.quantityDelta >= 0 ? 'quantity-positive' : 'quantity-negative'}><strong>{quantityLabel(transaction.quantityKind, transaction.quantityDelta)}</strong></td>
                          <td><span className={`transaction-status transaction-status-${transaction.status}`}>{STATUS_LABELS[transaction.status]}</span></td>
                          <td className="transaction-audit-detail">
                            {transaction.notes && <span>{transaction.notes}</span>}
                            {transaction.sourceReference && <small>Source: {transaction.sourceReference}</small>}
                            {transaction.transactionGroupId && <small>Grouped transfer</small>}
                            {transaction.relatedTransactionId && <small>Linked corrective entry</small>}
                          </td>
                          <td>
                            <div className="transaction-actions">
                              {context.isAdmin && pending && <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => void approve(transaction)}>Approve</button>}
                              {context.isAdmin && pending && <button type="button" className="text-button danger-text" disabled={busy} onClick={() => openReasonAction('cancel', transaction)}>Cancel</button>}
                              {context.isAdmin && transaction.status === 'approved' && transaction.transactionType !== 'transfer' && transaction.transactionType !== 'reversal' && <button type="button" className="text-button" disabled={busy} onClick={() => openCorrection(transaction)}>Correct</button>}
                              {context.isAdmin && transaction.status === 'approved' && transaction.transactionType !== 'reversal' && <button type="button" className="text-button danger-text" disabled={busy} onClick={() => openReasonAction('reverse', transaction)}>Reverse</button>}
                              {!context.isAdmin && !pending && <span className="transaction-help">—</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
