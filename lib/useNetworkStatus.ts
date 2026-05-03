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

    const stopOfflinePoll = () => {
      if (pollHandleRef.current) {
        clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }
    };

    const apply = (next: NetInfoState) => {
      if (cancelled) return;

      const evaluated = evaluate(next);
      setState(evaluated);

      if (evaluated.isOffline) {
        if (!pollHandleRef.current) {
          pollHandleRef.current = setInterval(() => {
            NetInfo.refresh().then(apply).catch(() => {});
          }, 3000);
        }
      } else {
        stopOfflinePoll();
      }
    };

    const unsubscribe = NetInfo.addEventListener(apply);

    NetInfo.refresh().then(apply).catch(() => {});

    const onAppStateChange = (nextStatus: AppStateStatus) => {
      if (nextStatus === "active") {
        NetInfo.refresh().then(apply).catch(() => {});
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
