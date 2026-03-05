import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Colors } from "@/constants/colors";
import NotifPermissionBanner from "@/components/NotifPermissionBanner";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { session, isLoading, onboardingCompleted } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(onboarding)" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="add-vehicle" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="vehicle/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="log-service/[vehicleId]" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="add-property" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="property/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="add-property-task/[propertyId]" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="property-task-history/[propertyId]" options={{ headerShown: false }} />
      <Stack.Screen name="vehicle-task-history/[vehicleId]" options={{ headerShown: false }} />
      <Stack.Screen name="family-member/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="add-appointment" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="add-medication" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="add-family-member" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="health-profile" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="update-mileage/[vehicleId]" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="subscription" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="notifications-settings" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="terms-of-service" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="privacy-policy" options={{ headerShown: false, presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <AuthProvider>
              <RootLayoutNav />
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
