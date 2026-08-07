import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

const KEY_PREFIX = "@lm_freeze_journal_v1:";
const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const MAX_ENTRIES = 200;

let armed = false;
let sequence = 0;

type JournalData = Record<string, string | number | boolean | null>;

type JournalEntry = {
  bootId: string;
  seq: number;
  ts: number;
  message: string;
  data: JournalData | null;
};

export function recordFreezeMilestone(
  message: string,
  data?: JournalData,
): void {
  if (!armed || sequence >= MAX_ENTRIES) return;

  sequence += 1;
  const entry: JournalEntry = {
    bootId: BOOT_ID,
    seq: sequence,
    ts: Date.now(),
    message,
    data: data ?? null,
  };

  const key = `${KEY_PREFIX}${BOOT_ID}:${String(sequence).padStart(4, "0")}`;
  void AsyncStorage.setItem(key, JSON.stringify(entry)).catch(() => {});
}

export function armFreezeJournal(reason: string): void {
  if (armed) return;
  armed = true;
  recordFreezeMilestone("journal armed", { reason });
}

export async function recoverFreezeJournal(): Promise<void> {
  try {
    const currentPrefix = `${KEY_PREFIX}${BOOT_ID}:`;
    const keys = (await AsyncStorage.getAllKeys())
      .filter((key) => key.startsWith(KEY_PREFIX) && !key.startsWith(currentPrefix))
      .sort();

    if (keys.length === 0) return;

    const pairs = await AsyncStorage.multiGet(keys);
    const entries: JournalEntry[] = [];

    for (const [, value] of pairs) {
      if (!value) continue;
      try {
        const parsed = JSON.parse(value) as JournalEntry;
        if (
          typeof parsed.bootId === "string" &&
          typeof parsed.seq === "number" &&
          typeof parsed.ts === "number" &&
          typeof parsed.message === "string"
        ) {
          entries.push(parsed);
        }
      } catch {}
    }

    entries.sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));

    if (entries.length === 0) {
      await AsyncStorage.multiRemove(keys);
      return;
    }

    const lastEntries = entries.slice(-80);
    const first = entries[0];
    const last = entries[entries.length - 1];

    Sentry.captureEvent({
      message: "Recovered freeze journal",
      level: "error",
      fingerprint: ["freeze-recovered-journal-v1"],
      tags: {
        freeze_journal: "recovered",
      },
      extra: {
        journal_count: entries.length,
        journal_first_ts: first.ts,
        journal_last_ts: last.ts,
        journal_last_message: last.message,
        journal_json: JSON.stringify(lastEntries),
      },
    });

    const flushed = await Sentry.flush();
    if (flushed) {
      await AsyncStorage.multiRemove(keys);
    }
  } catch {}
}
