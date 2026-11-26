import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { BuildingScene, oneParam, getInvokeStatus, type BuildingConfig, type ChipSpec } from "@/components/onboarding/BuildingScene";

export default function BuildingHealthPlanScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const familyMemberId = oneParam(params.familyMemberId);
  const memberName = oneParam(params.memberName) || "your loved one";
  const memberType = oneParam(params.memberType) || "person";
  const petType = oneParam(params.petType);
  const relationship = oneParam(params.relationship);
  const isPet = memberType === "pet";

  const chips: [ChipSpec, ChipSpec, ChipSpec] = isPet
    ? [
        { lib: "ion", icon: "heart", label: "Pet care", anim: "shimmerScale" },
        { lib: "mci", icon: "paw", label: petType || "Pet", anim: "bounce" },
        { lib: "ion", icon: "calendar", label: "Appointments + refills", anim: "pulse" },
      ]
    : [
        { lib: "ion", icon: "heart", label: "Preventive care", anim: "shimmerScale" },
        { lib: "mci", icon: "account-heart", label: relationship || "Person", anim: "bounce" },
        { lib: "ion", icon: "calendar", label: "Appointments + refills", anim: "pulse" },
      ];

  const config: BuildingConfig = {
    tint: Colors.health,
    assetId: familyMemberId,
    assetName: memberName,
    revealVertical: "health",
    analyticsStep: "building_health_plan",
    docIcon: { lib: "ion", icon: "heart" },
    chips,
    copy: {
      beat1: `Reading ${memberName}'s preventive-care guidelines`,
      // Names the factor only; no birth date or age is claimed.
      beat2: `Matching it to ${memberName}'s age`,
      beat3: (count) => `${count} appointments written to your plan`,
      slow: "Still working. Some plans take up to a minute.",
    },
    failedTitle: "Couldn’t build the reminders",
    failedSubtitle: `${memberName} is saved. Retry now, or build reminders later from Health.`,
    invokeGenerate: async (signal) => {
      const { data, error } = await supabase.functions.invoke("generate-health-schedule", {
        body: { family_member_id: familyMemberId },
        signal,
      });
      if (!error) return { kind: "success", data };
      const status = getInvokeStatus(error);
      // 409 = generation lock held. Never a success on its own.
      if (status === 409) return { kind: "conflict" };
      if (__DEV__) console.warn("[onboarding] health schedule error:", error.message);
      return { kind: "failure", status, error };
    },
    onGenerated: () => {
      qc.invalidateQueries({ queryKey: ["family_members"] });
      if (user?.id) qc.invalidateQueries({ queryKey: ["health_appointments", user.id] });
      qc.invalidateQueries({ queryKey: ["member_appointments", familyMemberId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  };

  return <BuildingScene config={config} />;
}
