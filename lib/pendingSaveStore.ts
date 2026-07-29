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
 * Returns whether the write ACTUALLY landed. The recovery flow's guarantees -
 * remainder preservation, deterministic re-binding, and defused discards -
 * exist only if the row is on disk, so callers must be able to observe a
 * failure and fall back rather than assume durability.
 */
export async function writePendingSave(userId: string, vehicleId: string, rec: PendingSaveRecord): Promise<boolean> {
  try {
    await AsyncStorage.setItem(pendingSaveKey(userId, vehicleId), serializePendingSave(rec));
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "pending_save_store", op: "write" } });
    return false;
  }
}

export async function readPendingSave(userId: string, vehicleId: string): Promise<PendingSaveRecord | null> {
  try {
    return parsePendingSave(await AsyncStorage.getItem(pendingSaveKey(userId, vehicleId)));
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
    await AsyncStorage.removeItem(pendingSaveKey(userId, vehicleId));
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "pending_save_store", op: "clear" } });
    return false;
  }
}
