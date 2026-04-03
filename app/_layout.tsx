import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus, Platform, View } from "react-native";
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
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { setPendingResetUrl } from "@/lib/pendingResetUrl";
import { signalRcReady, rcReady } from "@/lib/revenuecat";

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

const VOICE_LOG_URL = "lifemaintained://voice-log";

function RootLayoutNav() {
  const { session, isLoading, onboardingCompleted, refreshProfile } = useAuth();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const rcListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (!session?.user?.id || !onboardingCompleted) return;
    const userId = session.user.id;

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

  useEffect(() => {
    if (!session?.user?.id || Platform.OS === "web") return;
    const userId = session.user.id;

    (async () => {
      try {
        await rcReady;
        const Purchases = (await import("react-native-purchases")).default;
        await Purchases.logIn(userId);

        if (rcListenerRef.current) {
          rcListenerRef.current();
          rcListenerRef.current = null;
        }

        const doWrite = async (info: any) => {
          const active = info?.entitlements?.active ?? {};
          const expiry = (key: string) =>
            active[key]?.expirationDate ?? null;

          let newTier: string | null = null;
          let newExpiry: string | null = null;

          if (active["business_access"] != null) {
            newTier = "business";
            newExpiry = expiry("business_access");
          } else if (active["pro_access"] != null) {
            newTier = "pro";
            newExpiry = expiry("pro_access");
          } else if (active["personal_access"] != null) {
            newTier = "personal";
            newExpiry = expiry("personal_access");
          }

          if (newTier) {
            const { error } = await supabase.from("profiles").update({
              subscription_tier: newTier,
              subscription_expires_at: newExpiry,
              revenuecat_customer_id: info.originalAppUserId ?? null,
            }).eq("user_id", userId);
            if (error) throw error;
          } else {
            const { data: prof, error: fetchError } = await supabase
              .from("profiles")
              .select("trial_expires_at")
              .eq("user_id", userId)
              .maybeSingle();
            if (fetchError) throw fetchError;
            const stillTrial =
              prof &&
              (prof as any).trial_expires_at &&
              new Date((prof as any).trial_expires_at) > new Date();
            if (!stillTrial) {
              const { error } = await supabase.from("profiles").update({
                subscription_tier: "free",
              }).eq("user_id", userId);
              if (error) throw error;
            }
          }
          refreshProfile().catch(() => {});
        };

        const listener = async (info: any) => {
          try {
            await doWrite(info);
          } catch (e) {
            console.error("[RevenueCat] Subscription write failed, retrying:", e);
            try {
              await doWrite(info);
            } catch (e2) {
              console.error("[RevenueCat] Subscription write retry failed:", e2);
            }
          }
        };

        Purchases.addCustomerInfoUpdateListener(listener);
        rcListenerRef.current = () => Purchases.removeCustomerInfoUpdateListener(listener);
      } catch (e) {
        console.error("[RevenueCat] logIn failed:", e);
      }
    })();

    return () => {
      if (rcListenerRef.current) {
        rcListenerRef.current();
        rcListenerRef.current = null;
      }
    };
  }, [session?.user?.id]);

  // Deep link: lifemaintained://reset-password → password reset (no session gate)
  useEffect(() => {
    const handleResetUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        if (parsed.scheme === "lifemaintained" && parsed.path === "reset-password") {
          const { router } = require("expo-router");
          setPendingResetUrl(url);
          router.push("/reset-password");
        }
      } catch {}
    };

    // Foreground only — cold start is handled by Expo Router + the screen itself
    const sub = Linking.addEventListener("url", (e) => handleResetUrl(e.url));
    return () => sub.remove();
  }, []);

  // Deep link: lifemaintained://voice-log → navigate to dashboard tab
  useEffect(() => {
    if (!session || isLoading) return;
    const { router } = require("expo-router");

    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        if (parsed.scheme === "lifemaintained" && parsed.path === "voice-log") {
          router.navigate("/(tabs)");
        }
      } catch {}
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [session, isLoading]);

  const showBanner = !!session && onboardingCompleted === true;

  return (
    <BudgetAlertProvider userId={session?.user?.id ?? null}>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add-vehicle" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="edit-vehicle" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="vehicle/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="log-service/[vehicleId]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="add-property" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="property/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="add-property-task/[propertyId]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="property-task-history/[propertyId]" options={{ headerShown: false }} />
          <Stack.Screen name="vehicle-task-history/[vehicleId]" options={{ headerShown: false }} />
          <Stack.Screen name="family-member/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="add-appointment" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="add-medication" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="add-family-member" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="health-profile" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="update-mileage/[vehicleId]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="subscription" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="notifications-settings" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="terms-of-service" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="privacy-policy" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false, presentation: "fullScreenModal" }} />
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

  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      try {
        const Purchases = (await import("react-native-purchases")).default;
        const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
        if (apiKey && apiKey !== "YOUR_REVENUECAT_API_KEY_HERE") {
          if (__DEV__ && apiKey.startsWith("test_")) {
            console.warn("[RevenueCat] Using TEST key — replace with production key (appl_) before App Store submission");
          }
          Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
          Purchases.configure({ apiKey });
          signalRcReady();
        }
      } catch (e) {
        console.error("[RevenueCat] Configure failed:", e);
        signalRcReady();
      }
    })();
  }, []);

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
