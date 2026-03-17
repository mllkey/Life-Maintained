import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "@/constants/colors";

export default function RootIndex() {
  const { session, isLoading, profileLoaded, onboardingCompleted, profile } = useAuth();

  // Wait until auth AND profile are both fully resolved before making any routing decision.
  if (isLoading || (!!session && !profileLoaded)) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  // Routing decision — log exactly what values are driving it.
  console.log("[ROUTING] session:", !!session);
  console.log("[ROUTING] isLoading:", isLoading);
  console.log("[ROUTING] profileLoaded:", profileLoaded);
  console.log("[ROUTING] profile:", JSON.stringify(profile));
  console.log("[ROUTING] onboardingCompleted:", onboardingCompleted);

  if (!session) {
    console.log("[ROUTING] → /(auth) — no session");
    return <Redirect href="/(auth)" />;
  }

  if (!onboardingCompleted) {
    console.log("[ROUTING] → /(onboarding) — onboardingCompleted is false");
    return <Redirect href="/(onboarding)" />;
  }

  console.log("[ROUTING] → /(tabs) — session + onboarding done");
  return <Redirect href="/(tabs)" />;
}
