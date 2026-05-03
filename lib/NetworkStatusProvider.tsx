import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import * as Sentry from "@sentry/react-native";

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  isOffline: boolean;
}

const DEFAULT_STATUS: NetworkStatus = {
  isConnected: true,
  isInternetReachable: true,
  isOffline: false,
};

const PRIMARY_PROBE_URL = "https://clients3.google.com/generate_204";
const FALLBACK_PROBE_URL = "https://www.gstatic.com/generate_204";
const PROBE_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 3000;
const RECENT_PROOF_TTL_MS = 8000;

const NetworkStatusContext = createContext<NetworkStatus>(DEFAULT_STATUS);

const STATUS_ONLINE: NetworkStatus = {
  isConnected: true,
  isInternetReachable: true,
  isOffline: false,
};

const STATUS_OFFLINE: NetworkStatus = {
  isConnected: false,
  isInternetReachable: false,
  isOffline: true,
};

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NetworkStatus>(DEFAULT_STATUS);

  useEffect(() => {
    const providerId = Math.random().toString(36).slice(2, 8);

    let currentState: NetworkStatus = DEFAULT_STATUS;
    let appStateNow: AppStateStatus = AppState.currentState;
    let lastNetInfo: NetInfoState | null = null;
    let lastOnlineProofAt = 0;
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let probeAbort: AbortController | null = null;
    let probeAttempt = 0;
    let probeInflight = false;
    let unmounted = false;

    const proofAge = (): string => {
      if (lastOnlineProofAt === 0) return "never";
      return String(Date.now() - lastOnlineProofAt) + "ms";
    };

    const apply = (next: NetworkStatus, source: string, detail?: string) => {
      if (unmounted) return;
      const prev = currentState;
      Sentry.captureMessage(
        "[NetworkStatus] decision providerId=" + providerId +
          " source=" + source +
          " appState=" + String(appStateNow) +
          " prevOffline=" + String(prev.isOffline) +
          " nextOffline=" + String(next.isOffline) +
          " netType=" + String(lastNetInfo?.type) +
          " netConnected=" + String(lastNetInfo?.isConnected) +
          " netReachable=" + String(lastNetInfo?.isInternetReachable) +
          " lastOnlineProofAge=" + proofAge() +
          " pollRunning=" + (pollHandle !== null ? "yes" : "no") +
          (detail ? " detail=" + detail : "")
      );
      currentState = next;
      setState(next);
    };

    const stopPoll = () => {
      if (!pollHandle) return;
      clearInterval(pollHandle);
      pollHandle = null;
      Sentry.captureMessage("[NetworkStatus] poll STOP providerId=" + providerId);
    };

    const startPoll = () => {
      if (pollHandle) return;
      Sentry.captureMessage("[NetworkStatus] poll START providerId=" + providerId);
      pollHandle = setInterval(() => {
        if (unmounted) return;
        if (appStateNow !== "active") return;
        void onPollTick();
      }, POLL_INTERVAL_MS);
    };

    const abortInflightProbe = () => {
      if (probeAbort) {
        try {
          probeAbort.abort();
        } catch {}
        probeAbort = null;
      }
    };

    const runProbe = async (
      source: string,
      url: string
    ): Promise<{ ok: boolean; status?: number; durationMs: number; error?: string }> => {
      const attempt = ++probeAttempt;
      const startedAt = Date.now();
      const startAppState = appStateNow;
      const controller = new AbortController();
      probeAbort = controller;
      const timeoutHandle = setTimeout(() => {
        try {
          controller.abort();
        } catch {}
      }, PROBE_TIMEOUT_MS);

      Sentry.captureMessage(
        "[NetworkStatus] probe START providerId=" + providerId +
          " source=" + source +
          " url=" + url +
          " attempt=" + String(attempt) +
          " appState=" + String(startAppState)
      );

      try {
        const res = await fetch(url, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        });
        const durationMs = Date.now() - startedAt;
        const ok = res.status === 204 || (res.status >= 200 && res.status < 400);
        Sentry.captureMessage(
          "[NetworkStatus] probe FINISH providerId=" + providerId +
            " source=" + source +
            " url=" + url +
            " attempt=" + String(attempt) +
            " appStateStart=" + String(startAppState) +
            " appStateFinish=" + String(appStateNow) +
            " status=" + String(res.status) +
            " ok=" + String(ok) +
            " durationMs=" + String(durationMs)
        );
        return { ok, status: res.status, durationMs };
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        const err = String(e);
        Sentry.captureMessage(
          "[NetworkStatus] probe FAIL providerId=" + providerId +
            " source=" + source +
            " url=" + url +
            " attempt=" + String(attempt) +
            " appStateStart=" + String(startAppState) +
            " appStateFinish=" + String(appStateNow) +
            " ok=false durationMs=" + String(durationMs) +
            " error=" + err
        );
        return { ok: false, durationMs, error: err };
      } finally {
        clearTimeout(timeoutHandle);
        if (probeAbort === controller) probeAbort = null;
      }
    };

    const proveOnline = async (source: string): Promise<boolean> => {
      if (appStateNow !== "active") {
        Sentry.captureMessage(
          "[NetworkStatus] probe SKIP inactive providerId=" + providerId +
            " source=" + source +
            " appState=" + String(appStateNow)
        );
        return false;
      }

      if (probeInflight) {
        const recent = lastOnlineProofAt > 0 && Date.now() - lastOnlineProofAt < RECENT_PROOF_TTL_MS;
        Sentry.captureMessage(
          "[NetworkStatus] probe SKIP inflight providerId=" + providerId +
            " source=" + source +
            " usingRecentProof=" + String(recent) +
            " lastOnlineProofAge=" + proofAge()
        );
        return recent;
      }

      probeInflight = true;
      try {
        const a = await runProbe(source, PRIMARY_PROBE_URL);
        if (a.ok) {
          lastOnlineProofAt = Date.now();
          return true;
        }
        if (unmounted || appStateNow !== "active") return false;

        const b = await runProbe(source + "-fallback", FALLBACK_PROBE_URL);
        if (b.ok) {
          lastOnlineProofAt = Date.now();
          return true;
        }
        return false;
      } finally {
        probeInflight = false;
      }
    };

    const evaluateNetInfo = (n: NetInfoState | null): boolean => {
      if (!n) return false;
      return n.isConnected === false || n.isInternetReachable === false;
    };

    const onPollTick = async () => {
      Sentry.captureMessage(
        "[NetworkStatus] poll TICK providerId=" + providerId +
          " appState=" + String(appStateNow)
      );

      const proven = await proveOnline("poll-tick");
      if (unmounted) return;

      if (proven) {
        if (currentState.isOffline) {
          apply(STATUS_ONLINE, "poll-tick-probe-ok");
        }
        stopPoll();
        return;
      }

      if (appStateNow !== "active") return;
      try {
        const n = await NetInfo.refresh();
        if (unmounted) return;
        lastNetInfo = n;
        const refreshSaysOffline = evaluateNetInfo(n);
        Sentry.captureMessage(
          "[NetworkStatus] refresh DONE providerId=" + providerId +
            " source=poll-tick" +
            " type=" + String(n.type) +
            " isConnected=" + String(n.isConnected) +
            " isInternetReachable=" + String(n.isInternetReachable) +
            " refreshSaysOffline=" + String(refreshSaysOffline)
        );

        if (!refreshSaysOffline) {
          apply(STATUS_ONLINE, "poll-tick-refresh-online");
          stopPoll();
        }
      } catch (e) {
        Sentry.captureMessage(
          "[NetworkStatus] refresh ERROR providerId=" + providerId +
            " source=poll-tick err=" + String(e)
        );
      }
    };

    const onListener = async (n: NetInfoState) => {
      lastNetInfo = n;
      Sentry.captureMessage(
        "[NetworkStatus] listener providerId=" + providerId +
          " appState=" + String(appStateNow) +
          " type=" + String(n.type) +
          " isConnected=" + String(n.isConnected) +
          " isInternetReachable=" + String(n.isInternetReachable)
      );

      const netSaysOffline = evaluateNetInfo(n);

      if (appStateNow !== "active") {
        Sentry.captureMessage(
          "[NetworkStatus] listener DEFERRED inactive providerId=" + providerId +
            " netSaysOffline=" + String(netSaysOffline)
        );
        return;
      }

      if (!netSaysOffline) {
        if (currentState.isOffline) {
          apply(STATUS_ONLINE, "listener-active-online");
          stopPoll();
        }
        return;
      }

      if (
        lastOnlineProofAt > 0 &&
        Date.now() - lastOnlineProofAt < RECENT_PROOF_TTL_MS &&
        !currentState.isOffline
      ) {
        Sentry.captureMessage(
          "[NetworkStatus] listener SUPPRESS recent-proof providerId=" + providerId +
            " ageMs=" + String(Date.now() - lastOnlineProofAt)
        );
        return;
      }

      const proven = await proveOnline("listener-offline");
      if (unmounted) return;

      if (appStateNow !== "active") {
        Sentry.captureMessage(
          "[NetworkStatus] listener-probe finished while inactive providerId=" + providerId
        );
        return;
      }

      if (proven) {
        if (currentState.isOffline) {
          apply(STATUS_ONLINE, "listener-probe-overrode-netinfo");
          stopPoll();
        }
        return;
      }

      if (!currentState.isOffline) {
        apply(STATUS_OFFLINE, "listener-probe-failed");
      }
      startPoll();
    };

    const onAppStateChange = async (next: AppStateStatus) => {
      const prev = appStateNow;
      appStateNow = next;
      Sentry.captureMessage(
        "[NetworkStatus] AppState change providerId=" + providerId +
          " prev=" + String(prev) +
          " next=" + String(next)
      );

      if (next !== "active") {
        abortInflightProbe();
        return;
      }
      if (prev === "active") return;

      const proven = await proveOnline("appstate-active");
      if (unmounted || appStateNow !== "active") return;

      if (proven) {
        if (currentState.isOffline) {
          apply(STATUS_ONLINE, "appstate-active-probe-ok");
          stopPoll();
        }
        return;
      }

      if (evaluateNetInfo(lastNetInfo)) {
        if (!currentState.isOffline) {
          apply(STATUS_OFFLINE, "appstate-active-probe-failed-net-offline");
        }
        startPoll();
      }
    };

    Sentry.captureMessage("[NetworkStatus] provider MOUNT providerId=" + providerId);

    const unsubscribe = NetInfo.addEventListener((s) => {
      void onListener(s);
    });
    const appSub = AppState.addEventListener("change", (s) => {
      void onAppStateChange(s);
    });

    return () => {
      Sentry.captureMessage("[NetworkStatus] provider UNMOUNT providerId=" + providerId);
      unmounted = true;
      try {
        unsubscribe();
      } catch {}
      try {
        appSub.remove();
      } catch {}
      stopPoll();
      abortInflightProbe();
    };
  }, []);

  return (
    <NetworkStatusContext.Provider value={state}>{children}</NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus(consumer?: string): NetworkStatus {
  const value = useContext(NetworkStatusContext);

  useEffect(() => {
    if (!consumer) return;
    Sentry.captureMessage("[NetworkStatus] consumer MOUNT consumer=" + consumer);
    return () => {
      Sentry.captureMessage("[NetworkStatus] consumer UNMOUNT consumer=" + consumer);
    };
  }, [consumer]);

  return value;
}
