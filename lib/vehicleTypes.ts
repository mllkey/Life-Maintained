export const MILEAGE_TRACKED_TYPES = new Set([
  "car",
  "motorcycle",
  "rv",
  "utv",
  "snowmobile",
  "dump_truck",
  "semi_truck",
  "other",
  "atv",
]);

/** No odometer/hour meter — calendar-only maintenance. */
export const TIME_ONLY_TYPES = new Set(["trailer", "dump_trailer", "dumpster"]);

/**
 * Types that default to engine/runtime hours when `tracking_mode` is not set.
 * Authoritative behavior still comes from `vehicles.tracking_mode` when present.
 */
export const HOURS_TRACKED_TYPES = new Set([
  "boat",
  "pwc",
  "lawnmower",
  "chainsaw",
  "generator",
  "excavator",
  "skid_steer",
  "mini_excavator",
  "compact_track_loader",
  "backhoe",
  "wheel_loader",
  "telehandler",
  "forklift",
  "snow_blower",
  "pressure_washer",
  "wood_chipper",
  "stump_grinder",
  "concrete_saw",
  "welder",
]);

export type TrackingMode = "mileage" | "hours" | "both" | "time_only";

/**
 * Default tracking mode from vehicle type alone (legacy / unset `tracking_mode`).
 */
export function inferTrackingModeFromVehicleType(
  vehicleType: string | null | undefined,
): TrackingMode {
  const t = (vehicleType ?? "").toLowerCase().trim();
  if (TIME_ONLY_TYPES.has(t)) return "time_only";
  if (HOURS_TRACKED_TYPES.has(t)) return "hours";
  if (MILEAGE_TRACKED_TYPES.has(t)) return "mileage";
  return "mileage";
}
