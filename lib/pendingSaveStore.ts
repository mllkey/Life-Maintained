/**
 * AsyncStorage wrappers for the post-commit recovery record.
 *
 * Deliberately thin: a storage failure must never fail a save whose log
 * already committed, so every operation keeps its two-state result - write and
 * clear resolve void, read resolves a record or null. Failures are no longer
 * silent, though. A lost write here is lost replay intent, and it was
 * previously invisible; each catch now reports to Sentry, tagged by operation.
 *
 * All shape logic lives in the pure lib/pendingSave.ts, which the save-flow
 * battery symlinks and executes directly. This module stays out of the battery
 * on purpose - it exists to touch AsyncStorage and Sentry, which the battery
 * cannot host.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { pendingSaveKey, serializePendingSave, parsePendingSave, type PendingSaveRecord } from "./pendingSave";

/**
 * DIAG-1 (TEMPORARY - remove after the cross-launch recovery root cause is
 * pinned). Every store operation reports an info-level event under
 * area:pending_save_diag, and a rejected parse reports WHICH validation
 * failed. No behavior changes; observation only.
 */
function diagnoseParse(raw: string): string {
  let o: any;
  try { o = JSON.parse(raw); } catch { return "json"; }
  if (!o || typeof o !== "object") return "not_object";
  if (o.v !== 1) return "version:" + String(o.v);
  if (typeof o.createdAt !== "number" || !Number.isFinite(o.createdAt)) return "createdAt";
  if (typeof o.completedDate !== "string" || o.completedDate.length === 0) return "completedDate";
  if (!(o.milesVal === null || typeof o.milesVal === "number")) return "milesVal";
  if (!(o.hoursVal === null || typeof o.hoursVal === "number")) return "hoursVal";
  if (!(o.receiptPath === null || typeof o.receiptPath === "string")) return "receiptPath";
  if (!Array.isArray(o.items)) return "items_not_array";
  if (o.items.length === 0) return "items_empty";
  const seen = new Set<string>();
  for (const it of o.items) {
    if (!it || typeof it !== "object") return "item_shape";
    if (typeof it.itemKey !== "string" || it.itemKey.length === 0) return "itemKey";
    if (seen.has(it.itemKey)) return "dup_itemKey";
    seen.add(it.itemKey);
    if (typeof it.serviceName !== "string" || it.serviceName.length === 0) return "serviceName";
    if (typeof it.opId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(it.opId)) return "opId:" + String(it.opId).slice(0, 40);
    if (it.directTaskId !== undefined && typeof it.directTaskId !== "string") return "directTaskId";
    if (it.directTaskName !== undefined && typeof it.directTaskName !== "string") return "directTaskName";
    if (it.completedDate !== undefined && (typeof it.completedDate !== "string" || it.completedDate.length === 0)) return "item_completedDate";
    if (it.milesVal !== undefined && !(it.milesVal === null || typeof it.milesVal === "number")) return "item_milesVal";
    if (it.hoursVal !== undefined && !(it.hoursVal === null || typeof it.hoursVal === "number")) return "item_hoursVal";
  }
  return "ok";
}

function diag(op: string, extra: Record<string, unknown>): void {
  try {
    Sentry.captureMessage("pending_save diag " + op, {
      level: "info",
      tags: { area: "pending_save_diag", op },
      extra,
    });
  } catch { /* diagnostics must never affect the flow */ }
}

/**
 * Returns whether the write ACTUALLY landed. The recovery flow's guarantees -
 * remainder preservation, deterministic re-binding, and defused discards -
 * exist only if the row is on disk, so callers must be able to observe a
 * failure and fall back rather than assume durability.
 */
export async function writePendingSave(userId: string, vehicleId: string, rec: PendingSaveRecord): Promise<boolean> {
  try {
    const key = pendingSaveKey(userId, vehicleId);
    const value = serializePendingSave(rec);
    await AsyncStorage.setItem(key, value);
    diag("write_ok", { kTail: key.slice(-12), vLen: value.length, items: rec.items.length });
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "pending_save_store", op: "write" } });
    return false;
  }
}

export async function readPendingSave(userId: string, vehicleId: string): Promise<PendingSaveRecord | null> {
  try {
    const key = pendingSaveKey(userId, vehicleId);
    const raw = await AsyncStorage.getItem(key);
    const rec = parsePendingSave(raw);
    diag("read", {
      kTail: key.slice(-12),
      found: raw != null,
      rawLen: raw ? raw.length : 0,
      parsed: rec != null,
      reason: raw ? diagnoseParse(raw) : "absent",
    });
    return rec;
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "pending_save_store", op: "read" } });
    return null;
  }
}

/**
 * Returns whether the removal ACTUALLY landed. A discard and an end-of-flow
 * clear are destructive decisions; their callers must be able to observe a
 * failure and defuse the surviving row rather than assume it is gone.
 */
export async function clearPendingSave(userId: string, vehicleId: string): Promise<boolean> {
  try {
    const key = pendingSaveKey(userId, vehicleId);
    await AsyncStorage.removeItem(key);
    diag("clear_ok", { kTail: key.slice(-12) });
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "pending_save_store", op: "clear" } });
    return false;
  }
}
