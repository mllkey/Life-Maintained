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

import { QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { Stack, router, usePathname, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
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
import { UndoToastHost } from "@/components/UndoToast";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import { checkAgingTransitions } from "@/lib/agingTransitions";

// Covers the entire sweep -> central rebuild -> crossing-banner pipeline.
// Cold-start and foreground triggers share one run, so a later cancel-all
// cannot erase a banner scheduled by an overlapping earlier run.
let agingAwareSchedulingInFlight: Promise<void> | null = null;

function runAgingAwareScheduling(userId: string): Promise<void> {
  if (agingAwareSchedulingInFlight) return agingAwareSchedulingInFlight;

  const run = (async () => {
    let sweep: Awaited<ReturnType<typeof checkAgingTransitions>> | null = null;
    try {
      sweep = await checkAgingTransitions(userId, queryClient);
    } catch {}

    let schedulerReady = false;
    try {
      schedulerReady = await scheduleMaintenanceNotifications(userId);
    } catch {}

    // False means web, permission denied, native warmup failure, the user's
    // push toggle is off, or the central rebuild failed. Never bypass those
    // states by independently scheduling an aging banner.
    if (!schedulerReady || !sweep) return;

    for (const b of sweep.banners) {
      try {
        await Notifications.scheduleNotificationAsync({
          content: { title: b.title, body: b.body, sound: "default" },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, repeats: false },
        });
      } catch {}
    }
  })();

  agingAwareSchedulingInFlight = run;
  run.finally(() => {
    if (agingAwareSchedulingInFlight === run) agingAwareSchedulingInFlight = null;
  }).catch(() => {});
  return run;
}
import { BudgetAlertProvider } from "@/context/BudgetAlertContext";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import * as Network from "expo-network";
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

if (Platform.OS !== "web") {
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((state) => {
      setOnline(state.isInternetReachable ?? state.isConnected ?? true);
    });
    return () => sub.remove();
  });
  Network.getNetworkStateAsync()
    .then((state) => onlineManager.setOnline(state.isInternetReachable ?? state.isConnected ?? true))
    .catch(() => {});
}

// Module-scope debounce ref for profiles.last_active_at upsert.
// Survives component remounts; resets only on cold start.
let lastActiveUpsertAt = 0;

