import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, AppState } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Icon, MciIcon, type IconName, type MciName } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useAuth, getOnboardingKey } from "@/context/AuthContext";
import { capture } from "@/lib/analytics";
import { BUILDING_SCENE, REVEAL_BEATS, REVEAL_HAPTIC_OFFSETS } from "@/lib/revealChoreography";
import {
  isRevealPreviewReady,
  loadOnboardingRevealData,
  loadOnboardingTaskCount,
  serializeRevealPreview,
  type RevealData,
} from "@/lib/onboardingRevealData";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  ReduceMotion,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  Easing,
  interpolate,
  cancelAnimation,
  type SharedValue,
} from "react-native-reanimated";

const HALO_SIZE = 200;
const DOC_GLOW_SIZE = 160;
const PARTICLE_COUNT = 12;
const ORBIT_RADIUS = 96;
const ORBIT_DOTS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { x: Math.cos(a) * ORBIT_RADIUS, y: Math.sin(a) * ORBIT_RADIUS };
});
// Status-line crossfade, shared with the reveal cascade's rhythm: the outgoing
// line clears in one hero beat, the incoming line settles on the second tick.
const CROSSFADE_OUT_MS = REVEAL_BEATS.hero;
const CROSSFADE_IN_MS = REVEAL_HAPTIC_OFFSETS[1];
const SEGMENTS = [1, 2, 3] as const;

export type IconLib = "ion" | "mci";
export type ChipAnim = "shimmer" | "shimmerScale" | "bounce" | "spin" | "spinSequence" | "pulse";
export type ChipSpec = { lib: IconLib; icon: string; label: string; anim: ChipAnim };
// What one generation request told us. None of these advances the scene on its
// own: only a positive asset-scoped row count plus a loaded preview does.
//   success   2xx; `data` is the function's response body, untouched
//   conflict  409: a lock is held OR rows already exist. Never a success.
//   failure   any other status, a network error, or an aborted request
export type GenerateResult =
  | { kind: "success"; data: unknown }
  | { kind: "conflict" }
  | { kind: "failure"; status?: number; error: unknown };
export type BuildingConfig = {
  tint: string;
  assetId: string;
  assetName: string;
  revealVertical: "vehicle" | "home" | "health";
  analyticsStep: "building_plan" | "building_property_plan" | "building_health_plan";
  docIcon: { lib: IconLib; icon: string };
  chips: [ChipSpec, ChipSpec, ChipSpec];
  // beat1 shows at dispatch, beat2 is context copy, beat3 is built from the
  // verified row count, slow is the secondary line added on a long wait.
  copy: { beat1: string; beat2: string; beat3: (count: number) => string; slow: string };
  failedTitle: string;
  failedSubtitle: string;
  invokeGenerate: (signal: AbortSignal) => Promise<GenerateResult>;
  onGenerated: () => void;
};

type TimerName = "beat2" | "slow" | "deadline" | "present" | "swap" | "haptic" | "nav";
type AttemptPhase = "waiting" | "succeeding" | "done" | "failed";
type Attempt = {
  token: number;
  // Wall clock at the start of the attempt. Deadlines are measured against
  // this, not against timers, so time spent backgrounded is still counted.
  startedAt: number;
  phase: AttemptPhase;
  dispatched: boolean;
  requestSettled: boolean;
  outcome: GenerateResult | null;
  controller: AbortController | null;
  beat: 1 | 2 | 3;
  beat2SettledAt: number;
  ready: RevealData | null;
  evaluating: boolean;
  evaluateQueued: boolean;
  hapticFired: boolean;
  navigated: boolean;
};

export function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export function getInvokeStatus(error: unknown): number | undefined {
  return (error as { context?: { status?: number } })?.context?.status;
}

function VerticalIcon({ lib, icon, size, color }: { lib: IconLib; icon: string; size: number; color: string }) {
  if (lib === "mci") return <MciIcon name={icon as MciName} size={size} color={color} />;
  return <Icon name={icon as IconName} size={size} color={color} />;
}

function armChip(sv: SharedValue<number>, kind: ChipAnim, delay: number) {
  if (kind === "bounce") {
    sv.value = withDelay(delay, withSequence(
      withSpring(-8, { damping: 14, stiffness: 220 }),
      withSpring(0, { damping: 12, stiffness: 180 }),
    ));
  } else if (kind === "spin") {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1));
  } else if (kind === "spinSequence") {
    sv.value = withDelay(delay, withRepeat(withSequence(
      withTiming(0.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      withTiming(-0.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
    ), -1, true));
  } else if (kind === "pulse") {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true));
  } else {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));
  }
}

