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
      <Stack.Screen name="vehicle-quick-add" />
      <Stack.Screen name="building-plan" />
      <Stack.Screen name="value-reveal" />
    </Stack>
  );
}
