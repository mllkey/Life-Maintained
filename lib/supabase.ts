import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import type { Database } from './supabase-types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const DEFAULT_REQUEST_TIMEOUT_MS = 25000;
const FUNCTIONS_REQUEST_TIMEOUT_MS = 75000;
// The three schedule generators get a ceiling ABOVE the onboarding scene's own
// 90s attempt deadline (BUILDING_SCENE.attemptDeadlineMs), so the scene's
// AbortController is what ends a slow attempt, not this wrapper. Every other
// edge call keeps FUNCTIONS_REQUEST_TIMEOUT_MS.
const SCHEDULE_GENERATION_REQUEST_TIMEOUT_MS = 95000;
const SCHEDULE_GENERATION_PATHNAMES: readonly string[] = [
  "/functions/v1/generate-maintenance-schedule",
  "/functions/v1/generate-property-schedule",
  "/functions/v1/generate-health-schedule",
];

// Pathname only: origin, query string and fragment are stripped, so a function
// name that merely appears in a query value or another path cannot match.
function requestPathname(url: string): string {
  const schemeEnd = url.indexOf("://");
  const pathStart = schemeEnd === -1 ? 0 : url.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) return "/";
  const rest = url.slice(pathStart);
  const end = rest.search(/[?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

const timeoutFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
  const timeoutMs = SCHEDULE_GENERATION_PATHNAMES.includes(requestPathname(url))
    ? SCHEDULE_GENERATION_REQUEST_TIMEOUT_MS
    : url.includes("/functions/v1/")
      ? FUNCTIONS_REQUEST_TIMEOUT_MS
      : DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const external = init?.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  });
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timeoutFetch },
  auth: {
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    ...(Platform.OS !== "web" ? { lock: processLock } : {}),
  },
});

// Tells Supabase Auth to continuously refresh the session automatically
// if the app is in the foreground. When this is added, you will continue
// to receive `onAuthStateChange` events with the `TOKEN_REFRESHED` or
// `SIGNED_OUT` event if the user's session is terminated. This should
// only be registered once.
declare global {
  // eslint-disable-next-line no-var
  var __lmSupabaseAutoRefreshRegistered: boolean | undefined;
}

if (Platform.OS !== "web" && !global.__lmSupabaseAutoRefreshRegistered) {
  global.__lmSupabaseAutoRefreshRegistered = true;

  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });

  // Start immediately on initial app load
  supabase.auth.startAutoRefresh();
}
