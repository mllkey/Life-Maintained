import { Stack } from "expo-router";
import { Colors } from "@/constants/colors";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="building-plan" options={{ gestureEnabled: false }} />
      <Stack.Screen name="building-property-plan" options={{ gestureEnabled: false }} />
      <Stack.Screen name="building-health-plan" options={{ gestureEnabled: false }} />
      <Stack.Screen name="plan-reveal" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
