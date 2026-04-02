import React from "react";
import { Stack, router, useSegments } from "expo-router";
import { useAuth } from "@/context/AuthContext";

export default function AuthLayout() {
  const { session, profileLoaded } = useAuth();
  const segments = useSegments();

  React.useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";

    if (inAuthGroup && session && profileLoaded) {
      router.replace("/");
    }
  }, [segments, session, profileLoaded]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
