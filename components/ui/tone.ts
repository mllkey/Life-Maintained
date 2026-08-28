import { Colors } from "@/constants/colors";

/** A tone is an accent plus its 15% tint. Verticals map 1:1; accent is the product orange. */
export const TONES = {
  accent:  { color: Colors.accent,  muted: Colors.accentMuted },
  vehicle: { color: Colors.vehicle, muted: Colors.vehicleMuted },
  home:    { color: Colors.home,    muted: Colors.homeMuted },
  health:  { color: Colors.health,  muted: Colors.healthMuted },
} as const;

export type Tone = keyof typeof TONES;
