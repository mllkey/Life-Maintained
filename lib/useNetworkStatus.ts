import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  isOffline: boolean;
}

/**
 * App-wide network status hook.
 *
 * Cold start is intentionally optimistic while NetInfo resolves. We only mark
 * offline when NetInfo gives positive evidence that the device is disconnected
 * or the internet is unreachable.
 */
export function useNetworkStatus(): NetworkStatus {
  const [state, setState] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
    isOffline: false,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((nextState) => {
      const connected = nextState.isConnected !== false;
      const reachable = nextState.isInternetReachable !== false;

      setState({
        isConnected: connected,
        isInternetReachable: reachable,
        isOffline: !connected || !reachable,
      });
    });

    NetInfo.fetch()
      .then((nextState) => {
        const connected = nextState.isConnected !== false;
        const reachable = nextState.isInternetReachable !== false;

        setState({
          isConnected: connected,
          isInternetReachable: reachable,
          isOffline: !connected || !reachable,
        });
      })
      .catch(() => {
        // Keep the optimistic initial state if NetInfo cannot resolve.
      });

    return unsubscribe;
  }, []);

  return state;
}
