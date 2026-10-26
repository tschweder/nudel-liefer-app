/**
 * What changed between a released tour and the confirmed orders of its day (NUD-043): the diff
 * shown to the office, the plan a re-release applies, and the rule which order changes make a
 * tour outdated. Pure functions, no framework imports.
 */
import { buildStops, type StopItem, type StopOrderInput } from "./tour";

export type ItemChange = { productId: string; before: number; after: number };

export type TourDiff = {
  /** Customers that get a new stop. */
  added: Array<{ customerId: string; items: StopItem[] }>;
  /** Open stops whose customer has nothing left to deliver. */
  removed: Array<{ stopId: string; customerId: string; items: StopItem[] }>;
  /** Open stops with different quantities (products added, removed or changed). */
  changed: Array<{ stopId: string; customerId: string; items: ItemChange[] }>;
  /**
   * Stops the driver already completed whose orders were edited afterwards. They are never
   * reset or re-dispatched; the office is told so that it can deal with it outside the tour.
   */
  completedChanged: Array<{ stopId: string; customerId: string; items: ItemChange[] }>;
};

export function isEmptyDiff(diff: TourDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0 &&
    diff.completedChanged.length === 0
  );
}

/** A stop as stored: `items` is the snapshot released to the driver, `orderIds` the linked orders. */
export type SnapshotStop = {
  id: string;
  customerId: string;
  sequence: number;
  /** DELIVERED or PROBLEM: frozen. */
  completed: boolean;
  orderIds: readonly string[];
  items: readonly StopItem[];
};

function toMap(items: readonly StopItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of map) if (quantity === 0) map.delete(productId);
  return map;
}

/** Quantity lists are equal when every product has the same total (order does not matter). */
export function sameItems(a: readonly StopItem[], b: readonly StopItem[]): boolean {
  const left = toMap(a);
  const right = toMap(b);
  if (left.size !== right.size) return false;
  for (const [productId, quantity] of left) if (right.get(productId) !== quantity) return false;
  return true;
}

/** Per product the quantity before and after (0 = not on the stop); only differing products. */
export function itemChanges(before: readonly StopItem[], after: readonly StopItem[]): ItemChange[] {
  const left = toMap(before);
  const right = toMap(after);
  const ids = [...new Set([...left.keys(), ...right.keys()])];
  return ids
    .map((productId) => ({
      productId,
      before: left.get(productId) ?? 0,
      after: right.get(productId) ?? 0,
    }))
    .filter((c) => c.before !== c.after);
}

export type PlannedEntry =
  | { kind: "completed"; stopId: string; customerId: string }
  | {
      kind: "existing";
      stopId: string;
      customerId: string;
      orderIds: string[];
      items: StopItem[];
      /** Differences to the released snapshot; empty when only the order links changed. */
      changes: ItemChange[];
    }
  | { kind: "new"; customerId: string; orderIds: string[]; items: StopItem[] };

export type ReleasePlan = {
  diff: TourDiff;
  /** The stops of the updated tour in their new order. */
  entries: PlannedEntry[];
  removedStopIds: string[];
};

/**
 * Plan for re-releasing a tour. `orders` are the CONFIRMED orders of the day of customers that
 * can be routed (confirmed pin); the caller filters the rest out (they are reported as warnings).
 *
 * - Completed stops (DELIVERED / PROBLEM) are frozen: they stay where they are with their status,
 *   quantities and order links. Orders linked to them are not planned again. Edits to those orders
 *   are reported in `completedChanged`.
 * - Every other confirmed order is merged per customer (`buildStops`). An open stop keeps its
 *   position and is updated to the new quantities; an open stop whose customer has no order left
 *   is removed; a customer without an open stop gets a new one at the end (this includes a
 *   customer that was already completed and ordered more afterwards: a second visit).
 */
export function planReRelease(
  stops: readonly SnapshotStop[],
  orders: readonly StopOrderInput[],
): ReleasePlan {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const frozenOrderIds = new Set(sorted.filter((s) => s.completed).flatMap((s) => [...s.orderIds]));

  const completedChanged: TourDiff["completedChanged"] = [];
  for (const stop of sorted.filter((s) => s.completed)) {
    const own = new Set(stop.orderIds);
    const current = buildStops(orders.filter((o) => own.has(o.id)))[0]?.items ?? [];
    const changes = itemChanges(stop.items, current);
    if (changes.length > 0) {
      completedChanged.push({ stopId: stop.id, customerId: stop.customerId, items: changes });
    }
  }

  const planned = buildStops(orders.filter((o) => !frozenOrderIds.has(o.id)));
  const plannedByCustomer = new Map(planned.map((p) => [p.customerId, p]));
  const used = new Set<string>();

  const entries: PlannedEntry[] = [];
  const removed: TourDiff["removed"] = [];
  const changed: TourDiff["changed"] = [];
  for (const stop of sorted) {
    if (stop.completed) {
      entries.push({ kind: "completed", stopId: stop.id, customerId: stop.customerId });
      continue;
    }
    const next = plannedByCustomer.get(stop.customerId);
    if (!next || used.has(stop.customerId)) {
      removed.push({
        stopId: stop.id,
        customerId: stop.customerId,
        items: toItems(stop.items),
      });
      continue;
    }
    used.add(stop.customerId);
    const changes = itemChanges(stop.items, next.items);
    if (changes.length > 0) {
      changed.push({ stopId: stop.id, customerId: stop.customerId, items: changes });
    }
    entries.push({
      kind: "existing",
      stopId: stop.id,
      customerId: stop.customerId,
      orderIds: next.orderIds,
      items: next.items,
      changes,
    });
  }

  const added: TourDiff["added"] = [];
  for (const p of planned) {
    if (used.has(p.customerId)) continue;
    added.push({ customerId: p.customerId, items: p.items });
    entries.push({ kind: "new", customerId: p.customerId, orderIds: p.orderIds, items: p.items });
  }

  return {
    diff: { added, removed, changed, completedChanged },
    entries,
    removedStopIds: removed.map((r) => r.stopId),
  };
}

function toItems(items: readonly StopItem[]): StopItem[] {
  return items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
}

export type OrderState = {
  status: string;
  customerId: string;
  /** `DATE` value (UTC midnight). */
  deliveryDate: Date;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
};

function itemsOf(state: OrderState): StopItem[] {
  return state.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
}

/**
 * Delivery days whose tours are outdated after an order changed from `before` to `after`
 * (`null` = did not exist / was deleted). Only CONFIRMED orders end up on a tour, so a change
 * that involves no confirmed order on either side (draft edits, copies, cancelling a draft)
 * flags nothing, and neither does a save that leaves a confirmed order's customer, day and
 * quantities as they were.
 */
export function outdatedTourDates(before: OrderState | null, after: OrderState | null): Date[] {
  const was = before?.status === "CONFIRMED" ? before : null;
  const is = after?.status === "CONFIRMED" ? after : null;
  if (!was && !is) return [];
  if (
    was &&
    is &&
    was.customerId === is.customerId &&
    was.deliveryDate.getTime() === is.deliveryDate.getTime() &&
    sameItems(itemsOf(was), itemsOf(is))
  ) {
    return [];
  }
  const dates = new Map<number, Date>();
  if (was) dates.set(was.deliveryDate.getTime(), was.deliveryDate);
  if (is) dates.set(is.deliveryDate.getTime(), is.deliveryDate);
  return [...dates.values()];
}
