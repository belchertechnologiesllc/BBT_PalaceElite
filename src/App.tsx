import { useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { useAuth } from './auth/AuthProvider';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardPage } from './pages/DashboardPage';
import { MembersPage } from './pages/MembersPage';
import { OwnershipPage } from './pages/OwnershipPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProfilePage } from './pages/ProfilePage';
import type { NavigationItem } from './types/navigation';

export default function App() {
  const { configured, loading, user, signOut } = useAuth();

  const [activePage, setActivePage] =
    useState<NavigationItem>('Dashboard');

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
      setSignOutError(
        error instanceof Error
          ? error.message
          : 'Unable to sign out.',
      );
    }
  };

  const renderActivePage = () => {
    switch (activePage) {
      case 'Dashboard':
        return <DashboardPage />;

      case 'Members':
        return <MembersPage />;

      case 'Ownership':
        return <OwnershipPage />;

      case 'Profile':
        return <ProfilePage />;

      default:
        return <PlaceholderPage page={activePage} />;
    }
  };

  return (
    <div className="workspace">
      <Sidebar
        activePage={activePage}
        configured={configured}
        open={navigationOpen}
        onNavigate={handleNavigation}
      />

      {navigationOpen && (
        <button
          className="navigation-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavigationOpen(false)}
        />
      )}

      <div className="content-shell">
        <TopBar
          activePage={activePage}
          user={user}
          onOpenNavigation={() => setNavigationOpen(true)}
          onSignOut={() => void handleSignOut()}
        />

        {signOutError && (
          <p className="global-error" role="alert">
            {signOutError}
          </p>
        )}

        <main className="page-content">
          {renderActivePage()}
        </main>
      </div>
    </div>
  );
}
