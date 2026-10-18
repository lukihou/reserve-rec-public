import { DateTime } from 'luxon';
import { Constants } from '../constants';
import { parseInventoryPool } from '../shared/models/inventory-pool.model';

export interface AvailabilitySelection {
  collectionId: string;
  activityType: string;
  activityId: string;
  productId: string;
  date: string;
}

export interface PassOption {
  display: string;
  value: string;
}

type SelectedStatus = 'loading' | 'error' | 'closed' | 'not-required' | 'sold-out' | 'expired';
type SelectedState = {
  [Status in SelectedStatus]: { status: Status; selection: AvailabilitySelection }
}[SelectedStatus];

export type AvailabilityState =
  | { status: 'idle' }
  | SelectedState
  | { status: 'not-open-yet'; selection: AvailabilitySelection; opensAt: DateTime }
  | { status: 'available'; selection: AvailabilitySelection; options: PassOption[] };

function parseDateTimeValue(value: unknown): DateTime {
  if (typeof value === 'number') {
    return DateTime.fromMillis(value);
  }

  if (typeof value === 'string') {
    return /^\d+$/.test(value) ? DateTime.fromMillis(Number(value)) : DateTime.fromISO(value);
  }

  return DateTime.invalid('Invalid temporal window value');
}

/** Interpret cached and freshly fetched inventory without inventing availability on failure. */
export function evaluateAvailability(
  selection: AvailabilitySelection,
  inventory: unknown,
  context: any,
  now: DateTime,
  isParking: boolean,
): AvailabilityState {
  const pool = parseInventoryPool(inventory);
  if (!pool) return { status: 'error', selection };

  if (pool.closureStatus === true) return { status: 'closed', selection };
  if (pool.isOpen === false) return { status: 'not-required', selection };
  if (typeof pool.available !== 'number' || !Number.isFinite(pool.available)) {
    return { status: 'error', selection };
  }
  if (pool.available <= 0) return { status: 'sold-out', selection };

  const window = context?.temporalWindows?.reservationWindow;
  const opensAt = parseDateTimeValue(window?.open);
  const closesAt = parseDateTimeValue(window?.close);
  if (!opensAt.isValid || !closesAt.isValid || closesAt < opensAt || !now?.isValid) {
    return { status: 'error', selection };
  }

  // A parking booking is one vehicle regardless of the general daily count limits (#566).
  const minimum = isParking ? 1 : context?.minDailyInventory;
  const maximum = isParking ? 1 : context?.maxDailyInventory;
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 1 || maximum < minimum) {
    return { status: 'error', selection };
  }

  if (now < opensAt) {
    return { status: 'not-open-yet', selection, opensAt: opensAt.setZone(Constants.timeZoneIANA) };
  }
  // The existing reservation window includes both its opening and closing instants.
  if (now > closesAt) return { status: 'expired', selection };

  const maximumAvailable = Math.min(maximum, pool.available);
  if (maximumAvailable < minimum) return { status: 'error', selection };

  const options: PassOption[] = [];
  for (let count = minimum; count <= maximumAvailable; count++) {
    options.push({ display: count.toString(), value: count.toString() });
  }
  return { status: 'available', selection, options };
}
