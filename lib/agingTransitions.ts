// lib/agingTransitions.ts
//
// Aging transitions, part 3 of 3 (client). Detects life-stage / age-key
// crossings for family members and pets, re-invokes generate-health-schedule
// (which reconciles, transitions, and stamps schedule_age_key server-side),
// surfaces a factual banner for real crossings, and refreshes caches.
//
// The age/stage functions below are BYTE-DUPLICATED from
// supabase/functions/generate-health-schedule/index.ts - the server is
// authoritative via the stamped key; any change there must land here too.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

type PetBracket = "puppy" | "kitten" | "adult" | "mature" | "senior" | "unknown";

function calendarAgeYears(dobRaw: string, now: Date): number | null {
  const iso = dobRaw.length === 10 ? dobRaw + "T00:00:00Z" : dobRaw;
  const dob = new Date(iso);
  if (!isFinite(dob.getTime())) return null;
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) years--;
  return years >= 0 ? years : null;
}

const DOG_SENIOR_AGE: Record<string, number> = { toy: 11, small: 11, medium: 10, large: 8, giant: 6 };

const DOG_BREED_SIZE: Record<string, string> = {
  "chihuahua": "toy", "yorkshire terrier": "toy", "yorkie": "toy", "pomeranian": "toy",
  "maltese": "toy", "papillon": "toy", "toy poodle": "toy", "shih tzu": "toy",
  "pug": "small", "french bulldog": "small", "frenchie": "small", "boston terrier": "small",
  "dachshund": "small", "miniature dachshund": "small", "cavalier king charles spaniel": "small",
  "miniature poodle": "small", "miniature schnauzer": "small", "west highland white terrier": "small",
  "westie": "small", "jack russell terrier": "small", "bichon frise": "small", "havanese": "small",
  "corgi": "medium", "pembroke welsh corgi": "medium", "cardigan welsh corgi": "medium",
  "beagle": "medium", "cocker spaniel": "medium", "border collie": "medium", "bulldog": "medium",
  "english bulldog": "medium", "australian shepherd": "medium", "shetland sheepdog": "medium",
  "basset hound": "medium", "brittany": "medium", "whippet": "medium", "shiba inu": "medium",
  "springer spaniel": "medium", "english springer spaniel": "medium", "standard schnauzer": "medium",
  "labrador retriever": "large", "lab": "large", "labrador": "large", "golden retriever": "large",
  "german shepherd": "large", "boxer": "large", "standard poodle": "large", "poodle": "large",
  "rottweiler": "large", "doberman pinscher": "large", "doberman": "large", "siberian husky": "large",
  "husky": "large", "alaskan malamute": "large", "weimaraner": "large", "vizsla": "large",
  "german shorthaired pointer": "large", "dalmatian": "large", "airedale terrier": "large",
  "rhodesian ridgeback": "large", "belgian malinois": "large", "collie": "large",
  "chesapeake bay retriever": "large", "greyhound": "large", "pit bull": "large",
  "american pit bull terrier": "large", "american staffordshire terrier": "large",
  "great dane": "giant", "saint bernard": "giant", "st bernard": "giant", "st. bernard": "giant",
  "mastiff": "giant", "english mastiff": "giant", "bullmastiff": "giant", "newfoundland": "giant",
  "irish wolfhound": "giant", "great pyrenees": "giant", "bernese mountain dog": "giant",
  "leonberger": "giant", "cane corso": "giant",
};

function dogSizeClass(breed: string | null): string {
  if (!breed) return "medium";
  const b = breed.trim().toLowerCase();
  if (DOG_BREED_SIZE[b]) return DOG_BREED_SIZE[b];
  for (const key of Object.keys(DOG_BREED_SIZE)) {
    if (b.includes(key)) return DOG_BREED_SIZE[key];
  }
  return "medium";
}

function petAgeBracket(petType: string, age: number | null, breed: string | null): PetBracket {
  if (age === null) return "unknown";
  const pt = petType.toLowerCase();
  if (pt === "dog") {
    if (age < 1) return "puppy";
    if (age >= (DOG_SENIOR_AGE[dogSizeClass(breed)] ?? 10)) return "senior";
    return "adult";
  }
  if (pt === "cat") {
    if (age < 1) return "kitten";
    if (age > 10) return "senior";
    if (age >= 7) return "mature";
    return "adult";
  }
  return "adult";
}

function personAgeKey(age: number | null): string {
  return age === null ? "unknown" : `p${age}`;
}

function ageKeyFor(memberType: string, age: number | null, bracket: PetBracket): string {
  return memberType === "pet" ? bracket : personAgeKey(age);
}

type MemberRow = {
  id: string;
  name: string;
  member_type: string;
  date_of_birth: string | null;
  pet_type: string | null;
  pet_breed: string | null;
  schedule_age_key: string | null;
};

function currentAgeKey(m: MemberRow): string {
  const memberType = m.member_type === "pet" ? "pet" : "person";
  const age = m.date_of_birth ? calendarAgeYears(m.date_of_birth, new Date()) : null;
  const bracket: PetBracket = memberType === "pet"
    ? petAgeBracket((m.pet_type ?? "unknown").toLowerCase(), age, m.pet_breed)
    : "adult";
  return ageKeyFor(memberType, age, bracket);
}

