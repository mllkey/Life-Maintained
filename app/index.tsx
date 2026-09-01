import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { needsTermsAcceptance } from "@/lib/legalDates";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "@/constants/colors";

export default function RootIndex() {
  const { session, isLoading, profileLoaded, onboardingCompleted, profile } = useAuth();

  // Wait until auth AND profile are both fully resolved before making any routing decision.
  // Also hold while terms are pending: the reactive guard in app/_layout.tsx owns that navigation.
  if (isLoading || (!!session && !profileLoaded) || needsTermsAcceptance(profile)) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)" />;
  }

  if (!onboardingCompleted) {
    return <Redirect href="/(onboarding)" />;
  }

  return <Redirect href="/(tabs)" />;
}
