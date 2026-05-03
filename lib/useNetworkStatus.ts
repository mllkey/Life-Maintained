import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  isOffline: boolean;
}

/**
 * App-wide network status hook.
 *
 * Robustness rules:
 * - isConnected must be literal true to count as connected.
 * - isInternetReachable must be literal true to count as reachable after first sample.
 * - Cold-start with both fields null is treated as online to avoid first-render offline flash.
 * - After first sample, null/false reachability is offline.
 * - AppState foreground re-fetch catches reconnect after app reopen.
 * - 3-second poll while offline catches missed listener events on iOS.
 */
function evaluate(nextState: NetInfoState, hasFirstSample: boolean): NetworkStatus {
  if (!hasFirstSample && nextState.isConnected == null && nextState.isInternetReachable == null) {
    return {
      isConnected: true,
      isInternetReachable: true,
      isOffline: false,
    };
  }

  const isConnected = nextState.isConnected === true;
  const isInternetReachable = nextState.isInternetReachable === true;

  return {
    isConnected,
    isInternetReachable,
    isOffline: !isConnected || !isInternetReachable,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [state, setState] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
    isOffline: false,
  });

  const firstSampleRef = useRef(false);
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stopOfflinePoll = () => {
      if (pollHandleRef.current) {
        clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }
    };

    const apply = (next: NetInfoState) => {
      if (cancelled) return;

      const evaluated = evaluate(next, firstSampleRef.current);
      firstSampleRef.current = true;
      setState(evaluated);

      if (evaluated.isOffline) {
        if (!pollHandleRef.current) {
          pollHandleRef.current = setInterval(() => {
            NetInfo.fetch().then(apply).catch(() => {});
          }, 3000);
        }
      } else {
        stopOfflinePoll();
      }
    };

    const unsubscribe = NetInfo.addEventListener(apply);

    NetInfo.fetch().then(apply).catch(() => {});

    const onAppStateChange = (nextStatus: AppStateStatus) => {
      if (nextStatus === "active") {
        NetInfo.fetch().then(apply).catch(() => {});
      }
    };

    const appStateSub = AppState.addEventListener("change", onAppStateChange);

    return () => {
      cancelled = true;
      unsubscribe();
      appStateSub.remove();
      stopOfflinePoll();
    };
  }, []);

  return state;
}
