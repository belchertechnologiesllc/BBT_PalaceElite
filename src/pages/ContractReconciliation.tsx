import { useEffect, useState } from 'react';
import { getVerificationFlags } from '../services/travelService';
import { getBenefitTransactionContext } from '../services/transactionsService';

const contract = [
  ['bpg_weeks', 'BPG Weeks / Preferential Stays', '100 weeks, including up to 70 nights converted from 10 weeks', '90 weeks / 70 nights'],
  ['imperial_grand_weeks', 'Imperial Grand Weeks', '2 weeks', '—'],
  ['incentive_stays', 'Incentive Stays', '4 stays', '4 weeks'],
  ['spa_resort_credit', 'Spa Resort Credit', '$3,740', '—'],
  ['universal_credit', 'Universal Credit', '$280', '—'],
  ['golf_rounds_50', 'Golf Rounds at 50%', '20 rounds', '—'],
  ['unlimited_golf_bonus_nights', 'Unlimited Golf Bonus Nights', '8 nights', '—'],
  ['', 'Portal Resort Credits', 'Unverified portal item', '$0'],
  ['', 'Presidential Collection', 'Unverified portal item', '1'],
] as const;

export function ContractReconciliation() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getBenefitTransactionContext>>>();
  const [error, setError] = useState('');
  const [flags, setFlags] = useState(new Map<string, boolean>());
  useEffect(() => {
    void getBenefitTransactionContext().then(async context => {
      setFlags(await getVerificationFlags(context.grants.map(grant => grant.id)));
      setData(context);
    }).catch((e: Error) => setError(e.message));
  }, []);
  return <section className="panel travel-panel">
    <h3>Contract and portal reconciliation</h3>
    <p>Affiliation 4135905 · VIP Silver · $35,700.00</p>
    <p>Preferential Stays are paid at a discounted rate. The snapshot’s 70 nights are within the 100-week contract allowance.</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ overflowX: 'auto' }}><table>
      <thead><tr><th>Benefit</th><th>Contract baseline</th><th>App inventory</th><th>Palace snapshot</th></tr></thead>
      <tbody>{contract.map(([code, name, baseline, portal]) => {
        const grant = data?.grants.find(item => item.benefitCode === code && !item.archivedAt);
        const activity = data?.transactions.filter(row => row.benefitGrantId === grant?.id && row.status === 'approved')
          .reduce((sum, row) => sum + row.quantityDelta, 0) ?? 0;
        return <tr key={name}><th scope="row">{name}</th><td>{baseline}{grant && flags.get(grant.id) ? ' · verification pending' : ''}</td>
          <td>{grant ? `${(grant.originalQuantity + activity).toLocaleString()} ${grant.quantityKind === 'currency' ? 'USD' : grant.quantityKind} · ${grant.pool}` : '—'}</td><td>{portal}</td></tr>;
      })}</tbody>
    </table></div>
  </section>;
}
