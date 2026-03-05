import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Colors } from "@/constants/colors";
import NotifPermissionBanner from "@/components/NotifPermissionBanner";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import { BudgetAlertProvider } from "@/context/BudgetAlertContext";
import * as Notifications from "expo-notifications";
import { ActivityIndicator } from "react-native";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function RootLayoutNav() {
  const { session, isLoading, onboardingCompleted } = useAuth();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (!session?.user?.id || !onboardingCompleted) return;

    const userId = session.user.id;
    userIdRef.current = userId;

    Notifications.setBadgeCountAsync(0).catch(() => {});
    scheduleMaintenanceNotifications(userId);

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && prev !== "active") {
        Notifications.setBadgeCountAsync(0).catch(() => {});
        scheduleMaintenanceNotifications(userId);
      }
    });

    return () => sub.remove();
  }, [session?.user?.id, onboardingCompleted]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  const showBanner = !!session && onboardingCompleted === true;

  return (
    <BudgetAlertProvider userId={session?.user?.id ?? null}>
    <View style={{ flex: 1 }}>
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
      {showBanner && <NotifPermissionBanner />}
    </View>
    </BudgetAlertProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

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
