/**
 * AsyncStorage wrappers for the post-commit recovery record.
 *
 * Deliberately thin and deliberately silent: a storage failure must never fail
 * a save whose log already committed. All shape logic lives in the pure
 * lib/pendingSave.ts, which the save-flow battery executes directly.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { pendingSaveKey, serializePendingSave, parsePendingSave, type PendingSaveRecord } from "./pendingSave";

export async function writePendingSave(userId: string, vehicleId: string, rec: PendingSaveRecord): Promise<void> {
  try { await AsyncStorage.setItem(pendingSaveKey(userId, vehicleId), serializePendingSave(rec)); }
  catch { /* best effort */ }
}

export async function readPendingSave(userId: string, vehicleId: string): Promise<PendingSaveRecord | null> {
  try { return parsePendingSave(await AsyncStorage.getItem(pendingSaveKey(userId, vehicleId))); }
  catch { return null; }
}

export async function clearPendingSave(userId: string, vehicleId: string): Promise<void> {
  try { await AsyncStorage.removeItem(pendingSaveKey(userId, vehicleId)); }
  catch { /* best effort */ }
}
