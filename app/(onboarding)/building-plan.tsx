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
  // Only the literal "true" routed from add-vehicle counts as AWD.
  const isAwd = oneParam(params.isAwd) === "true";
  const hasMileage = (parseInt(currentMileageStr, 10) || 0) > 0;
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
      { lib: "ion", icon: "calendar", label: "Seasonal intervals", anim: "bounce" },
      { lib: "ion", icon: "settings", label: "Mileage + wear", anim: "spin" },
    ],
    copy: {
      beat1: yearStr && make && model
        ? `Reading your ${yearStr} ${make} ${model}'s service intervals`
        : "Reading your vehicle's service intervals",
      // Vehicles carry no city, so nothing location-specific is claimed here.
      beat2: hasMileage ? "Tailoring it to your vehicle's mileage" : "Tailoring it to your vehicle",
      beat3: (count) => `${count} items written to your plan`,
      slow: "Still working. Some vehicles take up to a minute.",
    },
    failedTitle: "Couldn’t build your schedule",
    failedSubtitle: "Your vehicle is saved. Retry now, or build it later from the vehicle screen.",
    invokeGenerate: async (signal) => {
      const { data, error } = await supabase.functions.invoke("generate-maintenance-schedule", {
        body: {
          vehicle_id: vehicleId, make, model,
          year: parseInt(yearStr, 10) || new Date().getFullYear(),
          current_mileage: parseInt(currentMileageStr, 10) || 0,
          current_hours: parseFloat(currentHoursStr) || 0,
          tracking_mode: trackingMode, vehicle_type: fuelType,
          vehicle_category: vehicleCategory, is_awd: isAwd,
        },
        signal,
      });
      if (!error) return { kind: "success", data };
      const status = getInvokeStatus(error);
      // 409 = lock held or rows already exist. Never a success on its own.
      if (status === 409) return { kind: "conflict" };
      if (__DEV__) console.warn("[onboarding] schedule generation error:", error.message);
      return { kind: "failure", status, error };
    },
    onGenerated: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", vehicleId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  };

  return <BuildingScene config={config} />;
}
