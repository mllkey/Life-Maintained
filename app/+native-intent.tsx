export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  // Dev-only: the UI gallery is reached by deep link from the simulator proof.
  // expo-router passes the full URL here (scheme://host?query), so match the segment, not a prefix.
  // Every other link (including voice-log, handled by the Linking listener in _layout) still lands on the root.
  if (__DEV__ && path.includes("ui-gallery")) return path;
  return "/";
}
