// Shared reveal choreography — beat + haptic timings for onboarding reveals.
// plan-reveal (home/health) consumes these now; value-reveal (vehicle) adopts
// them in a follow-up so all three reveals stay in lockstep.
export const REVEAL_BEATS = {
  coverage: 0,
  hero: 160,
  supportOne: 320,
  supportTwo: 460,
  bridge: 600,
} as const;

// Haptic ticks trail the visual beats.
export const REVEAL_HAPTIC_OFFSETS = [80, 240, 400, 540] as const;
