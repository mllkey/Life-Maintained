export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  // Dev-only: every deep link passes through so QA can open any screen directly
  // (the redesign needs linkable routes, not just the UI gallery).
  // Production is unchanged: outside __DEV__ every link still lands on the root.
  if (__DEV__) return path;
  return "/";
}
