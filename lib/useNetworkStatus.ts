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
    const hookId = Math.random().toString(36).slice(2, 8);
    console.log("[NetworkStatus] hook MOUNT id=" + hookId);

    const stopOfflinePoll = () => {
      if (pollHandleRef.current) {
        clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
        console.log("[NetworkStatus] poll STOP id=" + hookId);
      }
    };

    const apply = (next: NetInfoState, source: string) => {
      if (cancelled) {
        console.log("[NetworkStatus] apply IGNORED (cancelled) id=" + hookId + " source=" + source);
        return;
      }

      const evaluated = evaluate(next);
      console.log(
        "[NetworkStatus] apply id=" + hookId +
        " source=" + source +
        " type=" + String(next.type) +
        " isConnected=" + String(next.isConnected) +
        " isInternetReachable=" + String(next.isInternetReachable) +
        " -> isOffline=" + String(evaluated.isOffline)
      );
      setState(evaluated);

      if (evaluated.isOffline) {
        if (!pollHandleRef.current) {
          console.log("[NetworkStatus] poll START id=" + hookId);
          pollHandleRef.current = setInterval(() => {
            console.log("[NetworkStatus] poll TICK id=" + hookId);
            NetInfo.refresh()
              .then((s) => apply(s, "poll-refresh"))
              .catch((e) => console.log("[NetworkStatus] poll REFRESH ERROR id=" + hookId + " err=" + String(e)));
          }, 3000);
        }
      } else {
        stopOfflinePoll();
      }
    };

    const unsubscribe = NetInfo.addEventListener((s) => apply(s, "listener"));

    NetInfo.refresh()
      .then((s) => apply(s, "initial-refresh"))
      .catch((e) => console.log("[NetworkStatus] initial REFRESH ERROR id=" + hookId + " err=" + String(e)));

    const onAppStateChange = (nextStatus: AppStateStatus) => {
      console.log("[NetworkStatus] AppState change id=" + hookId + " status=" + String(nextStatus));
      if (nextStatus === "active") {
        NetInfo.refresh()
          .then((s) => apply(s, "appstate-refresh"))
          .catch((e) => console.log("[NetworkStatus] appstate REFRESH ERROR id=" + hookId + " err=" + String(e)));
      }
    };

    const appStateSub = AppState.addEventListener("change", onAppStateChange);

    return () => {
      console.log("[NetworkStatus] hook UNMOUNT id=" + hookId);
      cancelled = true;
      unsubscribe();
      appStateSub.remove();
      stopOfflinePoll();
    };
  }, []);

  return state;
}
