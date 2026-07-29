/**
 * Durable post-commit recovery record for the log-service save flow.
 *
 * Written the moment the maintenance_logs insert RESOLVES - not before it.
 * maintenance_logs has no idempotency key, so a record written before the
 * insert would carry an unresolvable "did it land?" ambiguity and a resume
 * would either duplicate the log or silently discard it. Every record that
 * exists is therefore provably post-commit, which is exactly the window the
 * navigation lock and the resume cover.
 *
 * Every item carries its own stable opId, minted at record write. That same id
 * follows the item through AUTO, picker, automatic retry, and post-crash
 * resume, so a replay is idempotent per (task_id, operation_id) instead of
 * advancing the task a second time.
 *
 * No TTL. An old record still represents a committed log whose completions
 * never ran; deleting it silently would lose that intent.
 *
 * This module is PURE - key construction, serialization, and total validation
 * only - so scripts/saveflow.battery.ts can symlink and execute the exact file
 * the app ships. The AsyncStorage wrappers live in lib/pendingSaveStore.ts.
 */
export const PENDING_SAVE_VERSION = 1 as const;

/**
 * Local shape check, deliberately not imported from lib/operationId. This
 * module validates data read back from disk, so it must own its own notion of
 * a well-formed id, and staying import-free lets scripts/saveflow.battery.ts
 * symlink and execute this exact file.
 */
const OP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isOperationId(v: unknown): v is string {
  return typeof v === "string" && OP_ID_RE.test(v);
}

/**
 * completedDate, milesVal and hoursVal are OPTIONAL per-item overrides. They
 * exist for one reason: an item carried out of an older record into a newer
 * one must complete against ITS OWN save's date and meters, never the values
 * of the save that happened to carry it - the operation id is stable, so a
 * replay must present identical arguments. Items minted fresh omit all three
 * and inherit the record-level values, which keeps v1 records parseable
 * unchanged.
 */
export type PendingSaveItem = {
  itemKey: string;
  serviceName: string;
  opId: string;
  directTaskId?: string;
  directTaskName?: string;
  completedDate?: string;
  milesVal?: number | null;
  hoursVal?: number | null;
};

export type PendingSaveRecord = {
  v: typeof PENDING_SAVE_VERSION;
  createdAt: number;
  completedDate: string;
  milesVal: number | null;
  hoursVal: number | null;
  receiptPath: string | null;
  items: PendingSaveItem[];
};

export function pendingSaveKey(userId: string, vehicleId: string): string {
  return "lm:pendingLog:v1:" + userId + ":" + vehicleId;
}

export function serializePendingSave(rec: PendingSaveRecord): string {
  return JSON.stringify(rec);
}

/** Total validation. Anything malformed resolves to null rather than throwing. */
export function parsePendingSave(raw: string | null | undefined): PendingSaveRecord | null {
  if (!raw) return null;
  let o: any;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  if (o.v !== PENDING_SAVE_VERSION) return null;
  if (typeof o.createdAt !== "number" || !Number.isFinite(o.createdAt)) return null;
  if (typeof o.completedDate !== "string" || o.completedDate.length === 0) return null;
  if (!(o.milesVal === null || typeof o.milesVal === "number")) return null;
  if (!(o.hoursVal === null || typeof o.hoursVal === "number")) return null;
  if (!(o.receiptPath === null || typeof o.receiptPath === "string")) return null;
  if (!Array.isArray(o.items) || o.items.length === 0) return null;
  const items: PendingSaveItem[] = [];
  const seen = new Set<string>();
  for (const it of o.items) {
    if (!it || typeof it !== "object") return null;
    if (typeof it.itemKey !== "string" || it.itemKey.length === 0) return null;
    if (seen.has(it.itemKey)) return null;
    seen.add(it.itemKey);
    if (typeof it.serviceName !== "string" || it.serviceName.length === 0) return null;
    if (!isOperationId(it.opId)) return null;
    if (it.directTaskId !== undefined && typeof it.directTaskId !== "string") return null;
    if (it.directTaskName !== undefined && typeof it.directTaskName !== "string") return null;
    if (it.completedDate !== undefined && (typeof it.completedDate !== "string" || it.completedDate.length === 0)) return null;
    if (it.milesVal !== undefined && !(it.milesVal === null || typeof it.milesVal === "number")) return null;
    if (it.hoursVal !== undefined && !(it.hoursVal === null || typeof it.hoursVal === "number")) return null;
    const next: PendingSaveItem = { itemKey: it.itemKey, serviceName: it.serviceName, opId: it.opId };
    if (typeof it.directTaskId === "string") next.directTaskId = it.directTaskId;
    if (typeof it.directTaskName === "string") next.directTaskName = it.directTaskName;
    if (typeof it.completedDate === "string") next.completedDate = it.completedDate;
    if (it.milesVal !== undefined) next.milesVal = it.milesVal;
    if (it.hoursVal !== undefined) next.hoursVal = it.hoursVal;
    items.push(next);
  }
  return {
    v: PENDING_SAVE_VERSION,
    createdAt: o.createdAt,
    completedDate: o.completedDate,
    milesVal: o.milesVal,
    hoursVal: o.hoursVal,
    receiptPath: o.receiptPath,
    items,
  };
}

