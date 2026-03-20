export const MILEAGE_TRACKED_TYPES = new Set([
  "car",
  "motorcycle",
  "rv",
  "utv",
  "snowmobile",
  "dump_truck",
]);

// Vehicle types that are maintained on a time-only basis (no mileage tracking).
export const TIME_ONLY_TYPES = new Set(["boat", "pwc", "trailer", "dump_trailer", "dumpster"]);
