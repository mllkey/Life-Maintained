import React, { useEffect } from "react";
import { Stack, router } from "expo-router";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function AuthLayout() {
  const { session, profileLoaded } = useAuth();

  useEffect(() => {
    if (session && profileLoaded) {
      router.replace("/");
    }
  }, [session, profileLoaded]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify" />
    </Stack>
  );
}
