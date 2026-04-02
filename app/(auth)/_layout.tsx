import React from "react";
import { Stack, router, useSegments } from "expo-router";
import { useAuth } from "@/context/AuthContext";

export default function AuthLayout() {
  const { session, isLoading, profileLoaded, onboardingCompleted } = useAuth();
  const segments = useSegments();

  React.useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";

    if (!inAuthGroup) return;
    if (!session) return;
    if (isLoading) return;
    if (!profileLoaded) return;

    router.replace(onboardingCompleted ? "/(tabs)" : "/(onboarding)");
  }, [segments, session, isLoading, profileLoaded, onboardingCompleted]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
