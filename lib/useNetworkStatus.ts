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
 * - Recovery uses NetInfo.refresh() instead of NetInfo.fetch().
 * - AppState foreground re-probes via refresh() to catch reconnect after app reopen.
 * - 3-second poll while offline re-probes via refresh() to catch missed listener events.
 */
function evaluate(nextState: NetInfoState): NetworkStatus {
  // Symmetric rule: offline only on positive false evidence. Null is unknown -> assume online.
  // This prevents stuck-offline on iOS reconnect where NetInfo emits
  // { isConnected: true, isInternetReachable: null } while the reachability probe runs.
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

  useEffect(() => {
    let cancelled = false;
    const hookId = Math.random().toString(36).slice(2, 8);
    Sentry.captureMessage("[NetworkStatus] hook MOUNT id=" + hookId);

    const stopOfflinePoll = () => {
      if (pollHandleRef.current) {
        clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
        Sentry.captureMessage("[NetworkStatus] poll STOP id=" + hookId);
      }
    };

    const apply = (next: NetInfoState, source: string) => {
      if (cancelled) {
        Sentry.captureMessage("[NetworkStatus] apply IGNORED (cancelled) id=" + hookId + " source=" + source);
        return;
      }

      const evaluated = evaluate(next);
      Sentry.captureMessage("[NetworkStatus] apply id=" + hookId +
        " source=" + source +
        " type=" + String(next.type) +
        " isConnected=" + String(next.isConnected) +
        " isInternetReachable=" + String(next.isInternetReachable) +
        " -> isOffline=" + String(evaluated.isOffline)
      );
      setState(evaluated);

      if (evaluated.isOffline) {
        if (!pollHandleRef.current) {
          Sentry.captureMessage("[NetworkStatus] poll START id=" + hookId);
          pollHandleRef.current = setInterval(() => {
            Sentry.captureMessage("[NetworkStatus] poll TICK id=" + hookId);
            // Path 1: NetInfo refresh (may be stuck on iOS — see Sentry diag).
            NetInfo.refresh()
              .then((s) => apply(s, "poll-refresh"))
              .catch((e) => Sentry.captureMessage("[NetworkStatus] poll REFRESH ERROR id=" + hookId + " err=" + String(e)));
            // Path 2: independent 204 reachability probe. Bypasses NetInfo entirely.
            // If this resolves with status 204, we are actually online regardless
            // of what NetInfo reports. Synthesize an online state and apply.
            const probeController = new AbortController();
            const probeTimeout = setTimeout(() => probeController.abort(), 3000);
            fetch("https://clients3.google.com/generate_204", {
              method: "HEAD",
              cache: "no-store",
              signal: probeController.signal,
            })
              .then((res) => {
                clearTimeout(probeTimeout);
                if (res.status === 204) {
                  Sentry.captureMessage("[NetworkStatus] probe-204 OK id=" + hookId);
                  apply(
                    {
                      type: "unknown" as NetInfoState["type"],
                      isConnected: true,
                      isInternetReachable: true,
                      details: null,
                    } as NetInfoState,
                    "probe-204"
                  );
                } else {
                  Sentry.captureMessage("[NetworkStatus] probe-204 BAD STATUS id=" + hookId + " status=" + String(res.status));
                }
              })
              .catch((e) => {
                clearTimeout(probeTimeout);
                Sentry.captureMessage("[NetworkStatus] probe-204 FAIL id=" + hookId + " err=" + String(e));
              });
          }, 3000);
        }
      } else {
        stopOfflinePoll();
      }
    };

    const unsubscribe = NetInfo.addEventListener((s) => apply(s, "listener"));

    NetInfo.refresh()
      .then((s) => apply(s, "initial-refresh"))
      .catch((e) => Sentry.captureMessage("[NetworkStatus] initial REFRESH ERROR id=" + hookId + " err=" + String(e)));

    const onAppStateChange = (nextStatus: AppStateStatus) => {
      Sentry.captureMessage("[NetworkStatus] AppState change id=" + hookId + " status=" + String(nextStatus));
      if (nextStatus === "active") {
        NetInfo.refresh()
          .then((s) => apply(s, "appstate-refresh"))
          .catch((e) => Sentry.captureMessage("[NetworkStatus] appstate REFRESH ERROR id=" + hookId + " err=" + String(e)));
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
