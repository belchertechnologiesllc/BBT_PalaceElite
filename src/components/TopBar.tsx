import type { User } from '@supabase/supabase-js';
import type { NavigationItem } from '../types/navigation';

type TopBarProps = {
  activePage: NavigationItem;
  user: User | null;
  onOpenNavigation: () => void;
  onSignOut: () => void;
};

export function TopBar({
  activePage,
  user,
  onOpenNavigation,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button
          className="menu-button"
          type="button"
          aria-label="Open navigation"
          onClick={onOpenNavigation}
        >
          &#9776;
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
          <button
            className="secondary-button"
            type="button"
            onClick={onSignOut}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
