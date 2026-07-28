import { useMemo, useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useAuth } from './auth/AuthProvider';

type NavigationItem = 'Dashboard' | 'Members' | 'Benefits' | 'Transactions' | 'Reservations' | 'Profile' | 'Administration';

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

const navigationItems: NavigationItem[] = [
  'Dashboard',
  'Members',
  'Benefits',
  'Transactions',
  'Reservations',
  'Profile',
  'Administration',
];

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
    members: 'Larry, spouse, and adult son',
    sharedValue: 0,
    golfRoundsUsed: null,
    golfNightsUsed: null,
  },
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

function Dashboard() {
  const totalSharedValue = useMemo(
    () => units.reduce((sum, unit) => sum + unit.sharedValue, 0),
    [],
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Dashboard</h2>
          <p className="subtitle">Current membership position and benefit availability.</p>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Membership summary">
        <article className="metric-card">
          <span>Purchase price</span>
          <strong>$35,700</strong>
          <small>$11,900 per ownership unit</small>
        </article>
        <article className="metric-card">
          <span>Shared value recorded</span>
          <strong>{formatCurrency(totalSharedValue)}</strong>
          <small>Economic value, not cash owed</small>
        </article>
        <article className="metric-card warning">
          <span>Next known expiration</span>
          <strong>Mar 29, 2029</strong>
          <small>Universal Credit and select promotions</small>
        </article>
        <article className="metric-card">
          <span>Open reservations</span>
          <strong>0</strong>
          <small>No trips entered yet</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ownership</p>
            <h3>Family equity position</h3>
          </div>
          <button type="button" disabled>Add transaction</button>
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
                  <td><strong>{unit.name}</strong></td>
                  <td>{unit.members}</td>
                  <td>{formatCurrency(unit.sharedValue)}</td>
                  <td>
                    {unit.golfRoundsUsed === null
                      ? 'Not participating'
                      : `${unit.golfRoundsUsed}/10 rounds · ${unit.golfNightsUsed}/4 nights`}
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

        <div className="benefit-grid">
          {benefits.map((benefit) => (
            <article className="benefit-card" key={benefit.name}>
              <div className="benefit-title-row">
                <h4>{benefit.name}</h4>
                <span className={`pool-tag ${benefit.pool.toLowerCase()}`}>{benefit.pool}</span>
              </div>
              <dl>
                <div><dt>Remaining</dt><dd>{benefit.remaining}</dd></div>
                <div><dt>Original</dt><dd>{benefit.original}</dd></div>
                <div><dt>Expires</dt><dd>{benefit.expires}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}


function ProfilePage() {
  const { user } = useAuth();
  const displayName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : user?.email?.split('@')[0] ?? 'Palace Elite user';

  const createdAt = user?.created_at
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(user.created_at))
    : 'Unavailable';

  const lastSignIn = user?.last_sign_in_at
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(user.last_sign_in_at))
    : 'Unavailable';

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>Profile</h2>
          <p className="subtitle">Your authenticated Palace Elite account.</p>
        </div>
      </section>

      <section className="profile-grid">
        <article className="panel profile-card">
          <div className="profile-avatar" aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="eyebrow">Signed-in user</p>
            <h3>{displayName}</h3>
            <p>{user?.email ?? 'No email available'}</p>
          </div>
        </article>

        <article className="panel account-details">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Supabase Authentication</p>
              <h3>Account details</h3>
            </div>
          </div>
          <dl className="details-list">
            <div><dt>Email</dt><dd>{user?.email ?? 'Unavailable'}</dd></div>
            <div><dt>User ID</dt><dd className="monospace">{user?.id ?? 'Unavailable'}</dd></div>
            <div><dt>Account created</dt><dd>{createdAt}</dd></div>
            <div><dt>Last sign-in</dt><dd>{lastSignIn}</dd></div>
            <div><dt>Email confirmed</dt><dd>{user?.email_confirmed_at ? 'Yes' : 'No'}</dd></div>
          </dl>
        </article>
      </section>
    </>
  );
}

function PlaceholderPage({ page }: { page: NavigationItem }) {
  const descriptions: Record<NavigationItem, string> = {
    Dashboard: '',
    Members: 'Manage ownership units, household members, and participation eligibility.',
    Benefits: 'Review shared and golf benefit pools, balances, and expiration dates.',
    Transactions: 'Record benefit activity while preserving the complete audit history.',
    Reservations: 'Track planned stays, confirmations, travelers, and benefit usage.',
    Profile: 'Review your authenticated account and session details.',
    Administration: 'Manage application users, roles, and system configuration.',
  };

  return (
    <section className="placeholder-panel">
      <p className="eyebrow">Phase 1 navigation</p>
      <h2>{page}</h2>
      <p>{descriptions[page]}</p>
      <span>This page will be implemented in a later phase.</span>
    </section>
  );
}

export default function App() {
  const { configured, loading, user, signOut } = useAuth();
  const [activePage, setActivePage] = useState<NavigationItem>('Dashboard');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (loading) {
    return (
      <main className="login-shell">
        <p>Loading membership…</p>
      </main>
    );
  }

  if (configured && !user) {
    return <LoginScreen />;
  }

  const handleNavigation = (item: NavigationItem) => {
    setActivePage(item);
    setNavigationOpen(false);
  };

  const handleSignOut = async () => {
    setSignOutError(null);

    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  };

  return (
    <div className="workspace">
      <aside className={`sidebar ${navigationOpen ? 'open' : ''}`}>
        <div className="brand-block">
          <p className="eyebrow">Affiliation 4135905</p>
          <h1>Palace Elite</h1>
          <p>Membership Manager</p>
        </div>

        <nav aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <button
              key={item}
              type="button"
              className={activePage === item ? 'nav-item active' : 'nav-item'}
              onClick={() => handleNavigation(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-badge">{configured ? 'Supabase connected' : 'Demo data'}</span>
        </div>
      </aside>

      {navigationOpen && (
        <button
          className="navigation-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavigationOpen(false)}
        />
      )}

      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="menu-button"
              type="button"
              aria-label="Open navigation"
              onClick={() => setNavigationOpen(true)}
            >
              ☰
            </button>
            <div>
              <strong>{activePage}</strong>
              <span>Palace Elite Membership Manager</span>
            </div>
          </div>

          <div className="account-area">
            <div className="user-summary">
              <span>Signed in as</span>
              <strong>{user?.email ?? 'Demo user'}</strong>
            </div>
            {user && (
              <button className="secondary-button" type="button" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            )}
          </div>
        </header>

        {signOutError && (
          <p className="global-error" role="alert">{signOutError}</p>
        )}

        <main className="page-content">
          {activePage === 'Dashboard' ? (
            <Dashboard />
          ) : activePage === 'Profile' ? (
            <ProfilePage />
          ) : (
            <PlaceholderPage page={activePage} />
          )}
        </main>
      </div>
    </div>
  );
}
