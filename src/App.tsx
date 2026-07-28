import { LoginScreen } from './auth/LoginScreen';
import { useAuth } from './auth/AuthProvider';

type OwnershipUnit = {
  name: string;
  members: string;
  sharedValue: number;
  golfRoundsUsed: number | null;
  golfNightsUsed: number | null;
};

type Benefit = {
  name: string;
  pool: 'Shared' | 'Golf';
  original: string;
  remaining: string;
  expires: string;
};

const units: OwnershipUnit[] = [
  { name: 'Belcher', members: 'Anthony, Kristin, and children', sharedValue: 0, golfRoundsUsed: 0, golfNightsUsed: 0 },
  { name: 'Belcher Sr.', members: 'Mike and Theresa', sharedValue: 0, golfRoundsUsed: 0, golfNightsUsed: 0 },
  { name: 'Tatro', members: 'Larry, spouse, and adult son', sharedValue: 0, golfRoundsUsed: null, golfNightsUsed: null },
];

const benefits: Benefit[] = [
  { name: 'BPG Weeks', pool: 'Shared', original: '100 weeks', remaining: '100 weeks', expires: 'Mar 29, 2051' },
  { name: 'Incentive Stays', pool: 'Shared', original: '6 stays', remaining: '6 stays', expires: 'Various' },
  { name: 'Imperial Grand Weeks', pool: 'Shared', original: '2 weeks', remaining: '2 weeks', expires: 'Mar 29, 2031' },
  { name: 'Spa Resort Credit', pool: 'Shared', original: '$3,740', remaining: '$3,740', expires: 'Mar 29, 2031' },
  { name: 'Universal Credit', pool: 'Shared', original: '$280', remaining: '$280', expires: 'Mar 29, 2029' },
  { name: 'Golf Rounds at 50%', pool: 'Golf', original: '20 rounds', remaining: '20 rounds', expires: 'No date listed' },
  { name: 'Unlimited Golf Bonus Nights', pool: 'Golf', original: '8 nights', remaining: '8 nights', expires: 'Mar 29, 2031' },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function App() {
  const { configured, loading, user, signOut } = useAuth();
  const totalSharedValue = units.reduce((sum, unit) => sum + unit.sharedValue, 0);

  if (loading) return <main className="login-shell"><p>Loading membership…</p></main>;
  if (configured && !user) return <LoginScreen />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Affiliation 4135905</p>
          <h1>Palace Elite Membership Manager</h1>
          <p className="subtitle">Shared benefit inventory, usage ledger, and family equity tracking.</p>
        </div>
        <div className="account-area">
          <span className="status-badge">{configured ? 'Supabase connected' : 'Demo data'}</span>
          {user && <button className="secondary-button" type="button" onClick={() => void signOut()}>Sign out</button>}
        </div>
      </header>

      <main>
        <section className="metrics-grid" aria-label="Membership summary">
          <article className="metric-card"><span>Purchase price</span><strong>$35,700</strong><small>$11,900 per ownership unit</small></article>
          <article className="metric-card"><span>Shared value recorded</span><strong>{formatCurrency(totalSharedValue)}</strong><small>Economic value, not cash owed</small></article>
          <article className="metric-card warning"><span>Next known expiration</span><strong>Mar 29, 2029</strong><small>Universal Credit and select promotions</small></article>
          <article className="metric-card"><span>Open reservations</span><strong>0</strong><small>No trips entered yet</small></article>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Ownership</p><h2>Family equity position</h2></div>
            <button type="button" disabled>Add transaction</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ownership unit</th><th>Members</th><th>Shared value received</th><th>Golf allocation</th></tr></thead>
              <tbody>{units.map((unit) => (
                <tr key={unit.name}>
                  <td><strong>{unit.name}</strong></td><td>{unit.members}</td><td>{formatCurrency(unit.sharedValue)}</td>
                  <td>{unit.golfRoundsUsed === null ? 'Not participating' : `${unit.golfRoundsUsed}/10 rounds · ${unit.golfNightsUsed}/4 nights`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Inventory</p><h2>Available membership benefits</h2></div></div>
          <div className="benefit-grid">{benefits.map((benefit) => (
            <article className="benefit-card" key={benefit.name}>
              <div className="benefit-title-row"><h3>{benefit.name}</h3><span className={`pool-tag ${benefit.pool.toLowerCase()}`}>{benefit.pool}</span></div>
              <dl><div><dt>Remaining</dt><dd>{benefit.remaining}</dd></div><div><dt>Original</dt><dd>{benefit.original}</dd></div><div><dt>Expires</dt><dd>{benefit.expires}</dd></div></dl>
            </article>
          ))}</div>
        </section>
      </main>
    </div>
  );
}
