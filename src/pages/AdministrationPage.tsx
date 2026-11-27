import { useEffect, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { getBenefitTransactionContext } from '../services/transactionsService';
import { getVerificationFlags, reseedContract, setVerificationFlag } from '../services/travelService';

export function AdministrationPage({ openBenefits }: { openBenefits: () => void }) {
  const [context, setContext] = useState<Awaited<ReturnType<typeof getBenefitTransactionContext>>>();
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [flags, setFlags] = useState(new Map<string, boolean>());
  useEffect(() => { void getBenefitTransactionContext().then(async result => {
    if (result.isAdmin) setFlags(await getVerificationFlags(result.grants.map(grant => grant.id)));
    setContext(result);
  })
    .catch((error: Error) => setMessage(error.message)); }, []);
  return <>
    <PageHeader title="Administration" subtitle="Contract baseline and benefit administration" />
    {message && <p role="status">{message}</p>}
    {!context && !message && <p>Loading…</p>}
    {context && !context.isAdmin && <p>Membership administrator access is required.</p>}
    {context?.isAdmin && <section className="panel travel-panel">
      <h3>Affiliation 4135905 · VIP Silver</h3>
      <p>Contract purchase price $35,700.00</p>
      <p>Four are tracked after correcting the prior allocation of six. Two release March 29, 2029 and two release March 29, 2031.</p>
      <button className="secondary-button" onClick={openBenefits}>Open benefit administration</button>
      <h3>Benefit verification</h3>
      {context.grants.filter(grant => !grant.archivedAt).map(grant =>
        <label className="travel-row" key={grant.id}>
          <span>{grant.name} · {grant.originalQuantity} {grant.quantityKind}</span>
          <span><input type="checkbox" checked={flags.get(grant.id) ?? false} disabled={busy}
            onChange={event => {
              const pending = event.target.checked;
              setBusy(true);
              void setVerificationFlag(grant.id, pending).then(() => {
                setFlags(previous => new Map(previous).set(grant.id, pending));
                setMessage('Verification flag updated.');
              }).catch((error: Error) => setMessage(error.message)).finally(() => setBusy(false));
            }} /> Verification pending</span>
        </label>)}
      <h3>Reseed contract correction</h3>
      <p>Reapplies the Incentive Stays baseline correction and records an audit event. Ledger activity is preserved.</p>
      <form className="travel-toolbar" onSubmit={event => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        void reseedContract(context.membership.id, confirmation).then(() => {
          setConfirmation('');
          setMessage('Contract reseed recorded in the audit log.');
        }).catch((error: Error) => setMessage(error.message)).finally(() => setBusy(false));
      }}>
        <label className="form-field">Type RESEED 4135905 to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <button className="secondary-button" disabled={busy || confirmation !== 'RESEED 4135905'}>Reseed</button>
      </form>
    </section>}
  </>;
}