function RootLayoutNav() {
  const { session, isLoading, onboardingCompleted, refreshProfile } = useAuth();
  const rootNavigationState = useRootNavigationState();
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
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
      runAgingAwareScheduling(userId).catch(() => {});
    }, 800);

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && prev !== "active") {
        Notifications.setBadgeCountAsync(0).catch(() => {});
        runAgingAwareScheduling(userId).catch(() => {});
        capture("app_foregrounded", {});
        // Debounced last_active_at upsert. Non-blocking; rolls back the
        // ref on error so the next foreground can retry.
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

  // Deep link: lifemaintained://voice-log → navigate to dashboard tab
  useEffect(() => {
    if (!session || isLoading) return;

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
  const pendingNotifResponses = useRef<Array<{ response: Notifications.NotificationResponse; source: string }>>([]);
  const notifRoutingReady = useRef(false);
  const hasEverSeenSession = useRef(false);
  const unauthClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readinessRetryTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const routeVerifyTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [pendingNotifSignal, setPendingNotifSignal] = useState(0);

  const emitNotifRouteDiagnostic = (
    message: string,
    data?: Record<string, string | number | boolean | null>,
  ) => {
    Sentry.captureMessage(`[notification_deeplink] ${message}`, {
      level: "info",
      tags: {
        area: "notification_deeplink",
        diagnostic: "route_verification",
        source: typeof data?.source === "string" ? data.source : "unknown",
      },
      extra: {
        ...(data ?? {}),
        release: `${nativeApplicationVersion ?? "unknown"}+${nativeBuildVersion ?? "unknown"}`,
        nativeApplicationVersion: nativeApplicationVersion ?? null,
        nativeBuildVersion: nativeBuildVersion ?? null,
        sessionUserId: session?.user?.id ?? null,
        isLoading,
        hasSession: !!session,
        rootReady: !!rootNavigationState?.key,
        pendingQueueLength: pendingNotifResponses.current.length,
        routingReady: notifRoutingReady.current,
      },
    });
  };

  const addNotifDeepLinkBreadcrumb = (
    message: string,
    data?: Record<string, string | number | boolean | null>,
  ) => {
    Sentry.addBreadcrumb({ category: "notification.deeplink", level: "info", message, data });
    emitNotifRouteDiagnostic(message, data);
  };

  const clearNotifRouteVerificationTimers = () => {
    for (const t of routeVerifyTimers.current) {
      clearTimeout(t);
    }
    routeVerifyTimers.current = [];
  };

  const scheduleNotifRouteVerification = (
    source: string,
    reqId: string,
    route: string,
    expectedPath: string,
    navigate: () => void,
  ) => {
    clearNotifRouteVerificationTimers();

    for (const delayMs of [300, 900, 1600]) {
      const timer = setTimeout(() => {
        const currentPath = pathnameRef.current;

        if (currentPath === expectedPath) {
          addNotifDeepLinkBreadcrumb("route_verify_ok", { source, reqId, route, expectedPath, currentPath });
          return;
        }

        if (currentPath !== "/" && currentPath !== "/(tabs)" && currentPath !== "/(tabs)/index") {
          addNotifDeepLinkBreadcrumb("route_verify_user_navigated", { source, reqId, route, expectedPath, currentPath });
          return;
        }

        addNotifDeepLinkBreadcrumb("route_verify_retry", { source, reqId, route, expectedPath, currentPath, delayMs });
        try {
          navigate();
        } catch (e) {
          Sentry.captureException(e, {
            tags: { area: "notification_deeplink" },
            extra: { source, reqId, route, expectedPath, currentPath, delayMs },
          });
        }
      }, delayMs);
      routeVerifyTimers.current.push(timer);
    }
  };

  const queueNotifResponse = (response: Notifications.NotificationResponse | null | undefined, source: string) => {
    if (!response) {
      addNotifDeepLinkBreadcrumb("queue_null_response", { source });
      return;
    }
    const reqId = response.notification.request.identifier;
    const queueBefore = pendingNotifResponses.current.length;
    pendingNotifResponses.current.push({ response, source });
    const queueAfter = pendingNotifResponses.current.length;
    addNotifDeepLinkBreadcrumb("queue_response", { source, reqId, queueBefore, queueAfter });
    setPendingNotifSignal((value) => value + 1);
  };

  const routeFromResponse = (response: Notifications.NotificationResponse, source: string) => {
    const reqId = response.notification.request.identifier;
    addNotifDeepLinkBreadcrumb("route_response_seen", { source, reqId });
    if (handledNotifIds.current.has(reqId)) {
      addNotifDeepLinkBreadcrumb("duplicate_skipped", { source, reqId });
      return;
    }

    const raw = response.notification.request.content.data;
    if (!raw || typeof raw !== "object") {
      addNotifDeepLinkBreadcrumb("payload_invalid_container", { source, reqId });
      return;
    }

    const d = raw as { assetId?: unknown; assetKind?: unknown; taskId?: unknown; taskKind?: unknown };
    const assetId = typeof d.assetId === "string" ? d.assetId : null;
    const assetKind = typeof d.assetKind === "string" ? d.assetKind : null;
    const taskId = typeof d.taskId === "string" ? d.taskId : null;
    const taskKind = typeof d.taskKind === "string" ? d.taskKind : null;

    addNotifDeepLinkBreadcrumb("payload_shape", {
      source,
      reqId,
      hasAssetId: !!assetId,
      hasAssetKind: !!assetKind,
      hasTaskId: !!taskId,
      hasTaskKind: !!taskKind,
      assetId: assetId ?? null,
      assetKind: assetKind ?? null,
      taskId: taskId ?? null,
      taskKind: taskKind ?? null,
    });

    if (!assetId || !taskId || !assetKind || !taskKind) {
      addNotifDeepLinkBreadcrumb("payload_missing_required_field", { source, reqId, hasAssetId: !!assetId, hasTaskId: !!taskId, hasAssetKind: !!assetKind, hasTaskKind: !!taskKind });
      return;
    }

    try {
      let route: string | null = null;
      if (assetKind === "vehicle" && taskKind === "vehicle_task") {
        route = "vehicle";
        addNotifDeepLinkBreadcrumb("route_attempt", { source, reqId, route, assetId, taskId, paramKeys: "id,taskId" });
        router.push({ pathname: "/vehicle/[id]", params: { id: assetId, taskId, reminder: "1", rid: Date.now().toString() } });
        addNotifDeepLinkBreadcrumb("router_push_returned", { source, reqId, route });
        scheduleNotifRouteVerification(source, reqId, route, `/vehicle/${assetId}`, () => router.replace({ pathname: "/vehicle/[id]", params: { id: assetId, taskId, reminder: "1", rid: Date.now().toString() } }));
      } else if (assetKind === "property" && taskKind === "property_task") {
        route = "property";
        addNotifDeepLinkBreadcrumb("route_attempt", { source, reqId, route, assetId, taskId, paramKeys: "id,taskId" });
        router.push({ pathname: "/property/[id]", params: { id: assetId, taskId, reminder: "1", rid: Date.now().toString() } });
        addNotifDeepLinkBreadcrumb("router_push_returned", { source, reqId, route });
        scheduleNotifRouteVerification(source, reqId, route, `/property/${assetId}`, () => router.replace({ pathname: "/property/[id]", params: { id: assetId, taskId, reminder: "1", rid: Date.now().toString() } }));
      } else if (assetKind === "family_member" && taskKind === "health_appointment") {
        route = "family_appointment";
        addNotifDeepLinkBreadcrumb("route_attempt", { source, reqId, route, assetId, taskId, paramKeys: "id,appointmentId" });
        router.push({ pathname: "/family-member/[id]", params: { id: assetId, appointmentId: taskId, reminder: "1", rid: Date.now().toString() } });
        addNotifDeepLinkBreadcrumb("router_push_returned", { source, reqId, route });
        scheduleNotifRouteVerification(source, reqId, route, `/family-member/${assetId}`, () => router.replace({ pathname: "/family-member/[id]", params: { id: assetId, appointmentId: taskId, reminder: "1", rid: Date.now().toString() } }));
      } else if (assetKind === "family_member" && taskKind === "medication") {
        route = "family_medication";
        addNotifDeepLinkBreadcrumb("route_attempt", { source, reqId, route, assetId, taskId, paramKeys: "id,medicationId" });
        router.push({ pathname: "/family-member/[id]", params: { id: assetId, medicationId: taskId } });
        addNotifDeepLinkBreadcrumb("router_push_returned", { source, reqId, route });
        scheduleNotifRouteVerification(source, reqId, route, `/family-member/${assetId}`, () => router.replace({ pathname: "/family-member/[id]", params: { id: assetId, medicationId: taskId } }));
      } else if (assetKind === "health" && taskKind === "health_appointment") {
        route = "health_tab";
        addNotifDeepLinkBreadcrumb("route_attempt", { source, reqId, route, assetId, taskId, paramKeys: "" });
        router.push("/(tabs)/health");
        addNotifDeepLinkBreadcrumb("router_push_returned", { source, reqId, route });
        scheduleNotifRouteVerification(source, reqId, route, "/health", () => router.replace("/(tabs)/health"));
      } else {
        addNotifDeepLinkBreadcrumb("payload_no_matching_route", { source, reqId, assetKind, taskKind });
        return;
      }

      handledNotifIds.current.add(reqId);
      addNotifDeepLinkBreadcrumb("route_completed", { source, reqId, route });
      void supabase
        .from("notification_events")
        .update({ response_received_at: new Date().toISOString() })
        .eq("notif_id", reqId)
        .then(
          ({ error }) => {
            if (error) {
              addNotifDeepLinkBreadcrumb("response_update_error", { source, reqId, errorMessage: error.message });
            }
          },
          (error: unknown) => {
            addNotifDeepLinkBreadcrumb("response_update_error", { source, reqId, errorMessage: error instanceof Error ? error.message : "unknown" });
          },
        );
      capture("notification_opened", { asset_kind: assetKind, task_kind: taskKind });
    } catch (e) {
      Sentry.captureException(e, { tags: { area: "notification_deeplink" }, extra: { source, reqId, assetId, assetKind, taskId, taskKind } });
      console.warn("[NotificationDeepLink] route failed:", e);
    }
  };

  const flushPendingNotifResponses = () => {
    if (!notifRoutingReady.current) {
      addNotifDeepLinkBreadcrumb("flush_blocked_not_ready", { pendingQueueLength: pendingNotifResponses.current.length });
      return;
    }
    if (pendingNotifResponses.current.length === 0) {
      addNotifDeepLinkBreadcrumb("flush_empty", {});
      return;
    }
    addNotifDeepLinkBreadcrumb("flush_start", { queueLength: pendingNotifResponses.current.length });
    const queue = pendingNotifResponses.current;
    pendingNotifResponses.current = [];
    for (const item of queue) {
      addNotifDeepLinkBreadcrumb("flush_item", { source: item.source, reqId: item.response.notification.request.identifier });
      routeFromResponse(item.response, item.source);
    }
  };

  useEffect(() => {
    addNotifDeepLinkBreadcrumb("component_rendered", {
      sessionUserId: session?.user?.id ?? null,
      isLoading,
      rootKeyPresent: !!rootNavigationState?.key,
    });
  }, [session?.user?.id, isLoading, rootNavigationState?.key]);

  useEffect(() => {
    const hasResponse = !!lastNotificationResponse;
    const reqId = lastNotificationResponse?.notification.request.identifier ?? null;
    addNotifDeepLinkBreadcrumb("hook_effect", { hasResponse, reqId });
    queueNotifResponse(lastNotificationResponse, "hook");
  }, [lastNotificationResponse]);

  useEffect(() => {
    addNotifDeepLinkBreadcrumb("listener_registered", {});
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const reqId = response.notification.request.identifier;
      addNotifDeepLinkBreadcrumb("listener_received", { reqId });
      queueNotifResponse(response, "listener");
    });
    return () => {
      addNotifDeepLinkBreadcrumb("listener_removed", {});
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      notifRoutingReady.current = false;
      addNotifDeepLinkBreadcrumb("routing_waiting_auth", {
        hasSession: !!session,
        isLoading,
        rootKeyPresent: !!rootNavigationState?.key,
        pendingQueueLength: pendingNotifResponses.current.length,
        hasEverSeenSession: hasEverSeenSession.current,
      });
      return;
    }

    if (session) {
      hasEverSeenSession.current = true;
      if (unauthClearTimer.current !== null) {
        clearTimeout(unauthClearTimer.current);
        unauthClearTimer.current = null;
      }
      const ready = !!rootNavigationState?.key;
      notifRoutingReady.current = ready;
      addNotifDeepLinkBreadcrumb("routing_ready_state", {
        ready,
        hasSession: true,
        isLoading,
        rootKeyPresent: !!rootNavigationState?.key,
        pendingQueueLength: pendingNotifResponses.current.length,
        pendingNotifSignal,
      });
      if (ready) {
        flushPendingNotifResponses();
        for (const t of readinessRetryTimers.current) {
          clearTimeout(t);
        }
        readinessRetryTimers.current = [];
        for (const delay of [250, 750]) {
          const timer = setTimeout(() => {
            flushPendingNotifResponses();
          }, delay);
          readinessRetryTimers.current.push(timer);
        }
      }
      return;
    }

    notifRoutingReady.current = false;
    addNotifDeepLinkBreadcrumb("routing_ready_state", {
      ready: false,
      hasSession: false,
      isLoading,
      rootKeyPresent: !!rootNavigationState?.key,
      pendingQueueLength: pendingNotifResponses.current.length,
      pendingNotifSignal,
    });
    if (unauthClearTimer.current === null && pendingNotifResponses.current.length > 0) {
      const graceMs = 1500;
      addNotifDeepLinkBreadcrumb("unauth_clear_scheduled", {
        graceMs,
        pendingQueueLength: pendingNotifResponses.current.length,
        hasEverSeenSession: hasEverSeenSession.current,
      });
      unauthClearTimer.current = setTimeout(() => {
        unauthClearTimer.current = null;
        addNotifDeepLinkBreadcrumb("unauth_queue_cleared_after_grace", {
          pendingQueueLength: pendingNotifResponses.current.length,
          hasEverSeenSession: hasEverSeenSession.current,
        });
        pendingNotifResponses.current = [];
      }, graceMs);
    }
  }, [session, isLoading, rootNavigationState?.key, pendingNotifSignal]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (unauthClearTimer.current !== null) {
        clearTimeout(unauthClearTimer.current);
        unauthClearTimer.current = null;
      }
      for (const t of readinessRetryTimers.current) {
        clearTimeout(t);
      }
      readinessRetryTimers.current = [];
      clearNotifRouteVerificationTimers();
    };
  }, []);

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
          <Stack.Screen name="import-fleet" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="subscription" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="notifications-settings" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="terms-of-service" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="privacy-policy" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }} />
        </Stack>
        {showBanner && <NotifPermissionBanner userId={session?.user?.id} />}
        <UndoToastHost />
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
          <BottomSheetModalProvider>
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
          </BottomSheetModalProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
