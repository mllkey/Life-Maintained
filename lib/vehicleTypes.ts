export const MILEAGE_TRACKED_TYPES = new Set([
  "car",
  "motorcycle",
  "rv",
  "utv",
  "snowmobile",
  "dump_truck",
  "other",
  "atv",
]);

// Vehicle types that are maintained on a time-only basis (no mileage tracking).
export const TIME_ONLY_TYPES = new Set(["trailer", "dump_trailer", "dumpster"]);

export const HOURS_TRACKED_TYPES = new Set(["boat", "pwc"]);
