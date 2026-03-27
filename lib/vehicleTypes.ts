/**
 * lib/vehicleTypes.ts
 *
 * Vehicle type classification sets and tracking mode inference.
 * These sets are used as DEFAULT HEURISTICS — the DB column `vehicles.tracking_mode`
 * is the source of truth. These are fallbacks for when tracking_mode is NULL.
 */

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

export const TIME_ONLY_TYPES = new Set([
  "trailer",
  "dump_trailer",
  "dumpster",
]);

export const HOURS_TRACKED_TYPES = new Set([
  "boat",
  "pwc",
  "lawnmower",
  "lawn_mower",
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

/**
 * Infer tracking mode from vehicle type string.
 * Only used as a fallback when `vehicles.tracking_mode` is NULL.
 */
export function inferTrackingMode(vehicleType: string): "mileage" | "hours" | "time_only" {
  const t = (vehicleType ?? "").toLowerCase().trim();
  if (HOURS_TRACKED_TYPES.has(t)) return "hours";
  if (TIME_ONLY_TYPES.has(t)) return "time_only";
  return "mileage";
}