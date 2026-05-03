import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import * as Sentry from "@sentry/react-native";

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  isOffline: boolean;
}

/**
 * App-wide network status hook.
 *
 * Rules:
 * - Offline only on positive false evidence:
 *   isConnected === false OR isInternetReachable === false.
 * - Null on either field is unknown and must not keep the app offline.
 * - On iOS, app/_layout.tsx configures NetInfo to use JS reachability instead
 *   of native reachability so airplane-mode reconnect does not get trapped by
 *   stale native reachability state.
 * - Offline recovery polling only runs while AppState is active.
 */
function evaluate(nextState: NetInfoState): NetworkStatus {
  const offline =
    nextState.isConnected === false || nextState.isInternetReachable === false;

  return {
    isConnected: nextState.isConnected !== false,
    isInternetReachable: nextState.isInternetReachable !== false,
    isOffline: offline,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [state, setState] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
    isOffline: false,
  });

  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const hookId = Math.random().toString(36).slice(2, 8);
    Sentry.captureMessage("[NetworkStatus] hook MOUNT id=" + hookId);

    const stopOfflinePoll = () => {
      if (!pollHandleRef.current) return;
      clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
      Sentry.captureMessage("[NetworkStatus] poll STOP id=" + hookId);
    };

    const refreshNow = (source: string) => {
      if (cancelled) return;

      if (appStateRef.current !== "active") {
        Sentry.captureMessage(
          "[NetworkStatus] refresh SKIP inactive id=" +
            hookId +
            " source=" +
            source +
            " appState=" +
            String(appStateRef.current)
        );
        return;
      }

      if (refreshInFlightRef.current) {
        Sentry.captureMessage(
          "[NetworkStatus] refresh SKIP in-flight id=" + hookId + " source=" + source
        );
        return;
      }

      refreshInFlightRef.current = true;
      Sentry.captureMessage("[NetworkStatus] refresh START id=" + hookId + " source=" + source);

      NetInfo.refresh()
        .then((s) => apply(s, source))
        .catch((e) =>
          Sentry.captureMessage(
            "[NetworkStatus] refresh ERROR id=" +
              hookId +
              " source=" +
              source +
              " err=" +
              String(e)
          )
        )
        .finally(() => {
          refreshInFlightRef.current = false;
        });
    };

    const startOfflinePoll = () => {
      if (pollHandleRef.current) return;

      Sentry.captureMessage("[NetworkStatus] poll START id=" + hookId);
      pollHandleRef.current = setInterval(() => {
        Sentry.captureMessage(
          "[NetworkStatus] poll TICK id=" +
            hookId +
            " appState=" +
            String(appStateRef.current)
        );
        refreshNow("poll-refresh");
      }, 3000);
    };

    function apply(next: NetInfoState, source: string) {
      if (cancelled) {
        Sentry.captureMessage(
          "[NetworkStatus] apply IGNORED cancelled id=" + hookId + " source=" + source
        );
        return;
      }

      const evaluated = evaluate(next);
      Sentry.captureMessage(
        "[NetworkStatus] apply id=" +
          hookId +
          " source=" +
          source +
          " appState=" +
          String(appStateRef.current) +
          " type=" +
          String(next.type) +
          " isConnected=" +
          String(next.isConnected) +
          " isInternetReachable=" +
          String(next.isInternetReachable) +
          " -> isOffline=" +
          String(evaluated.isOffline)
      );

      setState(evaluated);

      if (evaluated.isOffline) {
        startOfflinePoll();
      } else {
        stopOfflinePoll();
      }
    }

    const unsubscribe = NetInfo.addEventListener((s) => apply(s, "listener"));

    refreshNow("initial-refresh");

    const onAppStateChange = (nextStatus: AppStateStatus) => {
      const previousStatus = appStateRef.current;
      appStateRef.current = nextStatus;

      Sentry.captureMessage(
        "[NetworkStatus] AppState change id=" +
          hookId +
          " prev=" +
          String(previousStatus) +
          " next=" +
          String(nextStatus)
      );

      if (nextStatus === "active" && previousStatus !== "active") {
        refreshNow("appstate-active-refresh");
      }
    };

    const appStateSub = AppState.addEventListener("change", onAppStateChange);

    return () => {
      Sentry.captureMessage("[NetworkStatus] hook UNMOUNT id=" + hookId);
      cancelled = true;
      unsubscribe();
      appStateSub.remove();
      stopOfflinePoll();
    };
  }, []);

  return state;
}