/**
 * Resume boundary (reviewer-accepted). A record is never silently deleted -
 * it represents a committed log whose completions never ran - but an old one
 * must not execute silently either: the user may have completed the task by
 * hand from Tasks in the interim, and our stable opId is a NEW operation
 * against that task, so a silent resume would advance next-due a second time.
 */
export const SILENT_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ResumeMode = "silent" | "confirm";

export function resumeMode(rec: PendingSaveRecord, now: number): ResumeMode {
  const age = now - rec.createdAt;
  return age >= 0 && age <= SILENT_RESUME_WINDOW_MS ? "silent" : "confirm";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Formats the record's service date from the ISO date portion only. The stored
 * value is serviceDate at T12:00, and reading the calendar fields directly
 * avoids a timezone shift moving the displayed day.
 */
export function resumeServiceDateLabel(rec: PendingSaveRecord): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rec.completedDate);
  if (!m) return null;
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return MONTHS[mo - 1] + " " + d;
}

/**
 * Confirmation copy for an out-of-window resume.
 *
 * The count is ITEMS, not tasks: how many tasks a resume will touch is not
 * known until matching runs, so promising a task count here would be a number
 * we cannot back. Discard clears only this record - never the committed log.
 */
export function resumePrompt(rec: PendingSaveRecord): { title: string; detail: string } {
  const label = resumeServiceDateLabel(rec);
  const n = rec.items.length;
  return {
    title: label ? "Finish updating your " + label + " service?" : "Finish updating your earlier service?",
    detail: n === 1 ? "1 item still needs checking." : n + " items still need checking.",
  };
}

/**
 * Rewrites a record down to the items whose adjudication is still open. A run
 * that ends with unknown writes or never-matched items must not clear the
 * record - that would erase replay intent for work that may not have landed -
 * and must not keep settled items either, or the next open would resume
 * finished work. An empty keep set resolves to null, which the caller treats
 * as "clear": parsePendingSave rejects empty item arrays, so an empty record
 * is never a valid thing to write.
 *
 * createdAt is preserved from the original record on purpose. The silent
 * resume window is anchored to when the log committed, and a record that keeps
 * failing should age into the confirm path, not stay silently retryable
 * forever.
 */
export function rewritePendingRemainder(rec: PendingSaveRecord, keep: PendingSaveItem[]): PendingSaveRecord | null {
  if (keep.length === 0) return null;
  return {
    v: rec.v,
    createdAt: rec.createdAt,
    completedDate: rec.completedDate,
    milesVal: rec.milesVal,
    hoursVal: rec.hoursVal,
    receiptPath: rec.receiptPath,
    items: keep,
  };
}

/**
 * createdAt for a record that may carry a prior record's items. The silent
 * resume window must never be re-armed by a carry: a stale remainder folded
 * into a fresh save keeps its ORIGINAL anchor, so its items stay on the
 * confirm path they had already aged into. A future anchor (clock skew) is
 * unageable - it cannot honestly classify as fresh - so it is forced past the
 * silent window entirely: the record becomes confirm-classified immediately
 * and stays that way, rather than being clamped to now and silently re-armed.
 */
