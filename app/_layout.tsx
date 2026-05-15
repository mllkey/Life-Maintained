import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: Constants.expoConfig?.extra?.sentryDsn,
  enabled: !__DEV__,
  environment: __DEV__ ? 'development' : 'production',
  release:
    nativeApplicationVersion && nativeBuildVersion
      ? `com.lifemaintained.app@${nativeApplicationVersion}+${nativeBuildVersion}`
      : undefined,
  dist: nativeBuildVersion ?? undefined,
  tracesSampleRate: 0.2,
});

import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { PostHogProvider } from "posthog-react-native";
import { analyticsClient, capture } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Colors } from "@/constants/colors";
import NotifPermissionBanner from "@/components/NotifPermissionBanner";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import { BudgetAlertProvider } from "@/context/BudgetAlertContext";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { setPendingResetUrl } from "@/lib/pendingResetUrl";
import { signalRcReady, rcReady } from "@/lib/revenuecat";
import Constants from 'expo-constants';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';

SplashScreen.preventAutoHideAsync();


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const VOICE_LOG_URL = "lifemaintained://voice-log";

focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    handleFocus(state === "active");
  });
  return () => subscription.remove();
});

// G10.2 — module-scope debounce ref for profiles.last_active_at upsert.
// Survives component remounts; resets only on cold start.
let lastActiveUpsertAt = 0;

