/**
 * Pure tour-building logic (NUD-041): orders -> stops, pin filtering, schedule (ETAs) and the
 * rules for re-running the builder on an existing tour. No framework imports.
 */

export type StopOrderInput = {
  id: string;
  customerId: string;
  items: ReadonlyArray<{ productId: string; quantity: string | number | { toString(): string } }>;
};

export type StopItem = { productId: string; quantityCents: number };

export type PlannedStop = {
  customerId: string;
  /** Every CONFIRMED order of the customer for the day (the `StopOrder` links), input order. */
  orderIds: string[];
  /** Quantities summed per product, in order of first appearance. */
  items: StopItem[];
};

/** `Decimal(10,2)` value (string, number or Prisma `Decimal`) as exact hundredths. */
export function quantityToCents(value: string | number | { toString(): string }): number {
  const text = typeof value === "string" ? value : String(value.toString());
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) throw new Error(`Invalid quantity "${text}"`);
  const fraction = (match[3] ?? "").padEnd(2, "0");
  if (/[1-9]/.test(fraction.slice(2)))
    throw new Error(`Quantity "${text}" has more than 2 decimals`);
  const cents = Number(match[2]) * 100 + Number(fraction.slice(0, 2));
  return match[1] ? -cents : cents;
}

/**
 * One stop per customer: all given (confirmed) orders of a customer are merged, quantities are
 * summed per product (exact, in hundredths) and every order stays linked. Stops are returned in
 * order of the customer's first order. The caller passes only CONFIRMED orders of one day.
 */
export function buildStops(orders: readonly StopOrderInput[]): PlannedStop[] {
  const stops = new Map<string, PlannedStop>();
  for (const order of orders) {
    let stop = stops.get(order.customerId);
    if (!stop) {
      stop = { customerId: order.customerId, orderIds: [], items: [] };
      stops.set(order.customerId, stop);
    }
    stop.orderIds.push(order.id);
    for (const item of order.items) {
      const cents = quantityToCents(item.quantity);
      const line = stop.items.find((i) => i.productId === item.productId);
      if (line) line.quantityCents += cents;
      else stop.items.push({ productId: item.productId, quantityCents: cents });
    }
  }
  return [...stops.values()];
}

export type CustomerPin = {
  id: string;
  lat: number | null;
  lng: number | null;
  pinConfirmed: boolean;
};

/** A pin counts only when the admin confirmed it (D9) and both coordinates exist. */
export function hasConfirmedPin(customer: CustomerPin | undefined): customer is CustomerPin & {
  lat: number;
  lng: number;
} {
  return (
    !!customer &&
    customer.pinConfirmed &&
    customer.lat !== null &&
    customer.lng !== null &&
    Number.isFinite(customer.lat) &&
    Number.isFinite(customer.lng)
  );
}

/** Splits stops into routable ones and the customers whose pin is not confirmed (reported). */
export function partitionByPin(
  stops: readonly PlannedStop[],
  customers: ReadonlyMap<string, CustomerPin>,
): { routable: PlannedStop[]; unrouted: PlannedStop[] } {
  const routable: PlannedStop[] = [];
  const unrouted: PlannedStop[] = [];
  for (const stop of stops) {
    (hasConfirmedPin(customers.get(stop.customerId)) ? routable : unrouted).push(stop);
  }
  return { routable, unrouted };
}

/**
 * Stop order for a LOCKED tour: stops already in the tour keep their position (only those that
 * still have a routable stop), new customers are appended in input order.
 */
export function mergeLockedOrder(
  existingCustomerIds: readonly string[],
  routable: readonly PlannedStop[],
): { stops: PlannedStop[]; added: string[]; removed: string[] } {
  const byCustomer = new Map(routable.map((s) => [s.customerId, s]));
  const kept: PlannedStop[] = [];
  const removed: string[] = [];
  for (const id of existingCustomerIds) {
    const stop = byCustomer.get(id);
    if (stop) kept.push(stop);
    else removed.push(id);
  }
  const known = new Set(existingCustomerIds);
  const appended = routable.filter((s) => !known.has(s.customerId));
  return { stops: [...kept, ...appended], added: appended.map((s) => s.customerId), removed };
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows `time` ("HH:MM") on the calendar day
 * `date` (a `DATE` value held as UTC midnight).
 */
export function departureInstant(date: Date, time: string, timeZone: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error(`Invalid departure time "${time}"`);
  const wall = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Number(match[1]),
    Number(match[2]),
  );
  let result = wall - zoneOffsetMs(wall, timeZone);
  // The offset can differ at the corrected instant (daylight saving switch): settle once more.
  result = wall - zoneOffsetMs(result, timeZone);
  return new Date(result);
}

export type Schedule = {
  /** Arrival time per stop, in stop order. */
  etas: Date[];
  /** Back at the depot after the last stop (the departure time for a tour without stops). */
  returnAt: Date;
  /** Driving time plus service time, depot to depot, in seconds. */
  totalDurationS: number;
};

/**
 * ETAs: departure + cumulative driving legs + service time at every earlier stop. `legs` has
 * n + 1 entries (depot -> stop 1 ... stop n -> depot) as the routing providers return them.
 */
export function computeSchedule(input: {
  departure: Date;
  legDurationsS: readonly number[];
  serviceSecondsPerStop: number;
}): Schedule {
  const { departure, legDurationsS, serviceSecondsPerStop } = input;
  const stopCount = Math.max(legDurationsS.length - 1, 0);
  const etas: Date[] = [];
  let elapsed = 0;
  for (let i = 0; i < stopCount; i += 1) {
    elapsed += legDurationsS[i];
    etas.push(new Date(departure.getTime() + elapsed * 1000));
    elapsed += serviceSecondsPerStop;
  }
  if (stopCount > 0) elapsed += legDurationsS[stopCount];
  return {
    etas,
    returnAt: new Date(departure.getTime() + elapsed * 1000),
    totalDurationS: elapsed,
  };
}
