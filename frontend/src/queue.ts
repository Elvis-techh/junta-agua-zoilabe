/**
 * Census entries waiting to be sent (App Plan: "An entry is saved on the
 * phone first and sent when signal returns. A visible counter shows how many
 * entries are waiting").
 *
 * Every registration goes into this queue before anything is sent, with its
 * submission ID made on the phone. Sending the same entry twice is harmless:
 * the server answers the second time with the first save. An entry leaves
 * the queue only when the server has it, or when the person decides to drop
 * one the server refused.
 *
 * Entries remember who typed them and are sent only from that person's
 * session, so a shared phone cannot send one director's work as another's.
 */
import { ApiError, api } from "./api.ts";
import type { Registration } from "./census.ts";

export interface QueuedEntry {
  submissionId: string;
  userId: string;
  savedAt: string;
  registration: Registration;
  /** For the list on screen, without opening the whole entry. */
  label: { fullName: string; sectorName: string };
  state: "waiting" | "attention";
  /** Why the server did not take it, in its own words. */
  message?: string;
  /** The ID number is already registered: whose it is, for "Agregar otra vivienda". */
  existingPerson?: { fullName: string; codes: string[] };
}

/** An entry the server has taken, kept briefly so its code can be shown. */
export interface SentEntry {
  submissionId: string;
  householdId: string;
  code: string;
  fullName: string;
  phone: string | null;
}

export type SendResult =
  | { kind: "saved"; householdId: string; code: string; fullName: string; phone: string | null }
  | { kind: "offline" }
  | { kind: "signedOut" }
  | { kind: "duplicate"; message: string; person: { fullName: string; codes: string[] } }
  | { kind: "refused"; message: string };

/** Where the queue lives. The browser's localStorage, or a plain map in tests. */
export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const QUEUE_KEY = "zoilabe.censusQueue.v1";
const SENT_KEY = "zoilabe.censusSent.v1";
const KEEP_SENT = 20;

export function browserStore(): Store {
  return {
    get: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage full or blocked: the entry stays on screen, and sending is tried at once.
      }
    },
  };
}