type InvokeResult = {
  appointments_added?: string[];
  transitions_applied?: string[];
  age_key?: string;
};

function crossingBanner(m: MemberRow, fromKey: string, result: InvokeResult): { title: string; body: string } | null {
  const added = result.appointments_added ?? [];
  const transitions = result.transitions_applied ?? [];
  const toKey = result.age_key ?? "";
  if (added.length === 0 && transitions.length === 0) return null;

  if (m.member_type === "pet") {
    if (toKey === "senior") {
      const semiAnnual = transitions.some(t => t.includes("Semi-Annual")) || added.includes("Semi-Annual Vet Visit");
      const parts: string[] = [];
      if (semiAnnual) parts.push("checkups move to every 6 months");
      if (added.length > 0) parts.push(`${added.slice(0, 2).join(" and ")}${added.length > 2 ? " and more" : ""} joined the schedule`);
      const body = parts.length > 0
        ? parts.join(", and ").replace(/^./, c => c.toUpperCase()) + "."
        : `${m.name}'s schedule was updated for the senior years.`;
      return { title: `${m.name} is a senior now`, body };
    }
    if ((fromKey === "puppy" || fromKey === "kitten") && (toKey === "adult" || toKey === "mature")) {
      return {
        title: `${m.name} is all grown up`,
        body: `${m.name}'s schedule now uses annual vaccinations and yearly checkups.`,
      };
    }
    if (toKey === "mature") {
      return {
        title: `${m.name} is entering the mature years`,
        body: added.length > 0
          ? `${added.slice(0, 2).join(" and ")}${added.length > 2 ? " and more" : ""} joined ${m.name}'s schedule for this stage.`
          : `${m.name}'s schedule was updated for the mature years.`,
      };
    }
    return {
      title: `${m.name}'s care schedule was updated`,
      body: `${added.length > 0 ? added.length + " new item" + (added.length === 1 ? "" : "s") : "Updates"} for this stage of ${m.name}'s life.`,
    };
  }

  if (added.length > 0) {
    const shown = added.slice(0, 2).join(" and ");
    return {
      title: `New screenings for ${m.name}`,
      body: `${m.name}'s age recommends ${shown}${added.length > 2 ? " and more" : ""} - added to the schedule.`,
    };
  }
  return {
    title: `${m.name}'s schedule was updated`,
    body: `Screening guidance changed for ${m.name}'s age - the schedule now reflects it.`,
  };
}

const CHECK_STAMP_PREFIX = "agingCheck:";
let inFlight = false;

export type AgingSweepResult = { changed: boolean; banners: Array<{ title: string; body: string }> };

const EMPTY_SWEEP: AgingSweepResult = { changed: false, banners: [] };

// Detects age-key crossings and re-invokes the generator. Banners are
// RETURNED, never scheduled here: the caller must first run the central
// notification scheduler (which cancels all scheduled notifications) and
// only then schedule these, or they would be wiped before display.
// At most one successful sweep per calendar day per user; any failure
// leaves the stamp unset so the next foreground retries.
export async function checkAgingTransitions(userId: string, queryClient: QueryClient): Promise<AgingSweepResult> {
  if (inFlight) return EMPTY_SWEEP;
  inFlight = true;
  try {
    const stampKey = `${CHECK_STAMP_PREFIX}${userId}`;
    const todayStr = new Date().toISOString().split("T")[0];
    try {
      const last = await AsyncStorage.getItem(stampKey);
      if (last === todayStr) return EMPTY_SWEEP;
    } catch {}

    const { data: members, error } = await supabase
      .from("family_members")
      .select("id, name, member_type, date_of_birth, pet_type, pet_breed, schedule_age_key")
      .eq("user_id", userId);
    if (error || !members) return EMPTY_SWEEP;

    let anyChanged = false;
    let anyFailed = false;
    const banners: Array<{ title: string; body: string }> = [];

    for (const m of members as MemberRow[]) {
      const nowKey = currentAgeKey(m);
      if (nowKey === "unknown" && m.schedule_age_key === null) continue;
      if (nowKey === m.schedule_age_key) continue;

      const wasRealCrossing = m.schedule_age_key !== null;
      try {
        const { data, error: invokeError } = await supabase.functions.invoke("generate-health-schedule", {
          body: { family_member_id: m.id },
        });
        if (invokeError) {
          anyFailed = true;
          continue;
        }
        anyChanged = true;
        const result = (data ?? {}) as InvokeResult;
        if (wasRealCrossing) {
          const banner = crossingBanner(m, m.schedule_age_key ?? "", result);
          if (banner) banners.push(banner);
        }
      } catch {
        anyFailed = true;
      }
    }

    if (anyChanged) {
      queryClient.invalidateQueries({ queryKey: ["family_members"] });
      queryClient.invalidateQueries({ queryKey: ["health_appointments", userId] });
      queryClient.invalidateQueries({ queryKey: ["member_appointments"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }

    if (!anyFailed) {
      try { await AsyncStorage.setItem(stampKey, todayStr); } catch {}
    }
    return { changed: anyChanged, banners };
  } finally {
    inFlight = false;
  }
}
