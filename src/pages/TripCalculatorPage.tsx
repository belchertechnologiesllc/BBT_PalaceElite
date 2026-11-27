import { useEffect, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { getBenefitTransactionContext } from '../services/transactionsService';
import { dollars, getTripPlan, includesGoldSeasonBlackout, nights, roomBalance, saveTripPlan, type TripPlan, type TripRoom } from '../services/travelService';

const emptyRoom: TripRoom = { party: '', unit: '', adults: 2, minors: 0, price: 0, adultCharge: 0, minorCharge: 0, credits: 0, paid: 0 };
const fields = [['adults', 'Adults'], ['minors', 'Minors'], ['price', 'Room price'],
  ['adultCharge', 'Extra charge per adult'], ['minorCharge', 'Extra charge per minor'],
  ['credits', 'Credits applied'], ['paid', 'Amount paid']] as const;

export function TripCalculatorPage() {
  const [context, setContext] = useState<Awaited<ReturnType<typeof getBenefitTransactionContext>>>();
  const [plan, setPlan] = useState<TripPlan>();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void getBenefitTransactionContext().then(async result => {
      const saved = await getTripPlan(result.membership.id);
      setPlan(saved ?? { resort: '', check_in: '', check_out: '', rate: '', benefit: '', quantity: 0, rooms: [{ ...emptyRoom }] });
      setContext(result);
    }).catch((e: Error) => setMessage(e.message));
  }, []);
  const heading = <PageHeader title="Trip calculator" subtitle="Estimate group costs and save a planned scenario." />;
  if (!plan || !context) return <>{heading}<p role="status">{message || 'Loading trip plan…'}</p></>;
  const roomRows = plan.rooms.map(room => ({ room, ...roomBalance(room) }));
  const aggregate = (key: 'party' | 'unit') => {
    const groups = new Map<string, { total: number; paid: number; balance: number }>();
    for (const row of roomRows) {
      const id = row.room[key] || 'Unassigned';
      const current = groups.get(id) ?? { total: 0, paid: 0, balance: 0 };
      groups.set(id, { total: current.total + row.total, paid: current.paid + row.paid, balance: current.balance + row.balance });
    }
    return [...groups];
  };
  const money = (cents: number) => dollars(cents / 100);
  const stayNights = nights(plan.check_in, plan.check_out);
  const guests = plan.rooms.reduce((sum, room) => sum + room.adults + room.minors, 0);
  const grant = context.grants.find(item => item.id === plan.benefit);
  const balance = grant ? grant.originalQuantity + context.transactions
    .filter(row => row.benefitGrantId === grant.id && row.status === 'approved')
    .reduce((sum, row) => sum + row.quantityDelta, 0) : 0;
  const blackout = includesGoldSeasonBlackout(plan.check_in, plan.check_out);
  const warnings: string[] = [];
  if (blackout) warnings.push('Imperial Grand Weeks are ineligible for these dates. Gold Season excludes December 24 through January 1.');
  if (grant && plan.quantity > balance) warnings.push('The requested quantity exceeds available inventory.');
  if (grant?.benefitCode === 'incentive_stays' && stayNights) {
    const released = plan.check_in < '2029-03-29' ? 0 : plan.check_in < '2031-03-29' ? 2 : 4;
    if (plan.quantity + (grant.originalQuantity - balance) > released) {
      warnings.push('The requested Incentive Stay quantity exceeds the release allowance for these dates.');
    }
    if (blackout) warnings.push('Incentive Stays also require Gold Season dates.');
  }
  if (grant?.releaseDate && plan.check_in < grant.releaseDate) warnings.push('The benefit has not been released for these dates.');
  if (grant?.expirationDate && stayNights && Date.parse(plan.check_out) - 86_400_000 > Date.parse(grant.expirationDate)) warnings.push('The stay extends past the benefit expiration.');
  if (grant?.pool === 'golf' && plan.rooms.some(room => room.unit && !context.ownershipUnits.find(unit => unit.id === room.unit)?.participatesInGolfPool)) warnings.push('One or more rooms are assigned to a unit outside the Golf pool.');

  return <>{heading}
    <form className="panel travel-panel" onSubmit={event => {
      event.preventDefault();
      setSaving(true);
      setMessage('');
      void saveTripPlan(context.membership.id, plan).then(() => setMessage('Planned scenario saved.'))
        .catch((e: Error) => setMessage(e.message)).finally(() => setSaving(false));
    }}>
      <div className="travel-grid">
        {([['resort', 'Resort'], ['check_in', 'Check-in'], ['check_out', 'Check-out'], ['rate', 'Rate type']] as const).map(([key, label]) =>
          <label className="form-field" key={key}>{label}<input required type={key.startsWith('check') ? 'date' : 'text'} value={plan[key]}
            onChange={event => setPlan({ ...plan, [key]: event.target.value })} /></label>)}
        <label className="form-field">Rooms<input type="number" min="1" max="50" value={plan.rooms.length}
          onChange={event => {
            const count = event.target.valueAsNumber;
            if (Number.isInteger(count) && count >= 1 && count <= 50) setPlan({ ...plan, rooms: Array.from({ length: count }, (_, index) => plan.rooms[index] ?? { ...emptyRoom, party: `Room ${index + 1}` }) });
          }} /></label>
        <label className="form-field">Benefit preview<select value={plan.benefit}
          onChange={event => setPlan({ ...plan, benefit: event.target.value, quantity: 0 })}>
          <option value="">No draw</option>
          {context.grants.filter(item => !item.archivedAt).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {grant && <label className="form-field">Quantity ({grant.quantityKind})<input type="number" min="0" step=".01" value={plan.quantity}
          onChange={event => setPlan({ ...plan, quantity: Number(event.target.value) })} /></label>}
      </div>
      <p>{stayNights} nights · {guests} guests</p>
      <p>{grant ? `${balance.toFixed(2)} → ${(balance - plan.quantity).toFixed(2)} ${grant.quantityKind} if used` : 'Inventory impact · None'}</p>
      {warnings.map(warning => <p role="status" key={warning}>{warning}</p>)}
      {plan.rooms.map((room, index) => {
        const updateRoom = (changed: TripRoom) => setPlan({ ...plan, rooms: plan.rooms.map((old, i) => i === index ? changed : old) });
        return <fieldset key={index} className="travel-grid">
          <legend>Room {index + 1} · {money(roomRows[index].total)}</legend>
          <label className="form-field">Traveling party<input value={room.party} onChange={e => updateRoom({ ...room, party: e.target.value })} /></label>
          <label className="form-field">Ownership unit<select value={room.unit} onChange={e => updateRoom({ ...room, unit: e.target.value })}>
            <option value="">Unassigned</option>{context.ownershipUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          {fields.map(([key, label], i) => <label className="form-field" key={key}>{label}<input type="number" min="0" step={i < 2 ? 1 : '.01'}
            value={room[key]} onChange={e => updateRoom({ ...room, [key]: Number(e.target.value) })} /></label>)}
        </fieldset>;
      })}
      <h3>Total trip cost {money(roomRows.reduce((sum, row) => sum + row.total, 0))}</h3>
      <p>Paid {money(roomRows.reduce((sum, row) => sum + row.paid, 0))} · Balance {money(roomRows.reduce((sum, row) => sum + row.balance, 0))}</p>
      {(['party', 'unit'] as const).map(key => <div key={key}>
        <h3>{key === 'party' ? 'Traveling parties' : 'Ownership units'}</h3>
        {aggregate(key).map(([name, value]) => <p key={name}>
          {context.ownershipUnits.find(unit => unit.id === name)?.name ?? name} · {money(value.total)} total · {money(value.paid)} paid · {money(value.balance)} balance
        </p>)}
      </div>)}
      {context.isAdmin && <button className="secondary-button" disabled={saving || !stayNights}>Save planned scenario</button>}
      {message && <p role="status">{message}</p>}
    </form>
  </>;
}
