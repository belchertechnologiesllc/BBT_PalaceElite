import type { NavigationItem } from '../types/navigation';

type PlaceholderPageProps = {
  page: NavigationItem;
};

const descriptions: Record<NavigationItem, string> = {
  Dashboard: '',
  Members:
    'Manage ownership units, household members, and participation eligibility.',
  Ownership: '',
  Benefits:
    'Review shared and golf benefit pools, balances, and expiration dates.',
  Transactions:
    'Record benefit activity while preserving the complete audit history.',
  Reservations:
    'Track planned stays, confirmations, travelers, and benefit usage.',
  Profile:
    'Review your authenticated account and session details.',
  Administration:
    'Manage application users, roles, and system configuration.',
};

export function PlaceholderPage({ page }: PlaceholderPageProps) {
  return (
    <section className="placeholder-panel">
      <p className="eyebrow">Phase 1 navigation</p>
      <h2>{page}</h2>
      <p>{descriptions[page]}</p>
      <span>This page will be implemented in a later phase.</span>
    </section>
  );
}