function read<T>(store: Store, key: string): T[] {
  try {
    const parsed = JSON.parse(store.get(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export class CensusQueue {
  private listeners = new Set<() => void>();
  private sending: Promise<void> | null = null;

  constructor(private readonly store: Store) {}

  entries(): QueuedEntry[] {
    return read<QueuedEntry>(this.store, QUEUE_KEY);
  }

  sent(): SentEntry[] {
    return read<SentEntry>(this.store, SENT_KEY);
  }

  /** How many of this person's entries are not on the server yet: the counter. */
  pendingCount(userId: string): number {
    return this.entries().filter((entry) => entry.userId === userId).length;
  }

  find(submissionId: string): { queued?: QueuedEntry; sent?: SentEntry } {
    return {
      queued: this.entries().find((entry) => entry.submissionId === submissionId),
      sent: this.sent().find((entry) => entry.submissionId === submissionId),
    };
  }

  add(entry: Omit<QueuedEntry, "state" | "savedAt">): void {
    this.write([...this.entries(), { ...entry, state: "waiting", savedAt: new Date().toISOString() }]);
  }

  /** "Agregar otra vivienda" for an entry refused as a repeated ID: send it again, linked to that person. */
  addToExistingPerson(submissionId: string): void {
    this.update(submissionId, (entry) => ({
      ...entry,
      state: "waiting",
      message: undefined,
      existingPerson: undefined,
      registration: { ...entry.registration, addToExistingPerson: true },
    }));
  }

  /** Try a refused entry again as it is, e.g. after a sector was put back in the list. */
  retry(submissionId: string): void {
    this.update(submissionId, (entry) => ({ ...entry, state: "waiting", message: undefined }));
  }

  /** Drop an entry the server never took. Nothing on the server is touched. */
  discard(submissionId: string): void {
    this.write(this.entries().filter((entry) => entry.submissionId !== submissionId));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Send this person's waiting entries, oldest first. Stops at the first sign
   * of no signal or a closed session; the rest wait for the next try. Only
   * one round runs at a time; a call during a round waits for it.
   */
  sendAll(userId: string, send: (registration: Registration) => Promise<SendResult>): Promise<void> {
    if (!this.sending) {
      this.sending = this.round(userId, send).finally(() => {
        this.sending = null;
      });
    }
    return this.sending;
  }

  private async round(userId: string, send: (registration: Registration) => Promise<SendResult>): Promise<void> {
    // Read afresh each time, so an entry saved while a round runs is sent in it.
    const tried = new Set<string>();
    for (;;) {
      const entry = this.entries().find(
        (e) => e.userId === userId && e.state === "waiting" && !tried.has(e.submissionId),
      );
      if (!entry) {
        return;
      }
      tried.add(entry.submissionId);

      const result = await send(entry.registration);
      switch (result.kind) {
        case "offline":
        case "signedOut":
          return;
        case "saved":
          this.write(this.entries().filter((e) => e.submissionId !== entry.submissionId));
          this.writeSent([
            {
              submissionId: entry.submissionId,
              householdId: result.householdId,
              code: result.code,
              fullName: result.fullName,
              phone: result.phone,
            },
            ...this.sent().filter((e) => e.submissionId !== entry.submissionId),
          ]);
          break;
        case "duplicate":
          this.update(entry.submissionId, (e) => ({
            ...e,
            state: "attention",
            message: result.message,
            existingPerson: result.person,
          }));
          break;
        case "refused":
          this.update(entry.submissionId, (e) => ({ ...e, state: "attention", message: result.message }));
          break;
      }
    }
  }

  private update(submissionId: string, change: (entry: QueuedEntry) => QueuedEntry): void {
    this.write(this.entries().map((entry) => (entry.submissionId === submissionId ? change(entry) : entry)));
  }

  private write(entries: QueuedEntry[]): void {
    this.store.set(QUEUE_KEY, JSON.stringify(entries));
    this.listeners.forEach((listener) => listener());
  }

  private writeSent(entries: SentEntry[]): void {
    this.store.set(SENT_KEY, JSON.stringify(entries.slice(0, KEEP_SENT)));
  }
}

/** POST one entry and say what happened, in the queue's terms. */
export async function sendRegistration(registration: Registration): Promise<SendResult> {
  try {
    const saved = await api<{
      household: { id: string; code: string };
      person: { fullName: string | null; phone: string | null };
    }>("POST", "/census/households", registration);
    return {
      kind: "saved",
      householdId: saved.household.id,
      code: saved.household.code,
      fullName: saved.person.fullName ?? registration.person.fullName ?? "",
      phone: saved.person.phone,
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
      // No signal, or the server is down: it stays waiting and is tried again later.
      return { kind: "offline" };
    }
    if (error.status === 401) {
      return { kind: "signedOut" };
    }
    if (error.code === "person_exists") {
      const person = error.body.person as { fullName: string; households: Array<{ code: string }> };
      return {
        kind: "duplicate",
        message: error.message,
        person: { fullName: person.fullName, codes: person.households.map((h) => h.code) },
      };
    }
    return { kind: "refused", message: error.message };
  }
}

/** The one queue the app uses. */
export const censusQueue = new CensusQueue(browserStore());

// ---------------------------------------------------------------------------
// What the app remembers to open without signal
// ---------------------------------------------------------------------------

const ME_KEY = "zoilabe.me.v1";
const OPTIONS_KEY = "zoilabe.censusOptions.v1";

export function remember<T>(key: "me" | "options", value: T | null, store: Store = browserStore()): void {
  store.set(key === "me" ? ME_KEY : OPTIONS_KEY, value === null ? "" : JSON.stringify(value));
}

export function recall<T>(key: "me" | "options", store: Store = browserStore()): T | null {
  const raw = store.get(key === "me" ? ME_KEY : OPTIONS_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
