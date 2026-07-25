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

export type PendingSaveItem = {
  itemKey: string;
  serviceName: string;
  opId: string;
  directTaskId?: string;
  directTaskName?: string;
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
    const next: PendingSaveItem = { itemKey: it.itemKey, serviceName: it.serviceName, opId: it.opId };
    if (typeof it.directTaskId === "string") next.directTaskId = it.directTaskId;
    if (typeof it.directTaskName === "string") next.directTaskName = it.directTaskName;
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
