import {
  parseSyncResponse,
  SYNC_MAX_ENTRIES,
  type SyncResponse,
  type SyncStopState,
} from "@/domain/driver-sync";

import { SYNC_API_PATH } from "./constants";
import {
  chunk,
  type OutboxEntry,
  type OutboxNotice,
  patchTourStates,
  settle,
  sortEntries,
  statesForEntries,
  toSyncEntry,
} from "./outbox";
import type { OutboxStore } from "./outbox-store";

/**
 * Sends the queued taps of `userId` to `POST /api/driver/sync` and settles the queue with the
 * answer (NUD-082). Used by the page and by the service worker (Background Sync), so it only needs
 * `fetch` and an `OutboxStore`.
 *
 * - Entries go out oldest first, at most 50 per request, one request after the other. The first
 *   failed request ends the run (the order of the taps must not be broken).
 * - A network error, a 5xx answer or an unreadable answer keeps everything queued (`retry`); a 401
 *   / 403 means the session is gone (`unauthorized`): also kept, it is sent after the next login.
 * - A 400 for a chunk of several entries is retried one entry at a time, so that one entry the
 *   server cannot accept (it becomes a notice) does not block the others.
 * - Applied and replayed entries are removed; rejected ones are removed and leave a notice; the
 *   stored tour copy is patched with the authoritative stop states of the answer.
 */
export type FlushFailure = "network" | "server" | "invalid" | "unauthorized";

export type FlushOutcome =
  | { kind: "empty" }
  | {
      kind: "ran";
      /** Entries the server applied (or had applied before). */
      applied: number;
      /** Entries the server rejected (each left a notice). */
      rejected: number;
      /** Authoritative state of the stops named in the entries that were settled. */
      states: Map<string, SyncStopState>;
      notices: OutboxNotice[];
      /**
       * Why the run ended early (`null` = everything the server was asked about was settled).
       * Entries not settled stay queued. Earlier requests of the same run are reported above.
       */
      failure: FlushFailure | null;
    };

export type FlushDeps = {
  store: OutboxStore;
  fetchImpl: typeof fetch;
  now: () => Date;
  /** Called with the ids of the entries a request is about to carry / has finished carrying. */
  onSending?: (ids: string[]) => void;
  onSettled?: (ids: string[]) => void;
};

type Sent =
  | { kind: "ok"; response: SyncResponse }
  | { kind: "bad-request" }
  | { kind: "unauthorized" }
  | { kind: "retry"; reason: "network" | "server" | "invalid" };

async function post(deps: FlushDeps, entries: readonly OutboxEntry[]): Promise<Sent> {
  let response: Response;
  try {
    response = await deps.fetchImpl(SYNC_API_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ entries: entries.map(toSyncEntry) }),
    });
  } catch {
    return { kind: "retry", reason: "network" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
  if (response.status === 400 || response.status === 413) return { kind: "bad-request" };
  if (!response.ok) return { kind: "retry", reason: "server" };
  try {
    const parsed = parseSyncResponse(await response.json());
    return parsed ? { kind: "ok", response: parsed } : { kind: "retry", reason: "invalid" };
  } catch {
    return { kind: "retry", reason: "invalid" };
  }
}

export async function flushOutbox(userId: string, deps: FlushDeps): Promise<FlushOutcome> {
  const queued = sortEntries((await deps.store.entries()).filter((e) => e.userId === userId));
  if (queued.length === 0) return { kind: "empty" };

  let applied = 0;
  let rejected = 0;
  let failure: FlushFailure | null = null;
  const states = new Map<string, SyncStopState>();
  const notices: OutboxNotice[] = [];
  const pending = chunk(queued, SYNC_MAX_ENTRIES);

  while (pending.length > 0) {
    const group = pending.shift()!;
    deps.onSending?.(group.map((e) => e.clientMutationId));
    let sent: Sent;
    try {
      sent = await post(deps, group);
    } finally {
      deps.onSettled?.(group.map((e) => e.clientMutationId));
    }

    if (sent.kind === "bad-request") {
      if (group.length > 1) {
        // Find the entry the server cannot accept: one request each, same order.
        pending.unshift(...group.map((e) => [e]));
        continue;
      }
      // A single entry that is invalid for the server can never succeed: drop it with a notice.
      const entry = group[0]!;
      const notice: OutboxNotice = {
        id: entry.clientMutationId,
        userId: entry.userId,
        stopId: entry.stopId,
        customerName: entry.customerName,
        type: entry.type,
        error: "invalid",
        createdAt: deps.now().toISOString(),
      };
      await deps.store.putNotice(notice);
      await deps.store.removeEntry(entry.clientMutationId);
      notices.push(notice);
      rejected += 1;
      continue;
    }
    if (sent.kind === "unauthorized" || sent.kind === "retry") {
      // Nothing of this or later chunks was processed. Earlier chunks are already settled.
      failure = sent.kind === "unauthorized" ? "unauthorized" : sent.reason;
      break;
    }

    const settlement = settle(group, sent.response.results, deps.now());
    // Notices first: if the tab dies between the two writes, the entry is replayed (harmless)
    // and the notice is written again under the same key.
    for (const notice of settlement.notices) await deps.store.putNotice(notice);
    for (const id of settlement.done) await deps.store.removeEntry(id);
    notices.push(...settlement.notices);
    rejected += settlement.notices.length;
    applied += settlement.done.length - settlement.notices.length;
    for (const [id, state] of statesForEntries(group, sent.response)) states.set(id, state);
    await deps.store.updateTourRecord(userId, (row) =>
      row.data && typeof row.data === "object"
        ? {
            ...row,
            data: patchTourStates(
              row.data as Parameters<typeof patchTourStates>[0],
              sent.response.tours,
            ),
          }
        : row,
    );
    if (settlement.retry.length > 0) {
      failure = "server"; // the server did not process everything: try later
      break;
    }
  }

  return { kind: "ran", applied, rejected, states, notices, failure };
}
