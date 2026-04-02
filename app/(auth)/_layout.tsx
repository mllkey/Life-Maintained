import React, { useEffect, useRef } from "react";
import { Stack, router } from "expo-router";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function AuthLayout() {
  const { session, profileLoaded } = useAuth();
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!session) {
      navigatedRef.current = false;
    } else if (profileLoaded && !navigatedRef.current) {
      navigatedRef.current = true;
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
