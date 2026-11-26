import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";
import { BuildingScene, oneParam, getInvokeStatus, type BuildingConfig } from "@/components/onboarding/BuildingScene";

// Lower-case nouns for the status line. Anything unrecognised reads as "home".
const PROPERTY_TYPE_NOUNS: Record<string, string> = {
  house: "house", condo: "condo", apartment: "apartment",
  townhouse: "townhouse", commercial: "commercial building",
  vacation: "vacation home",
};

export default function BuildingPropertyPlanScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const qc = useQueryClient();
  const propertyId = oneParam(params.propertyId);
  const propertyName = oneParam(params.propertyName) || "home";
  const propertyType = oneParam(params.propertyType);
  const yearBuiltStr = oneParam(params.yearBuilt);
  const squareFootageStr = oneParam(params.squareFootage);
  const zipCode = oneParam(params.zipCode);
  const city = oneParam(params.city).trim();
  const propertyNoun = PROPERTY_TYPE_NOUNS[propertyType] ?? "home";

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
      beat1: `Reading your ${propertyNoun}'s maintenance calendar`,
      // City only when the form supplied one; never inferred.
      beat2: city ? `Tailoring it for ${city}` : "Tailoring it to your home's needs",
      beat3: (count) => `${count} items written to your plan`,
      slow: "Still working. Some homes take up to a minute.",
    },
    failedTitle: "Couldn’t build your plan",
    failedSubtitle: "Your home is saved. Retry now, or build it later from the home screen.",
    invokeGenerate: async (signal) => {
      const yearBuiltNum = yearBuiltStr ? parseInt(yearBuiltStr, 10) : null;
      const sqftNum = squareFootageStr ? parseInt(squareFootageStr, 10) : null;
      const { data, error } = await supabase.functions.invoke("generate-property-schedule", {
        body: { property_id: propertyId, property_type: propertyType, year_built: yearBuiltNum, square_footage: sqftNum, zip_code: zipCode || null },
        signal,
      });
      if (!error) return { kind: "success", data };
      const status = getInvokeStatus(error);
      // 409 = rows already exist. Never a success on its own.
      if (status === 409) return { kind: "conflict" };
      if (__DEV__) console.warn("[onboarding] property schedule error:", error.message);
      return { kind: "failure", status, error };
    },
    onGenerated: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["property_tasks", propertyId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  };

  return <BuildingScene config={config} />;
}
