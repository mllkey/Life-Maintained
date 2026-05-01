/**
 * lib/haptics.ts
 *
 * Single source of truth for haptic policy in LifeMaintained.
 *
 * Re-exports everything from expo-haptics so callers can migrate
 * from `import * as Haptics from "expo-haptics"` to
 * `import * as Haptics from "@/lib/haptics"` with no surface change.
 *
 * Tier table — what fires when:
 *
 *   selectionAsync        Picker / chip / tab / segment / toggle / stepper.
 *                         Fire AFTER setState so the haptic follows the
 *                         visual commit, not the press gesture.
 *
 *   impactAsync(Light)    Secondary CTA: open sheet, navigate, expand row,
 *                         dismiss banner. Fire on press.
 *
 *   impactAsync(Medium)   Primary CTA that creates / commits / purchases:
 *                         Save, Add, Generate, Purchase, Restore, long-press
 *                         action menu. Fire on press.
 *
 *   impactAsync(Heavy)    Reserved. Do not use in v1.
 *
 *   notificationAsync(Success)
 *                         Save success that surfaces via toast (not Alert).
 *                         First-ever schedule reveal coupled to animation
 *                         start frame via runOnJS or count-transition useEffect.
 *                         Do NOT chain with an Alert.
 *
 *   notificationAsync(Error)
 *                         Toast-style error only. Do NOT fire when the
 *                         next line is Alert.alert. The alert is the signal;
 *                         doubling reads as buggy.
 *
 *   notificationAsync(Warning)
 *                         Reserved for genuinely cautionary ambient events.
 *                         Do NOT fire on destructive-confirm taps. Use
 *                         Success on completion instead.
 *
 * Animation coupling (Reanimated):
 *   For sheet-snap, schedule reveal, building-plan transition, fire the
 *   haptic from the withSpring callback via runOnJS so it lands with the
 *   visual contact frame, not on press start. See building-plan.tsx and
 *   vehicle/[id].tsx schedule-reveal effect for the reference patterns.
 */

import * as ExpoHaptics from "expo-haptics";

export * from "expo-haptics";
export { ExpoHaptics as Haptics };

/**
 * Cold-start pre-warm. The first Haptics.* call after process start has
 * measurable latency on iOS while the Taptic Engine spins up. Calling this
 * once before a session's first INTENTIONAL haptic eliminates the lag.
 *
 * NOT auto-invoked on app mount because selectionAsync produces a real
 * (faint) tactile event. Pass 2 wires this into the first user-initiated
 * haptic of a session so the prime IS the user's expected feedback.
 *
 * Single-fire: subsequent calls are no-ops. Wire at multiple potential
 * entry points; whichever user gesture fires first wins.
 *
 * Best-effort, swallow errors.
 */
let _primed = false;

export async function primeHaptics(): Promise<void> {
  if (_primed) return;
  _primed = true;

  try {
    await ExpoHaptics.selectionAsync();
  } catch {
    // Pre-warm is best-effort; nothing to recover.
  }
}
