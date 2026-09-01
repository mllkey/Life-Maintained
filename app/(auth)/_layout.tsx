import React from "react";
import { Stack, router, useSegments } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { needsTermsAcceptance } from "@/lib/legalDates";

export default function AuthLayout() {
  const { session, isLoading, profileLoaded, onboardingCompleted, profile } = useAuth();
  const segments = useSegments();

  React.useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";

    if (!inAuthGroup) return;
    if (!session) return;
    if (isLoading) return;
    if (!profileLoaded) return;

    // Terms pending: the reactive guard in app/_layout.tsx routes to the review sheet instead.
    if (needsTermsAcceptance(profile)) return;

    router.replace(onboardingCompleted ? "/(tabs)" : "/(onboarding)");
  }, [segments, session, isLoading, profileLoaded, onboardingCompleted, profile]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
