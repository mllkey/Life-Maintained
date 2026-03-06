import React, { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import Paywall from "@/components/Paywall";

export default function OnboardingCompleteScreen() {
  const { user, setOnboardingCompleted } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  async function completeOnboarding() {
    if (!user || isSaving) return;
    setIsSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (error) {
      await supabase
        .from("profiles")
        .upsert({ user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() });
    }

    setOnboardingCompleted(true);
    router.replace("/(tabs)");
  }

  return (
    <Paywall
      canDismiss={false}
      showSkip
      subtitle="You're all set! Start your free trial to unlock everything."
      onDismiss={completeOnboarding}
      onSkip={completeOnboarding}
    />
  );
}
