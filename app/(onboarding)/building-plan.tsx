import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";
import { BuildingScene, oneParam, getInvokeStatus, type BuildingConfig } from "@/components/onboarding/BuildingScene";

export default function BuildingPlanScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const qc = useQueryClient();
  const vehicleId = oneParam(params.vehicleId);
  const make = oneParam(params.make);
  const model = oneParam(params.model);
  const yearStr = oneParam(params.year);
  const currentMileageStr = oneParam(params.currentMileage);
  const currentHoursStr = oneParam(params.currentHours);
  const trackingMode = oneParam(params.trackingMode);
  const fuelType = oneParam(params.fuelType) || "gas";
  const vehicleCategory = oneParam(params.vehicleCategory);
  const displayName = (oneParam(params.vehicleName) || `${yearStr} ${make} ${model}`).trim();

  const config: BuildingConfig = {
    tint: Colors.accent,
    assetId: vehicleId,
    assetName: displayName,
    revealVertical: "vehicle",
    analyticsStep: "building_plan",
    docIcon: { lib: "ion", icon: "document-text" },
    chips: [
      { lib: "mci", icon: "book-open-variant", label: "Factory manual", anim: "shimmer" },
      { lib: "ion", icon: "location", label: "Local climate", anim: "bounce" },
      { lib: "ion", icon: "settings", label: "Mileage + wear", anim: "spin" },
    ],
    copy: {
      initial: "Reading the factory service manual",
      beat1: `Reading ${displayName}’s service manual`,
      beat2: "Checking your local climate",
      beat3: "Building your personalized plan",
      slow: "Cross-checking the schedule — a few more seconds.",
      ready: "Your plan is ready.",
    },
    failedTitle: "Couldn’t build your schedule",
    failedSubtitle: "Your vehicle is saved. Retry now, or build it later from the vehicle screen.",
    invokeGenerate: async () => {
      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
        body: {
          vehicle_id: vehicleId, make, model,
          year: parseInt(yearStr, 10) || new Date().getFullYear(),
          current_mileage: parseInt(currentMileageStr, 10) || 0,
          current_hours: parseFloat(currentHoursStr) || 0,
          tracking_mode: trackingMode, vehicle_type: fuelType,
          vehicle_category: vehicleCategory, is_awd: false,
        },
      });
      if (!error) return { ok: true };
      const status = getInvokeStatus(error);
      if (status === 409) return { ok: true };
      if (__DEV__) console.warn("[onboarding] schedule generation error:", error.message);
      return { ok: false, status, error };
    },
    onGenerated: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", vehicleId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  };

  return <BuildingScene config={config} />;
}
