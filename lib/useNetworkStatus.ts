export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  isOffline: boolean;
}

/**
 * Product fallback:
 * iOS/React Native can report false offline after repeated Control Center
 * airplane-mode toggles even when the device is actually online.
 *
 * For launch, do not globally pre-block the app from NetInfo/JS reachability.
 * Let real network requests succeed/fail at the action level.
 */
export function useNetworkStatus(_consumer?: string): NetworkStatus {
  return {
    isConnected: true,
    isInternetReachable: true,
    isOffline: false,
  };
}