function RootLayoutNav() {
  const { session, isLoading, onboardingCompleted, refreshProfile } = useAuth();
  const pathname = usePathname();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (!session?.user?.id || !onboardingCompleted) return;
    const userId = session.user.id;

    Notifications.setBadgeCountAsync(0).catch(() => {});
    capture("app_opened", {});
    const initialScheduleTimer = setTimeout(() => {
      scheduleMaintenanceNotifications(userId);
    }, 800);

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && prev !== "active") {
        Notifications.setBadgeCountAsync(0).catch(() => {});
        scheduleMaintenanceNotifications(userId);
        capture("app_foregrounded", {});
        // G10.2 — debounced last_active_at upsert (60s). Closes PASS-E-002.
        // Non-blocking; rolls back ref on error so next foreground retries.
        const nowMs = Date.now();
        if (nowMs - lastActiveUpsertAt >= 60000) {
          lastActiveUpsertAt = nowMs;
          supabase
            .from("profiles")
            .update({ last_active_at: new Date(nowMs).toISOString() })
            .eq("user_id", userId)
            .then(({ error }) => {
              if (error) {
                lastActiveUpsertAt = 0;
              }
            });
        }
      }
    });

    return () => {
      clearTimeout(initialScheduleTimer);
      sub.remove();
    };
  }, [session?.user?.id, onboardingCompleted]);

  useEffect(() => {
    if (!session?.user?.id || Platform.OS === "web") return;
    const userId = session.user.id;

    (async () => {
      try {
        await rcReady;
        const Purchases = (await import("react-native-purchases")).default;
        await Purchases.logIn(userId);
      } catch (e) {
        console.error("[RevenueCat] logIn failed:", e);
      }
    })();
  }, [session?.user?.id]);

  // RC customerInfoUpdate listener — keeps the client in sync with background
  // renewals, expirations, and billing-issue resolutions even when the
  // server-side webhook is delayed or hasn't fired yet. Throttled at 5s
  // because RevenueCat can emit multiple customerInfo updates in quick
  // succession; the Paywall flow handles its own post-purchase sync directly.
  useEffect(() => {
    if (!session?.user?.id || Platform.OS === "web") return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    let lastSyncAt = 0;

    (async () => {
      try {
        await rcReady;
        if (cancelled) return;
        const Purchases = (await import("react-native-purchases")).default;
        const { syncSubscriptionFromRc } = await import("@/lib/revenuecat");

        const handler = async () => {
          const now = Date.now();
          if (now - lastSyncAt < 5000) return;
          lastSyncAt = now;

          try {
            const result = await syncSubscriptionFromRc();
            if (result.ok) {
              await refreshProfile();
            }
          } catch (e) {
            console.error("[RevenueCat] customerInfoUpdate handler failed:", e);
          }
        };

        Purchases.addCustomerInfoUpdateListener(handler);
        cleanup = () => {
          try {
            Purchases.removeCustomerInfoUpdateListener(handler);
          } catch (e) {
            console.warn("[RevenueCat] listener cleanup failed:", e);
          }
        };
      } catch (e) {
        console.error("[RevenueCat] listener setup failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [session?.user?.id, refreshProfile]);

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

  // Deep-link from a tapped notification routes to the specific item on its
  // detail screen. Component-scoped ref so dedup survives effect re-runs from
  // session/isLoading hydration.
  const handledNotifIds = useRef<Set<string>>(new Set());
  const recordNotifDeepLink = (
    message: string,
    data?: Record<string, string | number | boolean | null>,
  ) => {
    Sentry.addBreadcrumb({ category: "notification.deeplink", level: "info", message, data });
    Sentry.captureMessage(`[NotifDeepLink] ${message}`, { level: "info", extra: data });
  };

  useEffect(() => {
    recordNotifDeepLink("pathname_changed", { pathname });
  }, [pathname]);

  useEffect(() => {
    recordNotifDeepLink("effect_entered", { hasSession: !!session, isLoading, userId: session?.user?.id ?? null });
    if (!session || isLoading) {
      recordNotifDeepLink("effect_blocked", { hasSession: !!session, isLoading });
      return;
    }
    const { router } = require("expo-router");

    const routeFromResponse = (response: Notifications.NotificationResponse | null, source: string) => {
      recordNotifDeepLink("route_start", { source, hasResponse: !!response });
      if (!response) return;
      const reqId = response.notification.request.identifier;
      recordNotifDeepLink("response_seen", { source, reqId });
      if (handledNotifIds.current.has(reqId)) {
        recordNotifDeepLink("duplicate_skipped", { source, reqId });
        return;
      }

      const raw = response.notification.request.content.data;
      if (!raw || typeof raw !== "object") {
        recordNotifDeepLink("payload_invalid_container", { source, reqId });
        return;
      }
      const d = raw as { assetId?: unknown; assetKind?: unknown; taskId?: unknown; taskKind?: unknown };
      const assetId = typeof d.assetId === "string" ? d.assetId : null;
      const assetKind = typeof d.assetKind === "string" ? d.assetKind : null;
      const taskId = typeof d.taskId === "string" ? d.taskId : null;
      const taskKind = typeof d.taskKind === "string" ? d.taskKind : null;
      recordNotifDeepLink("payload_parsed", { source, reqId, assetId, assetKind, taskId, taskKind });
      if (!assetId || !taskId || !assetKind || !taskKind) {
        recordNotifDeepLink("payload_missing_required_field", { source, reqId, hasAssetId: !!assetId, hasTaskId: !!taskId, hasAssetKind: !!assetKind, hasTaskKind: !!taskKind });
        return;
      }

      try {
        if (assetKind === "vehicle" && taskKind === "vehicle_task") {
          recordNotifDeepLink("router_push_attempt", { source, reqId, route: "vehicle" });
          router.push({ pathname: "/vehicle/[id]", params: { id: assetId, taskId } });
          recordNotifDeepLink("router_push_returned", { source, reqId, route: "vehicle" });
        } else if (assetKind === "property" && taskKind === "property_task") {
          recordNotifDeepLink("router_push_attempt", { source, reqId, route: "property" });
          router.push({ pathname: "/property/[id]", params: { id: assetId, taskId } });
          recordNotifDeepLink("router_push_returned", { source, reqId, route: "property" });
        } else if (assetKind === "family_member" && taskKind === "health_appointment") {
          recordNotifDeepLink("router_push_attempt", { source, reqId, route: "family_appointment" });
          router.push({ pathname: "/family-member/[id]", params: { id: assetId, appointmentId: taskId } });
          recordNotifDeepLink("router_push_returned", { source, reqId, route: "family_appointment" });
        } else if (assetKind === "family_member" && taskKind === "medication") {
          recordNotifDeepLink("router_push_attempt", { source, reqId, route: "family_medication" });
          router.push({ pathname: "/family-member/[id]", params: { id: assetId, medicationId: taskId } });
          recordNotifDeepLink("router_push_returned", { source, reqId, route: "family_medication" });
        } else {
          recordNotifDeepLink("payload_no_matching_route", { source, reqId, assetKind, taskKind });
          return;
        }
        handledNotifIds.current.add(reqId);
        supabase.from("notification_events").update({ response_received_at: new Date().toISOString() }).eq("notif_id", reqId).then(
          ({ error }) => recordNotifDeepLink("response_update_completed", { source, reqId, hasError: !!error, errorMessage: error?.message ?? null }),
          (error) => recordNotifDeepLink("response_update_rejected", { source, reqId, errorMessage: error instanceof Error ? error.message : "unknown" }),
        );
        capture("notification_opened", { asset_kind: assetKind, task_kind: taskKind });
      } catch (e) {
        Sentry.captureException(e, { tags: { area: "notification_deeplink" }, extra: { source, reqId, assetId, assetKind, taskId, taskKind } });
        recordNotifDeepLink("router_push_threw", { source, reqId, errorMessage: e instanceof Error ? e.message : "unknown" });
        console.warn("[NotifDeepLink] route failed:", e);
      }
    };

    const initialRouteTimer = setTimeout(() => {
      const lastResponse = Notifications.getLastNotificationResponse();
      recordNotifDeepLink("initial_response_read", { hasResponse: !!lastResponse, reqId: lastResponse?.notification.request.identifier ?? null });
      routeFromResponse(lastResponse, "initial_500ms");
    }, 500);

    const sub = Notifications.addNotificationResponseReceivedListener((response) => routeFromResponse(response, "listener"));
    recordNotifDeepLink("listener_registered", { isLoading, hasSession: !!session });
    return () => {
      clearTimeout(initialRouteTimer);
      sub.remove();
      recordNotifDeepLink("listener_removed", { isLoading, hasSession: !!session });
    };
  }, [session, isLoading, pathname]);

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
        {showBanner && <NotifPermissionBanner userId={session?.user?.id} />}
      </View>
    </BudgetAlertProvider>
  );
}

function RootLayout() {
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
          if (__DEV__) {
            Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
          } else {
            Purchases.setLogLevel(Purchases.LOG_LEVEL.WARN);
          }
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
    <ErrorBoundary onError={(error, componentStack) => {
        Sentry.captureException(error, { extra: { componentStack } });
      }}>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            {analyticsClient ? (
              <PostHogProvider client={analyticsClient}>
                <AuthProvider>
                  <RootLayoutNav />
                </AuthProvider>
              </PostHogProvider>
            ) : (
              <AuthProvider>
                <RootLayoutNav />
              </AuthProvider>
            )}
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
