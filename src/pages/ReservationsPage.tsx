import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { dollars, getTravelContext, includesGoldSeasonBlackout, nights, saveReservation, today, type Reservation } from '../services/travelService';

type Context = Awaited<ReturnType<typeof getTravelContext>>;
const statuses: Reservation['status'][] = ['tentative', 'confirmed', 'completed', 'cancelled'];
const textFields = [
  ['resort', 'Resort'], ['room_type', 'Room type'], ['rate_type', 'Rate type'],
  ['confirmation_number', 'Confirmation number'],
] as const;
const numberFields = [
  ['adults', 'Adults'], ['minors', 'Minors'], ['total_cost', 'Total cost'],
  ['amount_per_room', 'Amount per room'],
] as const;

export function ReservationsPage() {
  const [context, setContext] = useState<Context>();
  const [draft, setDraft] = useState<Reservation>();
  const [view, setView] = useState('Upcoming');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => setContext(await getTravelContext());
  useEffect(() => { void reload().catch((e: Error) => setError(e.message)); }, []);
  const blank = (): Reservation => ({
    membership_id: context!.membership.id, ownership_unit_id: context!.ownershipUnits[0]?.id ?? '',
    resort: '', check_in: '', check_out: '', room_type: null, confirmation_number: null,
    adults: 1, minors: 0, rate_type: null, total_cost: null, amount_per_room: null, notes: null,
    benefit_grant_id: null, benefit_quantity: null, status: 'tentative',
  });
  async function save(row: Reservation) {
    setBusy(true);
    setError('');
    try {
      await saveReservation(row);
      setDraft(undefined);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft) void save(draft);
  }
  const selected = context?.grants.find(grant => grant.id === draft?.benefit_grant_id);
  const rows = context?.reservations.filter(row => view === 'All' ||
    (view === 'Past'
      ? row.check_out <= today() || ['completed', 'cancelled'].includes(row.status)
      : row.check_out > today() && ['confirmed', 'tentative'].includes(row.status)));
  return <>
    <PageHeader title="Reservations" subtitle="Track travel and associated benefit usage." />
    {error && <p role="alert">{error}</p>}
    {!context && !error && <p>Loading reservations…</p>}
    {context && <section className="panel travel-panel">
      <div className="travel-toolbar">
        {['Upcoming', 'Past', 'All'].map(option => <button key={option} type="button"
          className="secondary-button" aria-pressed={view === option} onClick={() => setView(option)}>{option}</button>)}
        {context.isAdmin && <button className="secondary-button" onClick={() => setDraft(blank())}>Add reservation</button>}
      </div>
      {!rows?.length && <p>No reservations in this view.</p>}
      {rows?.map(row => <article key={row.id} className="travel-row">
        <div><strong>{row.resort}</strong><p>{row.check_in} to {row.check_out} · {nights(row.check_in, row.check_out)} nights · {row.status}</p>
          <p>{context.ownershipUnits.find(unit => unit.id === row.ownership_unit_id)?.name} · {row.adults + row.minors} guests
            {row.total_cost !== null && ` · ${dollars(row.total_cost)}`}</p></div>
        {context.isAdmin && <div className="travel-toolbar">
          <button className="secondary-button" onClick={() => setDraft(row)}>Edit</button>
          {row.status !== 'cancelled' && <button className="secondary-button" disabled={busy}
            onClick={() => { if (window.confirm('Cancel this reservation record and reverse linked usage?')) void save({ ...row, status: 'cancelled' }); }}>Cancel</button>}
        </div>}
      </article>)}
    </section>}
    {draft && context && <section className="panel travel-panel">
      <h3>{draft.id ? 'Edit reservation' : 'Add reservation'}</h3>
      <form onSubmit={submit} className="travel-grid">
        {textFields.map(([key, label]) => <label className="form-field" key={key}>{label}
          <input required={key === 'resort'} value={draft[key] ?? ''}
            onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        {(['check_in', 'check_out'] as const).map((key, index) => <label className="form-field" key={key}>{index ? 'Check-out' : 'Check-in'}
          <input type="date" required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        {numberFields.map(([key, label], index) => <label className="form-field" key={key}>{label}
          <input type="number" min="0" step={index < 2 ? 1 : '0.01'} required={index < 2} value={draft[key] ?? ''}
            onChange={e => setDraft({ ...draft, [key]: e.target.value === '' ? null : Number(e.target.value) })} /></label>)}
        <label className="form-field">Ownership unit<select required value={draft.ownership_unit_id}
          onChange={e => setDraft({ ...draft, ownership_unit_id: e.target.value })}>
          {context.ownershipUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label className="form-field">Status<select value={draft.status}
          onChange={e => setDraft({ ...draft, status: e.target.value as Reservation['status'] })}>
          {statuses.map(status => <option key={status}>{status}</option>)}</select></label>
        <label className="form-field">Linked benefit<select value={draft.benefit_grant_id ?? ''}
          onChange={e => setDraft({ ...draft, benefit_grant_id: e.target.value || null, benefit_quantity: e.target.value ? 1 : null })}>
          <option value="">None</option>{context.grants.filter(grant => !grant.archivedAt).map(grant =>
            <option key={grant.id} value={grant.id}>{grant.name} ({grant.pool})</option>)}</select></label>
        {selected && <label className="form-field">Usage ({selected.quantityKind})
          <input type="number" min=".01" step=".01" required value={draft.benefit_quantity ?? ''}
            onChange={e => setDraft({ ...draft, benefit_quantity: e.target.value ? Number(e.target.value) : null })} /></label>}
        <label className="form-field">Notes<textarea value={draft.notes ?? ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
        <p>{nights(draft.check_in, draft.check_out)} nights · {draft.adults + draft.minors} guests</p>
        {selected?.benefitCode === 'imperial_grand_weeks' && includesGoldSeasonBlackout(draft.check_in, draft.check_out) &&
          <p role="alert">Gold Season excludes December 24 through January 1.</p>}
        <div className="travel-toolbar">
          <button className="secondary-button" disabled={busy || !nights(draft.check_in, draft.check_out)}>Save reservation</button>
          <button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>Close</button>
        </div>
      </form>
    </section>}
  </>;
}
