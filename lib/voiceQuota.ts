import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Profile } from "./subscription";
import { hasPersonalOrAbove, hasProOrAbove } from "./subscription";
import { supabase } from "./supabase";

// Per-tier daily voice transcription cap.
// Free 5/day, Personal 30/day, Pro/Business unlimited (Infinity client-side).
// Pro/Business abuse protection lives in the existing per-minute server rate
// limit; no daily cap is enforced for them.
export function voiceCapPerDay(profile: Profile | null | undefined): number {
  if (hasProOrAbove(profile)) return Infinity;
  if (hasPersonalOrAbove(profile)) return 30;
  return 5;
}

const COUNT_KEY = "@daily_voice_transcription_count";
const DATE_KEY = "@daily_voice_transcription_date";

// Local calendar day in the user's TZ. Date.toDateString() is locale-aware
// and TZ-aware (unlike toISOString which always returns UTC).
function todayLocalKey(): string {
  return new Date().toDateString();
}

export async function getLocalVoiceUsedToday(): Promise<number> {
  const today = todayLocalKey();
  const savedDate = await AsyncStorage.getItem(DATE_KEY);
  if (savedDate !== today) return 0;
  const raw = await AsyncStorage.getItem(COUNT_KEY);
  const parsed = parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function localVoiceRemainingToday(
  profile: Profile | null | undefined,
): Promise<number> {
  const cap = voiceCapPerDay(profile);
  if (cap === Infinity) return Infinity;
  const used = await getLocalVoiceUsedToday();
  return Math.max(0, cap - used);
}

export async function incrementLocalVoiceCount(): Promise<void> {
  const today = todayLocalKey();
  const used = await getLocalVoiceUsedToday();
  await AsyncStorage.setItem(DATE_KEY, today);
  await AsyncStorage.setItem(COUNT_KEY, String(used + 1));
}

// Reconcile the local AsyncStorage counter to match the server-reported
// remaining-today value. Called after a successful transcribe-audio response,
// or after a structured voice_cap_reached payload.
// Server is the source of truth; if server says 3 remain and local thinks 5
// remain, we set local used to (cap - 3).
export async function reconcileLocalVoiceFromServer(
  profile: Profile | null | undefined,
  remainingFromServer: number | null | undefined,
): Promise<void> {
  if (remainingFromServer === null || remainingFromServer === undefined) return;
  const cap = voiceCapPerDay(profile);
  if (cap === Infinity) return;
  const today = todayLocalKey();
  const targetUsed = Math.max(0, cap - remainingFromServer);
  await AsyncStorage.setItem(DATE_KEY, today);
  await AsyncStorage.setItem(COUNT_KEY, String(targetUsed));
}

type VoiceQuotaRpcClient = typeof supabase & {
  rpc(
    fn: string,
    args: { p_tz: string },
  ): PromiseLike<{
    data: number | null;
    error: { message: string } | null;
  }>;
};

const SYNC_TIMEOUT_MS = 4000;

// Pulls the server's authoritative used-today count and quietly prewarms
// the local counter at sheet-open. If an at-cap snapshot arrives before
// the user's tap, the existing local gate can catch it before recording.
// It never delays a tap; every failure path is silent.
export async function syncVoiceUsedFromServer(
  profile: Profile | null | undefined,
): Promise<void> {
  try {
    if (voiceCapPerDay(profile) === Infinity) return;
    const dayKey = todayLocalKey();
    const [dateBefore, countBefore] = await Promise.all([
      AsyncStorage.getItem(DATE_KEY),
      AsyncStorage.getItem(COUNT_KEY),
    ]);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const rpcClient = supabase as VoiceQuotaRpcClient;
    const rpc = rpcClient.rpc("get_voice_used_today", { p_tz: tz });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("voice sync timeout")), SYNC_TIMEOUT_MS),
    );
    const { data, error } = await Promise.race([Promise.resolve(rpc), timeout]);
    if (error) return;
    const used = typeof data === "number" && Number.isFinite(data) ? data : null;
    if (used === null || todayLocalKey() !== dayKey) return;

    const [dateAfter, countAfter] = await Promise.all([
      AsyncStorage.getItem(DATE_KEY),
      AsyncStorage.getItem(COUNT_KEY),
    ]);
    if (dateAfter !== dateBefore || countAfter !== countBefore) return;

    await AsyncStorage.multiSet([
      [DATE_KEY, dayKey],
      [COUNT_KEY, String(Math.max(0, used))],
    ]);
  } catch {
    // Silent by design — the tap gate falls back to the local counter and
    // the server backstop still enforces the cap.
  }
}
