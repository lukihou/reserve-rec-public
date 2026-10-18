import { DateTime } from 'luxon';
import { AvailabilitySelection, evaluateAvailability } from './availability-state';

describe('evaluateAvailability', () => {
  const selection: AvailabilitySelection = {
    collectionId: 'c1',
    activityType: 'dayuse',
    activityId: 'a1',
    productId: 'p1',
    date: '2026-10-18',
  };
  const open = DateTime.fromISO('2026-10-18T07:00:00', { zone: 'America/Vancouver' });
  const close = open.plus({ hours: 12 });
  const context = {
    minDailyInventory: 1,
    maxDailyInventory: 4,
    temporalWindows: { reservationWindow: { open: open.toMillis(), close: close.toMillis() } },
  };
  const inventory = { isOpen: true, available: 3 };
  const evaluate = (pool: unknown, reservationContext: any = context, now = open, isParking = false) =>
    evaluateAvailability(selection, pool, reservationContext, now, isParking);

  it('retains the selection and limits available choices to the verified count', () => {
    expect(evaluate(inventory)).toEqual({
      status: 'available',
      selection,
      options: [1, 2, 3].map(count => ({ display: String(count), value: String(count) })),
    });
  });

  it('respects both minimum and maximum daily limits', () => {
    expect(evaluate({ isOpen: true, available: 10 }, { ...context, minDailyInventory: 2, maxDailyInventory: 3 })).toEqual({
      status: 'available',
      selection,
      options: [{ display: '2', value: '2' }, { display: '3', value: '3' }],
    });
  });

  it('caps vehicle parking at one pass independently of general daily limits', () => {
    expect(evaluate(inventory, { ...context, minDailyInventory: 2, maxDailyInventory: 10 }, open, true)).toEqual({
      status: 'available',
      selection,
      options: [{ display: '1', value: '1' }],
    });
  });

  it('gives a real closure precedence over the no-pass-required flag and unknown inventory', () => {
    expect(evaluate({ isOpen: false, available: null, closureStatus: true }, null)).toEqual({ status: 'closed', selection });
  });

  it('shows no pass required only for a valid explicit false response', () => {
    expect(evaluate({ isOpen: false, available: null }, null)).toEqual({ status: 'not-required', selection });
  });

  for (const [label, pool] of [
    ['failed lookup', null],
    ['missing response', undefined],
    ['empty response', {}],
    ['unknown count', { isOpen: true, available: null }],
    ['missing count', { isOpen: true }],
    ['missing pass requirement', { available: 3 }],
    ['non-boolean pass requirement', { isOpen: 'false', available: 3 }],
    ['non-numeric count', { isOpen: true, available: '3' }],
    ['non-finite count', { isOpen: true, available: Infinity }],
    ['NaN count', { isOpen: true, available: NaN }],
    ['malformed closure flag', { isOpen: true, available: 3, closureStatus: 'true' }],
  ] as const) {
    it(`fails closed for ${label}`, () => {
      expect(evaluate(pool)).toEqual({ status: 'error', selection });
    });
  }

  for (const available of [0, -1]) {
    it(`preserves verified sold-out inventory (${available}) without requiring reservation context`, () => {
      expect(evaluate({ isOpen: true, available }, null)).toEqual({ status: 'sold-out', selection });
    });
  }

  it('shows the release time in park time before the reservation window opens', () => {
    const state = evaluate(inventory, context, open.minus({ milliseconds: 1 }));

    expect(state.status).toBe('not-open-yet');
    if (state.status !== 'not-open-yet') fail('Expected the release state');
    else {
      expect(state.opensAt.toMillis()).toBe(open.toMillis());
      expect(state.opensAt.zoneName).toBe('America/Vancouver');
      expect(state.selection).toEqual(selection);
    }
  });

  it('includes the exact opening and closing instants in the available window', () => {
    expect(evaluate(inventory, context, open).status).toBe('available');
    expect(evaluate(inventory, context, close).status).toBe('available');
  });

  it('marks a verified elapsed reservation window as expired', () => {
    expect(evaluate(inventory, context, close.plus({ milliseconds: 1 }))).toEqual({ status: 'expired', selection });
  });

  it('uses the supplied server time rather than reading the device clock', () => {
    expect(evaluate(inventory, context, open.minus({ hours: 1 })).status).toBe('not-open-yet');
    expect(evaluate(inventory, context, close.plus({ hours: 1 })).status).toBe('expired');
  });

  for (const [label, window] of [
    ['numeric timestamps', { open: open.toMillis(), close: close.toMillis() }],
    ['numeric timestamp strings', { open: String(open.toMillis()), close: String(close.toMillis()) }],
    ['ISO timestamp strings', { open: open.toISO(), close: close.toISO() }],
  ] as const) {
    it(`accepts existing ${label}`, () => {
      expect(evaluate(inventory, { ...context, temporalWindows: { reservationWindow: window } }).status).toBe('available');
    });
  }

  for (const [label, reservationContext] of [
    ['missing context', null],
    ['missing reservation window', {}],
    ['invalid opening', { ...context, temporalWindows: { reservationWindow: { open: 'invalid', close: close.toMillis() } } }],
    ['invalid closing', { ...context, temporalWindows: { reservationWindow: { open: open.toMillis(), close: 'invalid' } } }],
    ['reversed window', { ...context, temporalWindows: { reservationWindow: { open: close.toMillis(), close: open.toMillis() } } }],
    ['missing daily minimum', { ...context, minDailyInventory: undefined }],
    ['missing daily maximum', { ...context, maxDailyInventory: undefined }],
    ['non-numeric limit', { ...context, maxDailyInventory: '4' }],
    ['non-finite limit', { ...context, maxDailyInventory: Infinity }],
    ['fractional limit', { ...context, minDailyInventory: 1.5 }],
    ['zero minimum', { ...context, minDailyInventory: 0 }],
    ['reversed limits', { ...context, minDailyInventory: 4, maxDailyInventory: 2 }],
  ] as const) {
    it(`does not offer booking with ${label}`, () => {
      expect(evaluate(inventory, reservationContext)).toEqual({ status: 'error', selection });
    });
  }

  it('does not call positive inventory fully reserved when it cannot meet the daily minimum', () => {
    expect(evaluate({ isOpen: true, available: 2 }, { ...context, minDailyInventory: 3 })).toEqual({ status: 'error', selection });
  });

  it('does not offer a parking pass when less than one pass is available', () => {
    expect(evaluate({ isOpen: true, available: 0.5 }, context, open, true)).toEqual({ status: 'error', selection });
  });

  it('does not offer booking when server time is invalid', () => {
    expect(evaluate(inventory, context, DateTime.invalid('No server time'))).toEqual({ status: 'error', selection });
  });

  it('does not mutate inventory, context, or selection', () => {
    const pool = Object.freeze({ ...inventory });
    const selected = Object.freeze({ ...selection });
    const reservationContext = Object.freeze({
      ...context,
      temporalWindows: Object.freeze({ reservationWindow: Object.freeze({ ...context.temporalWindows.reservationWindow }) }),
    });

    expect(evaluateAvailability(selected, pool, reservationContext, open, false).status).toBe('available');
    expect(pool).toEqual(inventory);
    expect(reservationContext).toEqual(context);
    expect(selected).toEqual(selection);
  });
});
