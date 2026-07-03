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
  const petLabel = petType ? petType.toLowerCase() : "pet";
  const relLabel = relationship ? relationship.toLowerCase() : "this person";

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
      initial: isPet ? "Reading pet care guidance" : "Reading preventive-care guidelines",
      beat1: isPet ? `Pulling ${petLabel} care intervals` : `Pulling preventive care for ${relLabel}`,
      beat2: isPet ? "Checking vaccination cadence" : "Checking annual visit intervals",
      beat3: `Building ${memberName}’s reminders`,
      slow: "Cross-checking the schedule — a few more seconds.",
      ready: "Care reminders are ready.",
    },
    failedTitle: "Couldn’t build the reminders",
    failedSubtitle: `${memberName} is saved. Retry now, or build reminders later from Health.`,
    invokeGenerate: async () => {
      const { error } = await supabase.functions.invoke("generate-health-schedule", {
        body: { family_member_id: familyMemberId },
      });
      if (!error) return { ok: true };
      const status = getInvokeStatus(error);
      if (status === 409) return { ok: true };
      if (__DEV__) console.warn("[onboarding] health schedule error:", error.message);
      return { ok: false, status, error };
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
