// Shared reveal choreography — beat + haptic timings for onboarding reveals.
// plan-reveal consumes these for all three verticals (vehicle/home/health)
// so every onboarding reveal stays in lockstep.
export const REVEAL_BEATS = {
  coverage: 0,
  hero: 160,
  supportOne: 320,
  supportTwo: 460,
  bridge: 600,
} as const;

// Haptic ticks trail the visual beats.
export const REVEAL_HAPTIC_OFFSETS = [80, 240, 400, 540] as const;

// Building-scene pacing (components/onboarding/BuildingScene.tsx). Every number
// the scene waits on lives here; none of them advances the scene on its own —
// Beat 3 and the route change still require verified rows and a loaded preview.
export const BUILDING_SCENE = {
  // Beat 2 lands here when the plan is already confirmed by then.
  beat2FastMs: 1500,
  // Beat 2 lands here when generation is still pending at beat2FastMs
  // (earlier if a confirmed result arrives in between).
  beat2PendingMs: 5000,
  // Minimum time on screen before Beat 3 may show.
  minSceneMs: 4000,
  // Still pending here: add the secondary "Still working" subtitle.
  slowNoticeMs: 30000,
  // Attempt lifetime. The request is aborted and one final read decides.
  attemptDeadlineMs: 90000,
  // Hold on Beat 3 before replacing the route with plan-reveal.
  beat3HoldMs: 700,
  // Asset-scoped row-count poll cadence (409, or 200 with no rows yet).
  pollIntervalMs: 2000,
} as const;
