import type React from "react";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

export type VehicleGlyph =
  | { family: "ionicons"; name: React.ComponentProps<typeof Ionicons>["name"] }
  | { family: "mci"; name: React.ComponentProps<typeof MaterialCommunityIcons>["name"] };

/**
 * Maps a vehicles.vehicle_type value to its glyph. Names mirror the type grid
 * in app/add-vehicle.tsx so the picker and the list row show the same icon.
 * "dumpster" uses "trash-can": the grid's own "dumpster" name does not exist
 * in the installed MaterialCommunityIcons set.
 */
export function vehicleGlyph(vehicleType: string | null | undefined): VehicleGlyph {
  switch (vehicleType) {
    // Vehicles
    case "car":                  return { family: "mci", name: "car" };
    case "motorcycle":           return { family: "mci", name: "motorbike" };
    case "semi_truck":           return { family: "mci", name: "truck-cargo-container" };
    case "rv":                   return { family: "mci", name: "rv-truck" };
    case "atv":                  return { family: "mci", name: "atv" };
    case "utv":                  return { family: "mci", name: "go-kart" };
    case "snowmobile":           return { family: "mci", name: "snowmobile" };

    // Marine
    case "boat":                 return { family: "mci", name: "sail-boat" };
    case "pwc":                  return { family: "mci", name: "ski-water" };

    // Small equipment
    case "lawnmower":            return { family: "mci", name: "mower" };
    case "chainsaw":             return { family: "mci", name: "hand-saw" };
    case "generator":            return { family: "mci", name: "lightning-bolt" };
    case "snow_blower":          return { family: "mci", name: "snowflake" };
    case "pressure_washer":      return { family: "mci", name: "water-pump" };
    case "wood_chipper":         return { family: "mci", name: "tree" };
    case "stump_grinder":        return { family: "mci", name: "saw-blade" };
    case "concrete_saw":         return { family: "mci", name: "saw-blade" };
    case "welder":               return { family: "mci", name: "flash" };

    // Heavy equipment
    case "excavator":            return { family: "mci", name: "excavator" };
    case "skid_steer":           return { family: "mci", name: "bulldozer" };
    case "mini_excavator":       return { family: "mci", name: "excavator" };
    case "compact_track_loader": return { family: "mci", name: "tank" };
    case "backhoe":              return { family: "mci", name: "tractor" };
    case "wheel_loader":         return { family: "mci", name: "tractor-variant" };
    case "telehandler":          return { family: "mci", name: "forklift" };
    case "forklift":             return { family: "mci", name: "forklift" };

    // Commercial
    case "dump_truck":           return { family: "mci", name: "dump-truck" };
    case "trailer":              return { family: "mci", name: "truck-trailer" };
    case "dumpster":             return { family: "mci", name: "trash-can" };

    // Other
    case "other":                return { family: "mci", name: "wrench" };
    default:                     return { family: "ionicons", name: "car-outline" };
  }
}
