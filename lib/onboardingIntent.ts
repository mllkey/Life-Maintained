export type OnboardingIntent =
  | { kind: "add-vehicle" }
  | { kind: "add-property" }
  | { kind: "open-vehicle"; id: string }
  | { kind: "open-property"; id: string }
  | { kind: "open-member"; id: string };

let pending: OnboardingIntent | null = null;

export function setPendingIntent(intent: OnboardingIntent): void {
  pending = intent;
}

export function takePendingIntent(): OnboardingIntent | null {
  const value = pending;
  pending = null;
  return value;
}