export function carriedCreatedAt(prior: PendingSaveRecord | null, now: number): number {
  if (!prior) return now;
  if (prior.createdAt > now) return now - SILENT_RESUME_WINDOW_MS - 1;
  return prior.createdAt;
}

/**
 * Decides whether a prior record discovered ONLY at save time must be held
 * out of execution. A prior this session already adjudicated (silent resume or
 * the user's explicit confirmation) is safe to carry and run - continuity of
 * work the session owns. A prior the session never saw is safe only inside the
 * silent window; outside it, running its items would advance tasks the user
 * may have completed by hand in the interim - the exact hazard the confirm
 * boundary exists to prevent. Held items are preserved, never executed: they
 * ride the merged record into the remainder under the ORIGINAL anchor, so the
 * next open presents the standard confirmation ask for them.
 */
export function saveTimePriorNeedsHold(prior: PendingSaveRecord | null, sessionAdjudicated: boolean, now: number): boolean {
  return prior !== null && !sessionAdjudicated && resumeMode(prior, now) === "confirm";
}

/**
 * Replaces the item whose itemKey matches with its bound copy, leaving every
 * other item untouched. This is the pure half of write-ahead binding: the
 * chosen task must be durable on the item BEFORE the completion RPC runs, so
 * a process death mid-RPC replays the same task deterministically instead of
 * matching again.
 */
export function rebindItem(items: PendingSaveItem[], bound: PendingSaveItem): PendingSaveItem[] {
  return items.map(it => (it.itemKey === bound.itemKey ? bound : it));
}

/**
 * Removes the item whose itemKey matches, leaving every other item untouched.
 * This is the pure half of settle checkpointing: a decided item - completed,
 * hard-failed, skipped, dropped, or mapped to no task - leaves the durable
 * image at decision time, so a crash or a failed final write cannot resurrect
 * work the user already watched settle or explicitly declined.
 */
export function settleItem(items: PendingSaveItem[], itemKey: string): PendingSaveItem[] {
  return items.filter(it => it.itemKey !== itemKey);
}

/**
 * Defuses a record that could not be removed from storage. A failed clear
 * leaves a zombie row that a later mount would read fresh; rewriting it with
 * an anchor forced past the silent window makes it permanently
 * confirm-classified, so the worst outcome of a broken removal is one extra
 * ask - never a silent replay of items the user explicitly discarded or
 * already watched settle. Items, opIds, and per-item completion arguments are
 * untouched, so a user who chooses to finish still replays idempotently.
 */
export function defusePendingSave(rec: PendingSaveRecord, now: number): PendingSaveRecord {
  return { ...rec, createdAt: now - SILENT_RESUME_WINDOW_MS - 1 };
}

/**
 * Folds a prior record's items into a new save's item list instead of letting
 * the new record clobber them - one storage key holds one record per vehicle,
 * so without this a fresh save would silently erase a preserved remainder.
 *
 * Each carried item is re-keyed under a "carry:" prefix (index plus original
 * key) so keys stay unique through repeated carries, keeps its opId and any
 * direct-task binding, and is stamped with its ORIGINAL record's completion
 * date and meters so its replay presents identical arguments. New items lead
 * the merged list, so outcome copy names the save the user just made.
 */
export function mergeCarriedItems(prior: PendingSaveRecord | null, items: PendingSaveItem[]): PendingSaveItem[] {
  if (!prior || prior.items.length === 0) return items;
  const merged = items.slice();
  for (let i = 0; i < prior.items.length; i++) {
    const p = prior.items[i];
    merged.push({
      ...p,
      itemKey: "carry:" + i + ":" + p.itemKey,
      completedDate: p.completedDate ?? prior.completedDate,
      milesVal: p.milesVal !== undefined ? p.milesVal : prior.milesVal,
      hoursVal: p.hoursVal !== undefined ? p.hoursVal : prior.hoursVal,
    });
  }
  return merged;
}