// `still` is reduced motion: the icon is drawn at full strength with no transform.
function chipIconStyle(kind: ChipAnim, v: number, still: boolean) {
  "worklet";
  if (still) return { opacity: 1 };
  if (kind === "bounce") return { transform: [{ translateY: v }] };
  if (kind === "spin") return { transform: [{ rotate: `${v * 360}deg` }] };
  if (kind === "spinSequence") return { transform: [{ rotate: `${v}rad` }] };
  if (kind === "shimmerScale") return { opacity: interpolate(v, [0, 0.5, 1], [0.6, 1, 0.6]), transform: [{ scale: interpolate(v, [0, 0.5, 1], [1, 1.1, 1]) }] };
  if (kind === "pulse") return { opacity: interpolate(v, [0, 0.5, 1], [0.7, 1, 0.7]) };
  return { opacity: interpolate(v, [0, 0.5, 1], [0.6, 1, 0.6]) };
}

const Particle = React.memo(function Particle({ progress, index, total, color }: { progress: SharedValue<number>; index: number; total: number; color: string }) {
  const angle = (index / total) * Math.PI * 2;
  const radius = 120;
  const startX = Math.cos(angle) * radius;
  const startY = Math.sin(angle) * radius;
  const pStyle = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: interpolate(t, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: interpolate(t, [0, 1], [startX, 0]) },
        { translateY: interpolate(t, [0, 1], [startY, 0]) },
        { scale: interpolate(t, [0, 0.5, 1], [0.4, 1, 0.6]) },
      ],
    };
  });
  return <Animated.View style={[styles.particle, { backgroundColor: color }, pStyle]} />;
});

/**
 * Onboarding building scene, shared by all three verticals.
 *
 * The scene leaves for plan-reveal on exactly one condition: an asset-scoped
 * row count that is positive AND a reveal preview that loaded and matches it.
 * No timer, HTTP 200 or HTTP 409 advances it.
 *
 *   mount      one POST, its promise kept in liveRequestRef
 *   settle     read the count (always, before any failure screen)
 *                rows + preview          -> Beat 3, hold, replace route
 *                409, or 200 with none   -> poll the count every 2s
 *                request failed, no rows -> failure screen
 *   90s        abort the request, one final read, then failure
 *   Try again  count first; POST only if empty and no earlier POST is unresolved
 *
 * Nothing is surfaced while the app is not active (no failure screen, haptic
 * or route change); returning to the foreground re-reads before deciding.
 */
