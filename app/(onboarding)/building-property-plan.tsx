import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";
import { BuildingScene, oneParam, getInvokeStatus, type BuildingConfig } from "@/components/onboarding/BuildingScene";

export default function BuildingPropertyPlanScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const qc = useQueryClient();
  const propertyId = oneParam(params.propertyId);
  const propertyName = oneParam(params.propertyName) || "home";
  const propertyType = oneParam(params.propertyType);
  const yearBuiltStr = oneParam(params.yearBuilt);
  const squareFootageStr = oneParam(params.squareFootage);
  const zipCode = oneParam(params.zipCode);

  const config: BuildingConfig = {
    tint: Colors.home,
    assetId: propertyId,
    assetName: propertyName,
    revealVertical: "home",
    analyticsStep: "building_property_plan",
    docIcon: { lib: "mci", icon: "home-variant" },
    chips: [
      { lib: "mci", icon: "weather-partly-cloudy", label: "Climate zone", anim: "shimmer" },
      { lib: "ion", icon: "location", label: "ZIP + region", anim: "bounce" },
      { lib: "mci", icon: "home-variant-outline", label: "Seasonal upkeep", anim: "spinSequence" },
    ],
    copy: {
      initial: "Reading regional climate data",
      beat1: `Reading ${propertyName}’s climate zone`,
      beat2: "Checking seasonal maintenance",
      beat3: "Building your home checklist",
      slow: "Cross-checking the schedule — a few more seconds.",
      ready: "Your home plan is ready.",
    },
    failedTitle: "Couldn’t build your plan",
    failedSubtitle: "Your home is saved. Retry now, or build it later from the home screen.",
    invokeGenerate: async () => {
      const yearBuiltNum = yearBuiltStr ? parseInt(yearBuiltStr, 10) : null;
      const sqftNum = squareFootageStr ? parseInt(squareFootageStr, 10) : null;
      const { error } = await supabase.functions.invoke("generate-property-schedule", {
        body: { property_id: propertyId, property_type: propertyType, year_built: yearBuiltNum, square_footage: sqftNum, zip_code: zipCode || null },
      });
      if (!error) return { ok: true };
      const status = getInvokeStatus(error);
      if (status === 409) return { ok: true };
      if (__DEV__) console.warn("[onboarding] property schedule error:", error.message);
      return { ok: false, status, error };
    },
    onGenerated: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["property_tasks", propertyId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  };

  return <BuildingScene config={config} />;
}
