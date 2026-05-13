/**
 * Analytics — typed PostHog event helper.
 *
 * Architecture:
 *   - Single module-level PostHog instance (analyticsClient) created here.
 *   - Same instance is passed to <PostHogProvider client={analyticsClient}>
 *     in app/_layout.tsx.
 *   - capture/identify/reset wrappers no-op when analyticsClient is null
 *     (env var absent).
 *
 * Event naming:
 *   snake_case is the locked convention for this codebase. Do NOT mix styles
 *   (no "user signed up"). When adding events, add the typed shape to
 *   AnalyticsEvents below so TS catches typos at the call site.
 *
 * Lifecycle events:
 *   - app_opened     = cold start / session start (fires once per process)
 *   - app_foregrounded = background → active transition (subsequent opens)
 */

import { PostHog } from "posthog-react-native";

// ---- Event catalog --------------------------------------------------------

export type AnalyticsEvents = {
  app_opened: {};
  app_foregrounded: {};
  onboarding_step_viewed: { step: "start" | "building_plan" | "value_reveal" };
  vehicle_added: { vehicle_id: string; make: string; model: string; year: number };
  property_added: { property_id: string; property_type: string };
  family_member_added: { family_member_id: string; member_type: "person" | "pet" };
  task_completed: { task_id: string; vehicle_id: string; task_name: string };
  property_task_completed: { task_id: string; property_id: string; task_name: string };
  health_appointment_completed: { appointment_id: string; family_member_id: string; appointment_type: string };
  medication_dose_logged: { medication_id: string; family_member_id: string | null; today_count: number; streak_days: number };
  medication_dose_undone: { medication_id: string; family_member_id: string | null; today_count: number };
  scan_completed: { asset_type: string; asset_id: string; source: "camera" | "library" };
  paywall_viewed: { context_vertical?: string; context_reason?: string };
  notification_opened: { asset_kind: string; task_kind: string };
};

export type EventName = keyof AnalyticsEvents;

// ---- Client instantiation -------------------------------------------------

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

export const analyticsClient: PostHog | null = apiKey
  ? new PostHog(apiKey, {
      host: "https://us.i.posthog.com",
      captureAppLifecycleEvents: false,
      sendFeatureFlagEvent: false,
      preloadFeatureFlags: false,
      disabled: false,
    })
  : null;

// ---- Typed wrappers --------------------------------------------------------

export function capture<E extends EventName>(
  event: E,
  props?: AnalyticsEvents[E],
) {
  if (!analyticsClient) return;
  try {
    analyticsClient.capture(event, props);
  } catch (e) {
    if (__DEV__) console.warn("[analytics] capture failed:", e);
  }
}

export function identify(
  userId: string,
  traits?: { subscription_tier?: string | null; onboarding_completed?: boolean },
) {
  if (!analyticsClient) return;
  try {
    analyticsClient.identify(userId, traits);
  } catch (e) {
    if (__DEV__) console.warn("[analytics] identify failed:", e);
  }
}

export function resetAnalytics() {
  if (!analyticsClient) return;
  try {
    analyticsClient.reset();
  } catch (e) {
    if (__DEV__) console.warn("[analytics] reset failed:", e);
  }
}