export function BuildingScene({ config }: { config: BuildingConfig }) {
  const insets = useSafeAreaInsets();
  const { setOnboardingCompleted, user } = useAuth();
  const reduceMotion = useReducedMotion();

  const [subtitleText, setSubtitleText] = useState(config.copy.beat1);
  const [beat, setBeat] = useState<1 | 2 | 3>(1);
  const [slowNotice, setSlowNotice] = useState(false);
  const [failed, setFailed] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  // Latest props for the async machine below, which outlives any one render.
  const configRef = useRef(config);
  configRef.current = config;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const mountedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const tokenRef = useRef(0);
  const attemptRef = useRef<Attempt | null>(null);
  // The one unresolved generation request this mounted scene may have. A new
  // POST is never dispatched while this is set.
  const liveRequestRef = useRef<Promise<GenerateResult> | null>(null);
  const appActiveRef = useRef(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const timersRef = useRef<Map<TimerName, ReturnType<typeof setTimeout>>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountAbortRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(10);
  const subtitleOpacity = useSharedValue(1);
  const chip1Opacity = useSharedValue(0);
  const chip1Y = useSharedValue(12);
  const chip2Opacity = useSharedValue(0);
  const chip2Y = useSharedValue(12);
  const chip3Opacity = useSharedValue(0);
  const chip3Y = useSharedValue(12);
  const chipIcon0 = useSharedValue(0);
  const chipIcon1 = useSharedValue(0);
  const chipIcon2 = useSharedValue(0);
  const haloPulse = useSharedValue(0);
  const orbitSpin = useSharedValue(0);
  const docScale = useSharedValue(0);
  const docOpacity = useSharedValue(0);
  const docGlow = useSharedValue(0);
  const readyOpacity = useSharedValue(0);
  const particle0 = useSharedValue(0);
  const particle1 = useSharedValue(0);
  const particle2 = useSharedValue(0);
  const particle3 = useSharedValue(0);
  const particle4 = useSharedValue(0);
  const particle5 = useSharedValue(0);
  const particle6 = useSharedValue(0);
  const particle7 = useSharedValue(0);
  const particle8 = useSharedValue(0);
  const particle9 = useSharedValue(0);
  const particle10 = useSharedValue(0);
  const particle11 = useSharedValue(0);
  const particleProgress = [particle0, particle1, particle2, particle3, particle4, particle5, particle6, particle7, particle8, particle9, particle10, particle11];

  // ── Timers ────────────────────────────────────────────────────────────────
  function clearTimer(name: TimerName) {
    const t = timersRef.current.get(name);
    if (t !== undefined) {
      clearTimeout(t);
      timersRef.current.delete(name);
    }
  }

  // One timer per name: setting a name replaces whatever was pending under it.
  function setTimer(name: TimerName, fn: () => void, ms: number) {
    clearTimer(name);
    timersRef.current.set(name, setTimeout(() => {
      timersRef.current.delete(name);
      fn();
    }, Math.max(ms, 0)));
  }

  function clearAllTimers() {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
  }

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // ── Attempt identity ──────────────────────────────────────────────────────
  // Every async completion re-checks this: still mounted, and the attempt that
  // scheduled it still holds the current token. A retry or an unmount makes
  // every handler of an older attempt a no-op.
  function isCurrent(a: Attempt): boolean {
    const current = attemptRef.current;
    return mountedRef.current && current !== null && current.token === a.token;
  }

  function isLiveWaiting(a: Attempt): boolean {
    return isCurrent(a) && a.phase === "waiting";
  }

  function deadlinePassed(a: Attempt): boolean {
    return Date.now() - a.startedAt >= BUILDING_SCENE.attemptDeadlineMs;
  }

  // ── Visuals ───────────────────────────────────────────────────────────────
  function cancelSceneAnimations() {
    [
      haloPulse, orbitSpin, titleOpacity, titleY, subtitleOpacity,
      chip1Opacity, chip1Y, chip2Opacity, chip2Y, chip3Opacity, chip3Y,
      chipIcon0, chipIcon1, chipIcon2, docScale, docOpacity, docGlow, readyOpacity,
      particle0, particle1, particle2, particle3, particle4, particle5,
      particle6, particle7, particle8, particle9, particle10, particle11,
    ].forEach((sv) => cancelAnimation(sv));
  }

  function resetVisuals() {
    cancelSceneAnimations();
    titleOpacity.value = 0; titleY.value = 10;
    subtitleOpacity.value = 1;
    chip1Opacity.value = 0; chip1Y.value = 12;
    chip2Opacity.value = 0; chip2Y.value = 12;
    chip3Opacity.value = 0; chip3Y.value = 12;
    chipIcon0.value = 0; chipIcon1.value = 0; chipIcon2.value = 0;
    docScale.value = 0; docOpacity.value = 0; docGlow.value = 0;
    readyOpacity.value = 0;
    particleProgress.forEach((p) => { p.value = 0; });
    haloPulse.value = 0; orbitSpin.value = 0;
  }

  // Ambient presentation only: title, halo, orbit, chips and a dim doc icon.
  // Nothing here represents progress; the three segments and the status line do.
  function armVisuals() {
    const chips = configRef.current.chips;
    titleOpacity.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    docOpacity.value = withDelay(800, withTiming(0.35, { duration: 400 }));
    docScale.value = withDelay(800, withTiming(0.85, { duration: 400 }));

    if (reduceMotionRef.current) {
      // Static halo and icons, no orbit, no chip loops, no travel.
      titleY.value = 0;
      chip1Y.value = 0; chip2Y.value = 0; chip3Y.value = 0;
      haloPulse.value = 0.5;
      orbitSpin.value = 0;
      return;
    }

    titleY.value = withSpring(0, { damping: 17, stiffness: 150 });
    haloPulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
    orbitSpin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1);
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    armChip(chipIcon0, chips[0].anim, 1400);
    armChip(chipIcon1, chips[1].anim, 1700);
    armChip(chipIcon2, chips[2].anim, 2000);
  }

  // Beat 2 has landed: lift the doc icon and run the particle converge once.
  // One-shot and tied to a real beat; it never loops.
  function armBeat2Visuals() {
    docOpacity.value = withTiming(0.6, { duration: 500 });
    if (reduceMotionRef.current) return;
    particleProgress.forEach((p, i) => {
      p.value = 0;
      p.value = withDelay(i * 100, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
    });
  }

  // Beat 3 has landed (rows verified, preview loaded): settle the doc, glow, badge.
  function armBeat3Visuals() {
    if (reduceMotionRef.current) {
      docScale.value = withTiming(1, { duration: CROSSFADE_IN_MS });
    } else {
      docScale.value = withDelay(REVEAL_BEATS.coverage, withSpring(1.15, { damping: 10, stiffness: 140 }, () => {
        docScale.value = withSpring(1, { damping: 14, stiffness: 180 });
      }));
    }
    docGlow.value = withDelay(REVEAL_BEATS.hero, withTiming(1, { duration: 400 }));
    readyOpacity.value = withDelay(REVEAL_BEATS.supportOne, withTiming(1, { duration: 300 }));
  }

  // Status-line crossfade. `onSwapped` runs at the moment the new line becomes
  // the visible one, and only if this is still the mounted, current attempt.
  function crossfadeSubtitle(a: Attempt, next: string, onSwapped: () => void) {
    // ReduceMotion.Never: an opacity crossfade is the reduced-motion treatment
    // itself, so it must still run when the system setting is on (Reanimated
    // would otherwise skip the timing and leave a blank gap, then a hard cut).
    subtitleOpacity.value = withTiming(0, { duration: CROSSFADE_OUT_MS, easing: Easing.in(Easing.ease), reduceMotion: ReduceMotion.Never });
    setTimer("swap", () => {
      if (!isCurrent(a) || a.phase === "failed") return;
      setSubtitleText(next);
      subtitleOpacity.value = withTiming(1, { duration: CROSSFADE_IN_MS, easing: Easing.out(Easing.ease), reduceMotion: ReduceMotion.Never });
      onSwapped();
    }, CROSSFADE_OUT_MS);
  }

  function stopScene() {
    cancelSceneAnimations();
    clearAllTimers();
    stopPolling();
  }

  // ── Beat 2 ────────────────────────────────────────────────────────────────
  // 1.5s when the plan is already confirmed by then; otherwise 5s, or the
  // moment a confirmed result arrives in between. Idempotent: safe to call
  // from its own timer, from a confirmation, and from a foreground resume.
  function armBeat2(a: Attempt) {
    if (!isLiveWaiting(a) || a.beat >= 2) return;
    const elapsed = Date.now() - a.startedAt;
    if (elapsed < BUILDING_SCENE.beat2FastMs) {
      setTimer("beat2", () => armBeat2(a), BUILDING_SCENE.beat2FastMs - elapsed);
    } else if (a.ready !== null || elapsed >= BUILDING_SCENE.beat2PendingMs) {
      showBeat2(a);
    } else {
      setTimer("beat2", () => armBeat2(a), BUILDING_SCENE.beat2PendingMs - elapsed);
    }
  }

  function showBeat2(a: Attempt) {
    if (!isLiveWaiting(a) || a.beat >= 2) return;
    a.beat = 2;
    clearTimer("beat2");
    a.beat2SettledAt = Date.now() + CROSSFADE_OUT_MS + CROSSFADE_IN_MS;
    crossfadeSubtitle(a, configRef.current.copy.beat2, () => {
      setBeat(2);
      armBeat2Visuals();
    });
    maybePresent(a);
  }

  // ── Attempt timers (all measured from the attempt's wall-clock start) ─────
  function armAttemptTimers(a: Attempt) {
    if (!isLiveWaiting(a)) return;
    const elapsed = Date.now() - a.startedAt;
    armBeat2(a);
    if (a.ready === null) {
      setTimer("slow", () => {
        if (isLiveWaiting(a) && a.ready === null) setSlowNotice(true);
      }, BUILDING_SCENE.slowNoticeMs - elapsed);
      setTimer("deadline", () => onDeadline(a), BUILDING_SCENE.attemptDeadlineMs - elapsed);
    }
  }

  // ── Request ───────────────────────────────────────────────────────────────
  function dispatch(a: Attempt) {
    if (!isLiveWaiting(a) || a.dispatched) return;
    if (liveRequestRef.current !== null) return;
    a.dispatched = true;
    stopPolling();
    const controller = new AbortController();
    a.controller = controller;

    let request: Promise<GenerateResult>;
    try {
      request = configRef.current.invokeGenerate(controller.signal);
    } catch (error) {
      request = Promise.resolve<GenerateResult>({ kind: "failure", error });
    }
    const live: Promise<GenerateResult> = request.then(
      (result) => result,
      (error): GenerateResult => ({ kind: "failure", error }),
    );
    liveRequestRef.current = live;
    void live.then((result) => {
      if (liveRequestRef.current === live) liveRequestRef.current = null;
      onRequestSettled(a, result);
    });
  }

  function onRequestSettled(a: Attempt, result: GenerateResult) {
    if (!mountedRef.current) return;
    const current = attemptRef.current;
    if (current === null || current.token !== a.token) {
      // An earlier attempt's request has finally resolved. If the current
      // attempt was holding its own POST behind it, it may re-check now.
      if (current !== null && current.phase === "waiting" && !current.dispatched) void evaluate(current);
      return;
    }
    a.requestSettled = true;
    a.outcome = result;
    if (__DEV__ && result.kind === "failure") console.warn("[onboarding] generation request did not succeed:", result.status ?? "no status");
    void evaluate(a);
  }

  // ── Readiness ─────────────────────────────────────────────────────────────
  // The only place that decides what happens next. Reads the asset-scoped
  // count, then the preview when there are rows. A read that throws is
  // "unknown" (count stays null) and is never treated as zero rows.
  async function evaluate(a: Attempt) {
    if (!isLiveWaiting(a)) return;
    if (a.ready !== null) { maybePresent(a); return; }
    if (!appActiveRef.current) return;
    if (a.evaluating) { a.evaluateQueued = true; return; }
    a.evaluating = true;
    const cfg = configRef.current;
    // A read that STARTS after the deadline is the final one for this attempt.
    const readIsFinal = deadlinePassed(a);
    let count: number | null = null;
    let preview: RevealData | null = null;
    try {
      count = await loadOnboardingTaskCount(cfg.revealVertical, cfg.assetId);
      if (count > 0) {
        const loaded = await loadOnboardingRevealData(cfg.revealVertical, cfg.assetId, cfg.assetName);
        if (isRevealPreviewReady(loaded) && loaded.count === count) preview = loaded;
      }
    } catch (error) {
      if (__DEV__) console.warn("[onboarding] readiness read failed:", error);
    }
    a.evaluating = false;
    const queued = a.evaluateQueued;
    a.evaluateQueued = false;
    if (!isLiveWaiting(a)) return;
    if (preview !== null) { confirmReady(a, preview); return; }
    decide(a, count, readIsFinal);
    if (queued && isLiveWaiting(a) && !a.evaluating) void evaluate(a);
  }

  function decide(a: Attempt, count: number | null, readIsFinal: boolean) {
    if (deadlinePassed(a)) {
      // Fail only on a read that began after the deadline; otherwise read once more.
      if (readIsFinal) fail(a);
      else void evaluate(a);
      return;
    }
    if (!a.dispatched) {
      // Try again: POST only when the table is confirmed empty and no earlier
      // POST from this scene is still unresolved.
      if (count === 0 && liveRequestRef.current === null) { dispatch(a); return; }
      // The read failed and nothing is in flight (e.g. still offline): unknown
      // is not zero, so no POST, and there is nothing to wait for. Back to the
      // failure screen rather than a 90s wait on no work.
      if (count === null && liveRequestRef.current === null) { fail(a); return; }
      // An earlier POST is still unresolved, or rows exist without a ready
      // preview: keep watching the rows.
      startPolling(a);
      return;
    }
    if (!a.requestSettled || a.outcome === null) return;
    // The request itself failed and no rows can be shown for it: that is the
    // failure screen. (count === null: the one read failed too, e.g. offline.)
    if (a.outcome.kind === "failure" && (count === null || count === 0)) { fail(a); return; }
    // 409, 200 with nothing observable yet, or rows whose preview is not ready.
    startPolling(a);
  }

  function startPolling(a: Attempt) {
    if (pollRef.current !== null) return;
    pollRef.current = setInterval(() => {
      if (!isLiveWaiting(a)) { stopPolling(); return; }
      if (!appActiveRef.current) return;
      void evaluate(a);
    }, BUILDING_SCENE.pollIntervalMs);
  }

  function onDeadline(a: Attempt) {
    if (!isLiveWaiting(a) || a.ready !== null) return;
    // Backgrounded: nothing is decided here. Returning active re-checks the clock.
    if (!appActiveRef.current) return;
    if (!deadlinePassed(a)) { armAttemptTimers(a); return; }
    stopPolling();
    // The scene's deadline, not the fetch wrapper's, ends the request. The
    // abort is "unconfirmed", not "failed": the read below decides.
    a.controller?.abort();
    void evaluate(a);
  }

  function fail(a: Attempt) {
    if (!isLiveWaiting(a)) return;
    // Never surface a failure while not active; the resume path re-reads first.
    if (!appActiveRef.current) return;
    a.phase = "failed";
    stopScene();
    a.controller?.abort();
    subtitleOpacity.value = 1;
    setSlowNotice(false);
    setFailed(true);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  function confirmReady(a: Attempt, preview: RevealData) {
    if (!isLiveWaiting(a) || a.ready !== null) return;
    a.ready = preview;
    stopPolling();
    clearTimer("deadline");
    maybePresent(a);
  }

  // Beat 3 needs: verified preview, Beat 2 fully shown, the minimum scene time,
  // and a foreground app. Missing any one, it re-arms and waits.
  function maybePresent(a: Attempt) {
    if (!isLiveWaiting(a) || a.ready === null) return;
    if (!appActiveRef.current) return;
    if (a.beat < 2) { armBeat2(a); return; }
    const now = Date.now();
    const waitMs = Math.max(a.startedAt + BUILDING_SCENE.minSceneMs - now, a.beat2SettledAt - now, 0);
    if (waitMs > 0) { setTimer("present", () => maybePresent(a), waitMs); return; }
    presentBeat3(a, a.ready);
  }

  function presentBeat3(a: Attempt, ready: RevealData) {
    a.phase = "succeeding";
    stopPolling();
    clearTimer("beat2"); clearTimer("slow"); clearTimer("deadline"); clearTimer("present");
    setSlowNotice(false);
    // Rows are verified: now, and only now, the app's caches are invalidated.
    configRef.current.onGenerated();
    runBeat3(a, ready);
  }

  // Beat 3 itself: swap the line in, fill the third segment, then the success
  // haptic and the route change, each guarded to happen once per attempt.
  function runBeat3(a: Attempt, ready: RevealData) {
    crossfadeSubtitle(a, configRef.current.copy.beat3(ready.count), () => {
      a.beat = 3;
      setBeat(3);
      armBeat3Visuals();
      setTimer("haptic", () => fireSuccessHaptic(a), REVEAL_HAPTIC_OFFSETS[0]);
      setTimer("nav", () => navigateToReveal(a), BUILDING_SCENE.beat3HoldMs);
    });
  }

  function fireSuccessHaptic(a: Attempt) {
    if (!isCurrent(a)) return;
    if (a.hapticFired || a.beat !== 3 || !appActiveRef.current) return;
    a.hapticFired = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function navigateToReveal(a: Attempt) {
    if (!isCurrent(a)) return;
    if (a.navigated || a.phase !== "succeeding" || a.ready === null) return;
    // Backgrounded: hold. resumeAttempt() restarts the Beat 3 tail.
    if (!appActiveRef.current) return;
    fireSuccessHaptic(a);
    a.navigated = true;
    a.phase = "done";
    clearAllTimers();
    const cfg = configRef.current;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.replace({
      pathname: "/(onboarding)/plan-reveal",
      params: {
        vertical: cfg.revealVertical,
        assetId: cfg.assetId,
        assetName: cfg.assetName,
        taskCount: String(a.ready.count),
        preview: serializeRevealPreview(a.ready),
      },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function startAttempt(isRetry: boolean) {
    clearAllTimers();
    stopPolling();
    tokenRef.current += 1;
    const a: Attempt = {
      token: tokenRef.current,
      startedAt: Date.now(),
      phase: "waiting",
      dispatched: false,
      requestSettled: false,
      outcome: null,
      controller: null,
      beat: 1,
      beat2SettledAt: 0,
      ready: null,
      evaluating: false,
      evaluateQueued: false,
      hapticFired: false,
      navigated: false,
    };
    attemptRef.current = a;

    setFailed(false);
    setContinueError(null);
    setSlowNotice(false);
    setBeat(1);
    setSubtitleText(configRef.current.copy.beat1);
    resetVisuals();
    armVisuals();

    if (!configRef.current.assetId) { fail(a); return; }
    armAttemptTimers(a);
    // First attempt: dispatch now (Beat 1 is the dispatch). Try again: look at
    // the rows first; decide() dispatches only if there are none.
    if (isRetry) void evaluate(a);
    else dispatch(a);
  }

  // Returning to the foreground (or an effect re-entry): re-arm from the wall
  // clock and re-read before anything is surfaced.
  function resumeAttempt() {
    const a = attemptRef.current;
    if (!mountedRef.current || a === null) return;
    if (a.phase === "succeeding") {
      // Beat 3 was interrupted. If its line is already up, finish the tail.
      // If it is not, a pending swap timer will carry it; restart the swap
      // only when that timer is gone.
      if (a.navigated || a.ready === null) return;
      if (a.beat === 3) {
        fireSuccessHaptic(a);
        setTimer("nav", () => navigateToReveal(a), BUILDING_SCENE.beat3HoldMs);
      } else if (!timersRef.current.has("swap")) {
        runBeat3(a, a.ready);
      }
      return;
    }
    if (a.phase !== "waiting") return;
    armAttemptTimers(a);
    if (a.ready !== null) { maybePresent(a); return; }
    if (deadlinePassed(a)) { onDeadline(a); return; }
    if (a.requestSettled || !a.dispatched) void evaluate(a);
  }

  useEffect(() => {
    mountedRef.current = true;
    if (unmountAbortRef.current !== null) {
      clearTimeout(unmountAbortRef.current);
      unmountAbortRef.current = null;
    }
    if (!hasStartedRef.current) {
      // Exactly one dispatch per mount, even if this effect is re-entered.
      hasStartedRef.current = true;
      capture("onboarding_step_viewed", { step: configRef.current.analyticsStep });
      startAttempt(false);
    } else {
      resumeAttempt();
    }
    const subscription = AppState.addEventListener("change", (next) => {
      const wasActive = appActiveRef.current;
      appActiveRef.current = next === "active";
      if (!wasActive && appActiveRef.current) resumeAttempt();
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
      stopScene();
      const a = attemptRef.current;
      // Abort the in-flight request on unmount. Deferred one tick so an effect
      // re-entry (which is not an unmount) can cancel it.
      unmountAbortRef.current = setTimeout(() => {
        unmountAbortRef.current = null;
        a?.controller?.abort();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry() {
    const a = attemptRef.current;
    // Only from the failure screen. A second tap finds the new attempt already
    // "waiting" and does nothing, so one tap is one attempt.
    if (a !== null && a.phase !== "failed") return;
    startAttempt(true);
  }

  async function handleContinueAnyway() {
    setContinueError(null);
    if (user) {
      const { error } = await supabase.from("profiles").upsert(
        { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) {
        setContinueError("Couldn’t save your progress. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      await AsyncStorage.setItem(getOnboardingKey(user.id), "true");
    }
    setOnboardingCompleted(true);
    router.replace("/(tabs)");
  }

  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value, transform: [{ translateY: titleY.value }] }));
  const subtitleStyle = useAnimatedStyle(() => ({ opacity: subtitleOpacity.value }));
  const chip1Style = useAnimatedStyle(() => ({ opacity: chip1Opacity.value, transform: [{ translateY: chip1Y.value }] }));
  const chip2Style = useAnimatedStyle(() => ({ opacity: chip2Opacity.value, transform: [{ translateY: chip2Y.value }] }));
  const chip3Style = useAnimatedStyle(() => ({ opacity: chip3Opacity.value, transform: [{ translateY: chip3Y.value }] }));
  const chip0Anim = config.chips[0].anim;
  const chip1Anim = config.chips[1].anim;
  const chip2Anim = config.chips[2].anim;
  const chipIcon0Style = useAnimatedStyle(() => chipIconStyle(chip0Anim, chipIcon0.value, reduceMotion));
  const chipIcon1Style = useAnimatedStyle(() => chipIconStyle(chip1Anim, chipIcon1.value, reduceMotion));
  const chipIcon2Style = useAnimatedStyle(() => chipIconStyle(chip2Anim, chipIcon2.value, reduceMotion));
  const docStyle = useAnimatedStyle(() => ({ opacity: docOpacity.value, transform: [{ scale: docScale.value }] }));
  const docGlowStyle = useAnimatedStyle(() => ({ opacity: interpolate(docGlow.value, [0, 1], [0, 0.8]), transform: [{ scale: interpolate(docGlow.value, [0, 1], [0.8, 1.4]) }] }));
  const readyStyle = useAnimatedStyle(() => ({ opacity: readyOpacity.value }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: interpolate(haloPulse.value, [0, 1], [0.25, 0.55]), transform: [{ scale: interpolate(haloPulse.value, [0, 1], [0.92, 1.12]) }] }));
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${orbitSpin.value * 360}deg` }] }));

  const chipStyles = [chip1Style, chip2Style, chip3Style];
  const chipIconStyles = [chipIcon0Style, chipIcon1Style, chipIcon2Style];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={[styles.progressRow, { marginHorizontal: 20 }]}>
        {SEGMENTS.map((n) => (
          <View key={n} style={styles.progressSegment}>
            {beat >= n ? <View style={[styles.progressFill, { backgroundColor: config.tint }]} /> : null}
          </View>
        ))}
      </View>

      <View style={styles.headerSection}>
        <View style={styles.titleWrap}>
          <Animated.Text style={[styles.title, titleStyle]} numberOfLines={2}>
            {failed ? config.failedTitle : config.assetName}
          </Animated.Text>
        </View>
        {failed && (
          <Animated.Text style={[styles.subtitle, subtitleStyle]}>
            {config.failedSubtitle}
          </Animated.Text>
        )}
      </View>

      {!failed && (
        <View style={styles.chipsRow}>
          {config.chips.map((chip, i) => (
            <Animated.View key={chip.label} style={[styles.chip, chipStyles[i]]}>
              <Animated.View style={chipIconStyles[i]}>
                <VerticalIcon lib={chip.lib} icon={chip.icon} size={15} color={config.tint} />
              </Animated.View>
              <Text style={styles.chipText}>{chip.label}</Text>
            </Animated.View>
          ))}
        </View>
      )}

      {!failed && (
        <View style={styles.stage}>
          <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none">
            <Svg width={HALO_SIZE} height={HALO_SIZE}>
              <Defs>
                <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={config.tint} stopOpacity={0.30} />
                  <Stop offset="0.5" stopColor={config.tint} stopOpacity={0.10} />
                  <Stop offset="1" stopColor={config.tint} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={HALO_SIZE / 2} cy={HALO_SIZE / 2} r={HALO_SIZE / 2} fill="url(#haloGrad)" />
            </Svg>
          </Animated.View>
          <Animated.View style={[styles.orbit, orbitStyle]}>
            {ORBIT_DOTS.map((d, i) => (
              <View key={i} style={[styles.orbitDot, { backgroundColor: config.tint, transform: [{ translateX: d.x }, { translateY: d.y }] }]} />
            ))}
          </Animated.View>
          <Animated.View style={[styles.docGlow, docGlowStyle]} pointerEvents="none">
            <Svg width={DOC_GLOW_SIZE} height={DOC_GLOW_SIZE}>
              <Defs>
                <RadialGradient id="docGlowGrad" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={config.tint} stopOpacity={0.45} />
                  <Stop offset="0.5" stopColor={config.tint} stopOpacity={0.15} />
                  <Stop offset="1" stopColor={config.tint} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={DOC_GLOW_SIZE / 2} cy={DOC_GLOW_SIZE / 2} r={DOC_GLOW_SIZE / 2} fill="url(#docGlowGrad)" />
            </Svg>
          </Animated.View>

          {!reduceMotion && particleProgress.map((p, i) => (
            <Particle key={i} progress={p} index={i} total={PARTICLE_COUNT} color={Colors.white} />
          ))}

          <Animated.View style={[styles.doc, docStyle]}>
            <VerticalIcon lib={config.docIcon.lib} icon={config.docIcon.icon} size={40} color={config.tint} />
          </Animated.View>

          <View style={styles.statusBlock}>
            <Animated.Text style={[styles.statusCaption, subtitleStyle]} numberOfLines={2}>
              {subtitleText}
            </Animated.Text>
            {slowNotice ? <Text style={styles.slowCaption}>{config.copy.slow}</Text> : null}
          </View>

          <Animated.View style={[styles.readyBadge, readyStyle]}>
            <Icon name="checkmark-circle" size={16} color={Colors.good} />
            <Text style={styles.readyText}>Ready</Text>
          </Animated.View>
        </View>
      )}

      {failed && (
        <View style={styles.errorButtons}>
          {continueError ? <Text style={styles.inlineError}>{continueError}</Text> : null}
          <Pressable style={[styles.cta, { backgroundColor: config.tint }]} onPress={handleRetry}>
            <Text style={styles.ctaText}>Try again</Text>
          </Pressable>
          <Pressable style={styles.skip} onPress={handleContinueAnyway}>
            <Text style={styles.skipText}>Continue to app</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, gap: 32 },
  progressRow: { flexDirection: "row", gap: 6 },
  progressSegment: { flex: 1, height: 3, borderRadius: Radius.sm, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { flex: 1, borderRadius: Radius.sm },
  headerSection: { paddingHorizontal: 20, gap: 16, alignItems: "center" },
  titleWrap: { position: "relative" },
  title: { ...Typography.title2, fontWeight: "600", color: Colors.textSecondary, textAlign: "center" },
  subtitle: { ...Typography.title3, fontWeight: "700", color: Colors.text, minHeight: 27, textAlign: "center" },
  statusBlock: { position: "absolute", top: 0, left: 20, right: 20, alignItems: "center", gap: 8 },
  statusCaption: { ...Typography.title3, fontWeight: "700", color: Colors.text, minHeight: 27, textAlign: "center" },
  slowCaption: { ...Typography.footnote, color: Colors.textSecondary, textAlign: "center" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.card, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border },
  chipText: { ...Typography.caption, fontWeight: "500", color: Colors.textSecondary },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", position: "relative" },
  docGlow: { position: "absolute", width: DOC_GLOW_SIZE, height: DOC_GLOW_SIZE },
  halo: { position: "absolute", width: HALO_SIZE, height: HALO_SIZE },
  orbit: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  orbitDot: { position: "absolute", width: 5, height: 5, borderRadius: Radius.sm, opacity: 0.5 },
  doc: { width: 88, height: 88, borderRadius: Radius.lg, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  particle: { position: "absolute", width: 6, height: 6, borderRadius: Radius.pill },
  readyBadge: { position: "absolute", bottom: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.card, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border },
  readyText: { ...Typography.footnote, fontWeight: "600", color: Colors.text },
  errorButtons: { paddingHorizontal: 20, gap: 12, marginTop: 20 },
  cta: { borderRadius: Radius.lg, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { ...Typography.headline, color: Colors.textInverse },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { ...Typography.footnote, color: Colors.textTertiary },
  inlineError: { ...Typography.footnote, fontWeight: "500", color: Colors.overdue, textAlign: "center" },
});
