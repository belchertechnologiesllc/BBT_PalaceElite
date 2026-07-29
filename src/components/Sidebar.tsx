import {
  navigationItems,
  type NavigationItem,
} from '../types/navigation';

type SidebarProps = {
  activePage: NavigationItem;
  configured: boolean;
  open: boolean;
  onNavigate: (item: NavigationItem) => void;
};

export function Sidebar({
  activePage,
  configured,
  open,
  onNavigate,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
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
            onClick={() => onNavigate(item)}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="status-badge">
          {configured ? 'Supabase connected' : 'Demo data'}
        </span>
      </div>
    </aside>
  );
}
