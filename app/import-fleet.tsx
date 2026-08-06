// import-fleet: full-screen fleet import client for the import-fleet-data
// edge function.
//
// Phases: pick -> mapping (the AI scene) -> preview -> committing ->
// generating -> done. Every error is an inline state inside its own phase;
// nothing here uses a system dialog.
//
// Two invariants drive the shape of this file:
//   1. A stale network response must never advance the state machine. Every
//      preview attempt carries a token; a settled promise whose token no
//      longer matches returns silently.
//   2. A commit whose outcome is UNKNOWN is never retried with a fresh
//      request_id — the replay contract is the disambiguator, so the same id
//      either returns the original result or commits for the first time.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { useQueryClient } from "@tanstack/react-query";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  Easing,
  interpolate,
  runOnJS,
  cancelAnimation,
  type SharedValue,
} from "react-native-reanimated";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { capture } from "@/lib/analytics";
import { hasActivePremium, vehicleLimit } from "@/lib/subscription";
import { PaidActionCTA } from "@/components/PaidActionCTA";
import Paywall from "@/components/Paywall";
import { deleteVehicleCascade } from "@/lib/rpc";
import { getInvokeStatus } from "@/components/onboarding/BuildingScene";

// ---------------------------------------------------------------------------
// Server contract (import-fleet-data). Narrowed at the boundary; no `any`.
// ---------------------------------------------------------------------------
interface PreviewVehicleFlags {
  duplicate_existing: boolean;
  vin_invalid: boolean;
  merged_conflict: boolean;
}

interface PreviewVehicle {
  temp_id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  vin: string | null;
  license_plate: string | null;
  mileage: number | null;
  hours: number | null;
  flags: PreviewVehicleFlags;
  service_count: number;
}

interface SkippedEntry { reason: string; count: number }
interface UnmatchedEntry { identity: string; count: number }
interface IgnoredEntry { file: string; sheet: string | null; reason: string }

interface PreviewBlock {
  vehicles: PreviewVehicle[];
  skipped: SkippedEntry[];
  unmatched_service: UnmatchedEntry[];
  ignored: IgnoredEntry[];
}

interface NormalizedVehicleRow {
  temp_id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  vin: string | null;
  license_plate: string | null;
  mileage: number | null;
  hours: number | null;
  fuel_type: string | null;
  vehicle_category: string | null;
  vehicle_type: string | null;
  tracking_mode: string | null;
}

interface NormalizedLogRow {
  vehicle_temp_id: string;
  service_name: string;
  service_date: string;
  cost: number | null;
  mileage: number | null;
  hours: number | null;
  notes: string | null;
  provider_name: string | null;
}

interface NormalizedPayload {
  vehicles: NormalizedVehicleRow[];
  logs: NormalizedLogRow[];
}

interface ImportPreviewResponse {
  request_id: string;
  preview: PreviewBlock;
  normalized_payload: NormalizedPayload;
}

interface ImportCommitResponse {
  replayed: boolean;
  vehicle_ids: string[];
  temp_map: Record<string, string>;
  log_count: number;
  request_id: string;
}

interface ServerErrorBody { error_code?: string }
interface InvokeErrorContext { status?: number; json?: () => Promise<unknown> }

/**
 * The edge client surfaces the HTTP body behind `err.context.json()`, which is
 * one-shot and may reject. A missing or unreadable body is not an error here —
 * the status alone drives every branch that does not need `error_code`.
 */
async function readErrorBody(err: unknown): Promise<ServerErrorBody | null> {
  const ctx = (err as { context?: InvokeErrorContext })?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const raw = await withTimeout(ctx.json(), AUTH_REFRESH_TIMEOUT_MS);
    if (!raw || typeof raw !== "object") return null;
    const obj: Record<string, unknown> = raw as Record<string, unknown>;
    return { error_code: typeof obj.error_code === "string" ? obj.error_code : undefined };
  } catch {
    return null;
  }
}

class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

/** Every awaited network call in this screen goes through this. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Scene constants — mirrors components/onboarding/BuildingScene.tsx.
// ---------------------------------------------------------------------------
const IMPORT_MIN_SCENE_MS = 6000;
const IMPORT_MAX_WAIT_MS = 30000;
const COMMIT_TIMEOUT_MS = 30000;
const SCHEDULE_TIMEOUT_MS = 20000;
const UNDO_TIMEOUT_MS = 30000;
const AUTH_REFRESH_TIMEOUT_MS = 10000;
const PARTICLE_COUNT = 12;
const ORBIT_RADIUS = 96;
const ORBIT_DOTS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { x: Math.cos(a) * ORBIT_RADIUS, y: Math.sin(a) * ORBIT_RADIUS };
});

const MAX_FILES = 4;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_DISCLOSURE_ROWS = 5;

const PICK_TYPES = [
  "text/csv",
  "text/comma-separated-values",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

type ChipAnim = "shimmer" | "bounce" | "spin";
interface SceneChip { lib: "ion" | "mci"; icon: string; label: string; anim: ChipAnim }

const SCENE_CHIPS: [SceneChip, SceneChip, SceneChip] = [
  { lib: "mci", icon: "table", label: "Columns", anim: "shimmer" },
  { lib: "ion", icon: "car-sport", label: "Vehicles", anim: "bounce" },
  { lib: "ion", icon: "construct", label: "Service history", anim: "spin" },
];

const SCENE_COPY = {
  initial: "Opening your files",
  beat1: "Reading your columns",
  beat2: "Matching vehicles across files",
  beat3: "Attaching service records",
  slow: "Big files — almost there.",
  ready: "Found your fleet.",
};

interface SceneFailure { title: string; subtitle: string; showPlans: boolean }

const FAILURE_RETRYABLE: SceneFailure = {
  title: "Reading your files hit a snag",
  subtitle: "Your files are fine — this is on us. Try again.",
  showPlans: false,
};
const FAILURE_401: SceneFailure = {
  title: "Session hiccup",
  subtitle: "Try again — if it keeps happening, sign out and back in.",
  showPlans: false,
};
const FAILURE_413: SceneFailure = {
  title: "Files are too big",
  subtitle: "Keep each file under 2 MB — and under 4 MB together — and try again.",
  showPlans: false,
};
const FAILURE_422: SceneFailure = {
  title: "Couldn't read those files",
  subtitle: "Export them as CSV and give it another shot.",
  showPlans: false,
};
const FAILURE_429: SceneFailure = {
  title: "Too many imports right now",
  subtitle: "Give it a few minutes and try again.",
  showPlans: false,
};
const FAILURE_CAP: SceneFailure = {
  title: "This import has more vehicles than your plan holds",
  subtitle: "Upgrade for a bigger garage, or import a smaller file.",
  showPlans: true,
};

type Phase = "pick" | "mapping" | "preview" | "committing" | "generating" | "done";
type SceneStatus = "running" | "ready" | "failed";
type CommitFailure = "sync" | "ambiguous";

interface PickedFile { uri: string; name: string; size: number | null }

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function vehicleTitle(v: { nickname: string | null; year: number; make: string; model: string }): string {
  return v.nickname ?? `${v.year} ${v.make} ${v.model}`;
}

// ---------------------------------------------------------------------------
// Scene primitives — copied patterns from BuildingScene (which stays untouched).
// ---------------------------------------------------------------------------
function SceneIcon({ lib, icon, size, color }: { lib: "ion" | "mci"; icon: string; size: number; color: string }) {
  if (lib === "mci") {
    return <MaterialCommunityIcons name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={size} color={color} />;
  }
  return <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
}

function armChip(sv: SharedValue<number>, kind: ChipAnim, delay: number) {
  if (kind === "bounce") {
    sv.value = withDelay(delay, withSequence(
      withSpring(-8, { damping: 14, stiffness: 220 }),
      withSpring(0, { damping: 12, stiffness: 180 }),
    ));
  } else if (kind === "spin") {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1));
  } else {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));
  }
}

function chipIconStyle(kind: ChipAnim, v: number) {
  "worklet";
  if (kind === "bounce") return { transform: [{ translateY: v }] };
  if (kind === "spin") return { transform: [{ rotate: `${v * 360}deg` }] };
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
 * The mapping scene. It owns only presentation and its own minimum-duration
 * hold; the parent owns the network attempt and flips `status`.
 */
function MappingScene({
  status,
  failure,
  onReveal,
  onRetry,
  onChooseDifferent,
  onSeePlans,
}: {
  status: SceneStatus;
  failure: SceneFailure | null;
  onReveal: () => void;
  onRetry: () => void;
  onChooseDifferent: () => void;
  onSeePlans: () => void;
}) {
  const [subtitleText, setSubtitleText] = useState(SCENE_COPY.initial);
  const sceneStart = useRef(Date.now());
  const revealed = useRef(false);
  const doneRef = useRef(false);
  const failedRef = useRef(false);
  const sceneTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finalizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const particleProgress = useMemo(
    () => [particle0, particle1, particle2, particle3, particle4, particle5, particle6, particle7, particle8, particle9, particle10, particle11],
    [particle0, particle1, particle2, particle3, particle4, particle5, particle6, particle7, particle8, particle9, particle10, particle11],
  );

  const swapSubtitle = useCallback((next: string) => {
    if (failedRef.current) return;
    subtitleOpacity.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.ease) }, (finished) => {
      if (finished) {
        runOnJS(setSubtitleText)(next);
        subtitleOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.ease) });
      }
    });
  }, [subtitleOpacity]);

  const stopScene = useCallback(() => {
    [
      haloPulse, orbitSpin, titleOpacity, titleY, subtitleOpacity,
      chip1Opacity, chip1Y, chip2Opacity, chip2Y, chip3Opacity, chip3Y,
      chipIcon0, chipIcon1, chipIcon2, docScale, docOpacity, docGlow, readyOpacity,
      particle0, particle1, particle2, particle3, particle4, particle5,
      particle6, particle7, particle8, particle9, particle10, particle11,
    ].forEach((sv) => cancelAnimation(sv));
    sceneTimers.current.forEach(clearTimeout);
    sceneTimers.current = [];
    if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetSceneValues = () => {
    titleOpacity.value = 0;
    titleY.value = 10;
    subtitleOpacity.value = 1;
    chip1Opacity.value = 0;
    chip1Y.value = 12;
    chip2Opacity.value = 0;
    chip2Y.value = 12;
    chip3Opacity.value = 0;
    chip3Y.value = 12;
    chipIcon0.value = 0;
    chipIcon1.value = 0;
    chipIcon2.value = 0;
    haloPulse.value = 0;
    orbitSpin.value = 0;
    docScale.value = 0;
    docOpacity.value = 0;
    docGlow.value = 0;
    readyOpacity.value = 0;
    particle0.value = 0;
    particle1.value = 0;
    particle2.value = 0;
    particle3.value = 0;
    particle4.value = 0;
    particle5.value = 0;
    particle6.value = 0;
    particle7.value = 0;
    particle8.value = 0;
    particle9.value = 0;
    particle10.value = 0;
    particle11.value = 0;
  };

  const armScene = useCallback(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    titleOpacity.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    titleY.value = withSpring(0, { damping: 17, stiffness: 150 });
    haloPulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
    orbitSpin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1);

    timers.push(setTimeout(() => swapSubtitle(SCENE_COPY.beat1), 1400));
    timers.push(setTimeout(() => swapSubtitle(SCENE_COPY.beat2), 3100));
    timers.push(setTimeout(() => swapSubtitle(SCENE_COPY.beat3), 4700));
    timers.push(setTimeout(() => {
      if (!doneRef.current && !failedRef.current) swapSubtitle(SCENE_COPY.slow);
    }, 8000));

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));

    armChip(chipIcon0, SCENE_CHIPS[0].anim, 1400);
    armChip(chipIcon1, SCENE_CHIPS[1].anim, 1700);
    armChip(chipIcon2, SCENE_CHIPS[2].anim, 2000);

    particleProgress.forEach((p, i) => {
      p.value = withDelay(4700 + i * 100, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
    });
    docOpacity.value = withDelay(5300, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(5300, withTiming(0.85, { duration: 500 }));
    return timers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapSubtitle, particleProgress]);

  useEffect(() => {
    sceneStart.current = Date.now();
    sceneTimers.current = armScene();
    return () => { stopScene(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status is owned by the parent; the scene reacts to it.
  useEffect(() => {
    if (status === "failed") {
      failedRef.current = true;
      stopScene();
      subtitleOpacity.value = 1;
      return;
    }
      if (status === "running" && failedRef.current) {
        failedRef.current = false;
        doneRef.current = false;
        revealed.current = false;
        stopScene();
        resetSceneValues();
        setSubtitleText(SCENE_COPY.initial);
        sceneStart.current = Date.now();
        sceneTimers.current = armScene();
      }
    if (status === "ready" && !revealed.current) {
      revealed.current = true;
      doneRef.current = true;
      const elapsed = Date.now() - sceneStart.current;
      const hold = Math.max(IMPORT_MIN_SCENE_MS - elapsed, 0);
      finalizeTimer.current = setTimeout(() => {
        if (failedRef.current) return;
        swapSubtitle(SCENE_COPY.ready);
        docScale.value = withSpring(1.15, { damping: 10, stiffness: 140 }, () => {
          docScale.value = withSpring(1, { damping: 14, stiffness: 180 });
        });
        docGlow.value = withTiming(1, { duration: 400 });
        readyOpacity.value = withTiming(1, { duration: 300 });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        advanceTimer.current = setTimeout(() => { onReveal(); }, 900);
      }, hold);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value, transform: [{ translateY: titleY.value }] }));
  const subtitleStyle = useAnimatedStyle(() => ({ opacity: subtitleOpacity.value }));
  const chip1Style = useAnimatedStyle(() => ({ opacity: chip1Opacity.value, transform: [{ translateY: chip1Y.value }] }));
  const chip2Style = useAnimatedStyle(() => ({ opacity: chip2Opacity.value, transform: [{ translateY: chip2Y.value }] }));
  const chip3Style = useAnimatedStyle(() => ({ opacity: chip3Opacity.value, transform: [{ translateY: chip3Y.value }] }));
  const chipIcon0Style = useAnimatedStyle(() => chipIconStyle(SCENE_CHIPS[0].anim, chipIcon0.value));
  const chipIcon1Style = useAnimatedStyle(() => chipIconStyle(SCENE_CHIPS[1].anim, chipIcon1.value));
  const chipIcon2Style = useAnimatedStyle(() => chipIconStyle(SCENE_CHIPS[2].anim, chipIcon2.value));
  const docStyle = useAnimatedStyle(() => ({ opacity: docOpacity.value, transform: [{ scale: docScale.value }] }));
  const docGlowStyle = useAnimatedStyle(() => ({ opacity: interpolate(docGlow.value, [0, 1], [0, 0.35]), transform: [{ scale: interpolate(docGlow.value, [0, 1], [0.8, 1.4]) }] }));
  const readyStyle = useAnimatedStyle(() => ({ opacity: readyOpacity.value }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: interpolate(haloPulse.value, [0, 1], [0.10, 0.26]), transform: [{ scale: interpolate(haloPulse.value, [0, 1], [0.92, 1.12]) }] }));
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${orbitSpin.value * 360}deg` }] }));

  const chipStyles = [chip1Style, chip2Style, chip3Style];
  const chipIconStyles = [chipIcon0Style, chipIcon1Style, chipIcon2Style];
  const isFailed = status === "failed" && failure !== null;

  return (
    <View style={styles.sceneRoot}>
      <View style={styles.sceneHeaderSection}>
        <Animated.Text style={[styles.sceneTitle, titleStyle]} numberOfLines={2}>
          {isFailed && failure ? failure.title : "Your fleet"}
        </Animated.Text>
        {isFailed && failure ? (
          <Text style={styles.sceneFailSubtitle}>{failure.subtitle}</Text>
        ) : null}
      </View>

      {!isFailed && (
        <View style={styles.chipsRow}>
          {SCENE_CHIPS.map((chip, i) => (
            <Animated.View key={chip.label} style={[styles.chip, chipStyles[i]]}>
              <Animated.View style={chipIconStyles[i]}>
                <SceneIcon lib={chip.lib} icon={chip.icon} size={15} color={Colors.accent} />
              </Animated.View>
              <Text style={styles.chipText}>{chip.label}</Text>
            </Animated.View>
          ))}
        </View>
      )}

      {!isFailed && (
        <View style={styles.stage}>
          <Animated.View style={[styles.halo, { backgroundColor: Colors.accent }, haloStyle]} />
          <Animated.View style={[styles.orbit, orbitStyle]}>
            {ORBIT_DOTS.map((d, i) => (
              <View key={i} style={[styles.orbitDot, { backgroundColor: Colors.accent, transform: [{ translateX: d.x }, { translateY: d.y }] }]} />
            ))}
          </Animated.View>
          <Animated.View style={[styles.docGlow, { backgroundColor: Colors.accent }, docGlowStyle]} />

          {particleProgress.map((p, i) => (
            <Particle key={i} progress={p} index={i} total={PARTICLE_COUNT} color={Colors.accent} />
          ))}

          <Animated.View style={[styles.doc, docStyle]}>
            <Ionicons name="document-text-outline" size={40} color={Colors.accent} />
          </Animated.View>

          <Animated.Text style={[styles.statusCaption, subtitleStyle]} numberOfLines={2}>
            {subtitleText}
          </Animated.Text>

          <Animated.View style={[styles.readyBadge, readyStyle]}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.good} />
            <Text style={styles.readyText}>Ready</Text>
          </Animated.View>
        </View>
      )}

      {isFailed && failure ? (
        <View style={styles.errorButtons}>
          {failure.showPlans ? (
            <Pressable
              style={({ pressed }) => [styles.sceneCta, { opacity: pressed ? 0.85 : 1 }]}
              onPress={onSeePlans}
              accessibilityRole="button"
              accessibilityLabel="See plans"
            >
              <Text style={styles.sceneCtaText}>See plans</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.sceneCta, { opacity: pressed ? 0.85 : 1 }]}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Try reading your files again"
            >
              <Text style={styles.sceneCtaText}>Try again</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.sceneSkip, { opacity: pressed ? 0.7 : 1 }]}
            onPress={onChooseDifferent}
            accessibilityRole="button"
            accessibilityLabel="Choose different files"
          >
            <Text style={styles.sceneSkipText}>Choose different files</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function ImportFleetScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>("pick");
  const [serverDeniedPaid, setServerDeniedPaid] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState(false);

  const [files, setFiles] = useState<PickedFile[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string>("");

  const [sceneStatus, setSceneStatus] = useState<SceneStatus>("running");
  const [sceneFailure, setSceneFailure] = useState<SceneFailure | null>(null);
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [capExisting, setCapExisting] = useState<number | null>(null);
  const [capKnown, setCapKnown] = useState(false);
  const [capBlockedAt, setCapBlockedAt] = useState<number | null>(null);

  const [commitFailure, setCommitFailure] = useState<CommitFailure | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);

  const [genIndex, setGenIndex] = useState(0);
  const [genTotal, setGenTotal] = useState(0);
  const [genLabel, setGenLabel] = useState("");
  const [scheduleOutcomes, setScheduleOutcomes] = useState<Record<string, "ok" | "failed">>({});
  const [retriedSchedules, setRetriedSchedules] = useState(false);

  const [undoConfirm, setUndoConfirm] = useState(false);
  const [undoStatus, setUndoStatus] = useState<"idle" | "removing" | "removed" | "failed">("idle");

  const attemptRef = useRef(0);
  const inFlightRef = useRef(false);
  const readingRef = useRef(false);
  const retried409Ref = useRef(false);
  const committedCaptureRef = useRef(false);
  const fileContentsRef = useRef<string[]>([]);

  const isPremium = hasActivePremium(profile);
  const gated = !isPremium || serverDeniedPaid;

  useEffect(() => {
    if (isPremium && serverDeniedPaid) setServerDeniedPaid(false);
  }, [isPremium, serverDeniedPaid]);

  // -------------------------------------------------------------------------
  // Paid gate — server is the authority; a stale local profile resyncs.
  // -------------------------------------------------------------------------
  const denyPaid = useCallback(() => {
    attemptRef.current += 1;
    setSceneFailure(null);
    setSceneStatus("running");
    setRequestInFlight(false);
    setPhase("pick");
    setServerDeniedPaid(true);
    void refreshProfile();
  }, [refreshProfile]);

  const resetAll = useCallback(() => {
    attemptRef.current += 1;
    retried409Ref.current = false;
    committedCaptureRef.current = false;
    fileContentsRef.current = [];
    setFiles([]);
    setPickError(null);
    setRequestId("");
    setPreviewData(null);
    setSelected(new Set());
    setCapExisting(null);
    setCapKnown(false);
    setCapBlockedAt(null);
    setCommitFailure(null);
    setCommitResult(null);
    setScheduleOutcomes({});
    setRetriedSchedules(false);
    setUndoConfirm(false);
    setUndoStatus("idle");
    setSceneFailure(null);
    setSceneStatus("running");
    setRequestInFlight(false);
    setPhase("pick");
  }, []);

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------
  const runPreview = useCallback(async (rid: string, contents: { name: string; base64: string }[]) => {
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    setSceneFailure(null);
    setSceneStatus("running");
    try {
      const res = await withTimeout(
        supabase.functions.invoke<ImportPreviewResponse>("import-fleet-data", {
          body: { request_id: rid, mode: "preview", files: contents },
        }),
        IMPORT_MAX_WAIT_MS,
      );
      if (attempt !== attemptRef.current) return;

      if (res.error) {
        const status = getInvokeStatus(res.error);
        if (status === 403) {
          const body = await readErrorBody(res.error);
          if (attempt !== attemptRef.current) return;
          if (body?.error_code === "vehicle_cap") {
            setSceneFailure(FAILURE_CAP);
            setSceneStatus("failed");
            return;
          }
          denyPaid();
          return;
        }
        if (status === 409) {
          if (!retried409Ref.current) {
            retried409Ref.current = true;
            const next = Crypto.randomUUID();
            setRequestId(next);
            void runPreview(next, contents);
            return;
          }
          setSceneFailure(FAILURE_RETRYABLE);
          setSceneStatus("failed");
          return;
        }
        if (status === 401) {
          try {
            await withTimeout(supabase.auth.refreshSession(), AUTH_REFRESH_TIMEOUT_MS);
          } catch {
            // Refresh hung or failed — the 401 failure copy below fits both.
          }
          if (attempt !== attemptRef.current) return;
          setSceneFailure(FAILURE_401);
          setSceneStatus("failed");
          return;
        }
        if (status === 413) { setSceneFailure(FAILURE_413); setSceneStatus("failed"); return; }
        if (status === 422) { setSceneFailure(FAILURE_422); setSceneStatus("failed"); return; }
        if (status === 429) { setSceneFailure(FAILURE_429); setSceneStatus("failed"); return; }
        setSceneFailure(FAILURE_RETRYABLE);
        setSceneStatus("failed");
        return;
      }

      const data = res.data;
      if (!data || !data.preview || !Array.isArray(data.preview.vehicles)) {
        setSceneFailure(FAILURE_RETRYABLE);
        setSceneStatus("failed");
        return;
      }
      setPreviewData(data);
      setSelected(new Set(
        data.preview.vehicles.filter((v) => !v.flags?.duplicate_existing).map((v) => v.temp_id),
      ));
      const records = data.preview.vehicles.reduce((sum, v) => sum + (v.service_count ?? 0), 0);
      capture("fleet_import_previewed", { vehicles: data.preview.vehicles.length, service_records: records });
      setSceneStatus("ready");
    } catch (e) {
      if (attempt !== attemptRef.current) return;
      if (__DEV__) console.warn("[import-fleet] preview failed:", e);
      setSceneFailure(FAILURE_RETRYABLE);
      setSceneStatus("failed");
    }
  }, [denyPaid]);

  // -------------------------------------------------------------------------
  // Pick
  // -------------------------------------------------------------------------
  const pickFiles = useCallback(async () => {
    setPickError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: PICK_TYPES,
      });
      if (res.canceled || !res.assets) return;

      let next: PickedFile[] = res.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        size: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : null,
      }));

      let message: string | null = null;
      if (next.length > MAX_FILES) {
        next = next.slice(0, MAX_FILES);
        message = "Up to 4 files per import — kept the first four.";
      }
      if (next.some((f) => f.size !== null && f.size > MAX_FILE_BYTES)) {
        message = "Each file needs to be under 2 MB.";
      } else {
        const knownTotal = next.reduce((sum, f) => sum + (f.size ?? 0), 0);
        if (knownTotal > MAX_TOTAL_BYTES) message = "Together your files need to be under 4 MB.";
      }
      setFiles(next);
      setPickError(message);
    } catch (e) {
      if (__DEV__) console.warn("[import-fleet] picker failed:", e);
      setPickError("Couldn't open your files. Try again.");
    }
  }, []);

  const removeFile = useCallback((uri: string) => {
    Haptics.selectionAsync().catch(() => {});
    setPickError(null);
    setFiles((prev) => prev.filter((f) => f.uri !== uri));
  }, []);

  const oversizeUris = useMemo(
    () => new Set(files.filter((f) => f.size !== null && f.size > MAX_FILE_BYTES).map((f) => f.uri)),
    [files],
  );

  const canRead = files.length >= 1 && files.length <= MAX_FILES && oversizeUris.size === 0;

  const handleReadFiles = useCallback(async () => {
    if (readingRef.current) return;
    readingRef.current = true;
    setPickError(null);
    try {
      // Resolve any unknown size BEFORE reading: a full base64 read of an
      // unbounded file can spike memory well past what the server would
      // reject anyway.
      const resolved: PickedFile[] = [];
      for (const f of files) {
        if (f.size !== null) { resolved.push(f); continue; }
        try {
          const info = await FileSystem.getInfoAsync(f.uri);
          resolved.push({ ...f, size: info.exists && typeof info.size === "number" ? info.size : null });
        } catch {
          resolved.push(f);
        }
      }
      if (resolved.some((f) => f.size !== null && f.size > MAX_FILE_BYTES)) {
        setFiles(resolved);
        setPickError("Each file needs to be under 2 MB.");
        return;
      }
      const total = resolved.reduce((sum, f) => sum + (f.size ?? 0), 0);
      if (total > MAX_TOTAL_BYTES) {
        setFiles(resolved);
        setPickError("Together your files need to be under 4 MB.");
        return;
      }
      setFiles(resolved);

      const contents: { name: string; base64: string }[] = [];
      for (const f of resolved) {
        try {
          const base64 = await FileSystem.readAsStringAsync(f.uri, { encoding: "base64" });
          contents.push({ name: f.name, base64 });
        } catch {
          setPickError(`Couldn't open ${f.name}. Re-export it and try again.`);
          return;
        }
      }

      const rid = Crypto.randomUUID();
      retried409Ref.current = false;
      setRequestId(rid);
      fileContentsRef.current = contents.map((c) => c.base64);
      capture("fleet_import_started", { files: resolved.length });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setPhase("mapping");
      void runPreview(rid, contents);
    } finally {
      readingRef.current = false;
    }
  }, [files, runPreview]);

  const retryPreview = useCallback(() => {
    const contents = files.map((f, i) => ({ name: f.name, base64: fileContentsRef.current[i] ?? "" }));
    if (contents.some((c) => c.base64 === "")) { resetAll(); return; }
    const rid = Crypto.randomUUID();
    retried409Ref.current = false;
    setRequestId(rid);
    void runPreview(rid, contents);
  }, [files, runPreview, resetAll]);

  // -------------------------------------------------------------------------
  // Cap (preview entry)
  // -------------------------------------------------------------------------
  const fetchCap = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const { count, error } = await withTimeout(
        Promise.resolve(
          supabase
            .from("vehicles")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id),
        ),
        AUTH_REFRESH_TIMEOUT_MS,
      );
      if (error) { setCapKnown(false); return false; }
      setCapExisting(count ?? 0);
      setCapKnown(true);
      return true;
    } catch {
      setCapKnown(false);
      return false;
    }
  }, [user]);

  useEffect(() => {
    if (phase !== "preview") return;
    void fetchCap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const limit = vehicleLimit(profile);
  const remaining = capKnown ? Math.max(0, limit - (capExisting ?? 0)) : Infinity;
  const overCap = capKnown && selected.size > remaining;
  const showCapBanner = overCap || capBlockedAt !== null;
  const commitDisabled =
    selected.size === 0 ||
    overCap ||
    (capBlockedAt !== null && selected.size >= capBlockedAt);

  const toggleVehicle = useCallback((tempId: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------
  const runCommit = useCallback(async (rid: string, payload: NormalizedPayload) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCommitFailure(null);
    setRequestInFlight(true);
    setPhase("committing");
    try {
      const res = await withTimeout(
        supabase.functions.invoke<ImportCommitResponse>("import-fleet-data", {
          body: { request_id: rid, mode: "commit", normalized_payload: payload },
        }),
        COMMIT_TIMEOUT_MS,
      );

      if (res.error) {
        const status = getInvokeStatus(res.error);
        if (status === 403) {
          const body = await readErrorBody(res.error);
          if (body?.error_code === "vehicle_cap") {
            // A downgrade can be the cause, so the plan limit refreshes too.
            void refreshProfile();
            const ok = await fetchCap();
            if (!ok) setCapKnown(false);
            setCapBlockedAt(selected.size);
            setRequestInFlight(false);
            setPhase("preview");
            return;
          }
          denyPaid();
          return;
        }
        if (status === 409 || status === 413 || status === 422) {
          setCommitFailure("sync");
          setRequestInFlight(false);
          return;
        }
        if (status === 401) {
          try {
            await withTimeout(supabase.auth.refreshSession(), AUTH_REFRESH_TIMEOUT_MS);
          } catch {
            // Refresh hung or failed — same ambiguous handling either way.
          }
          setCommitFailure("ambiguous");
          setRequestInFlight(false);
          return;
        }
        setCommitFailure("ambiguous");
        setRequestInFlight(false);
        return;
      }

      const data = res.data;
      if (!data || !Array.isArray(data.vehicle_ids) || !data.temp_map) {
        setCommitFailure("ambiguous");
        setRequestInFlight(false);
        return;
      }
      setCommitResult(data);
      setRequestInFlight(false);
      setPhase("generating");
    } catch (e) {
      if (__DEV__) console.warn("[import-fleet] commit failed:", e);
      setCommitFailure("ambiguous");
      setRequestInFlight(false);
    } finally {
      inFlightRef.current = false;
    }
  }, [denyPaid, fetchCap, refreshProfile, selected]);

  const filteredPayload = useMemo((): NormalizedPayload => {
    if (!previewData) return { vehicles: [], logs: [] };
    return {
      vehicles: previewData.normalized_payload.vehicles.filter((v) => selected.has(v.temp_id)),
      logs: previewData.normalized_payload.logs.filter((l) => selected.has(l.vehicle_temp_id)),
    };
  }, [previewData, selected]);

  const handleCommitPress = useCallback(() => {
    if (inFlightRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    void runCommit(requestId, filteredPayload);
  }, [requestId, filteredPayload, runCommit]);

  // -------------------------------------------------------------------------
  // Schedule generation
  // -------------------------------------------------------------------------
  const generateFor = useCallback(async (tempIds: string[], result: ImportCommitResponse) => {
    const rowsByTempId = new Map<string, NormalizedVehicleRow>();
    for (const row of filteredPayload.vehicles) rowsByTempId.set(row.temp_id, row);

    const outcomes: Record<string, "ok" | "failed"> = {};
    setGenTotal(tempIds.length);
    for (let i = 0; i < tempIds.length; i++) {
      const tempId = tempIds[i];
      const vehicleId = result.temp_map[tempId];
      const row = rowsByTempId.get(tempId);
      setGenIndex(i + 1);
      if (row) setGenLabel(`${row.year} ${row.make} ${row.model}`);
      if (!vehicleId || !row) { outcomes[tempId] = "failed"; continue; }
      try {
        const res = await withTimeout(
          supabase.functions.invoke("generate-maintenance-schedule", {
            body: {
              vehicle_id: vehicleId,
              make: row.make,
              model: row.model,
              year: Number(row.year),
              current_mileage: Number(row.mileage ?? 0),
              current_hours: Number(row.hours ?? 0),
              tracking_mode: row.tracking_mode ?? null,
              // The server's "vehicle_type" param carries FUEL type at every
              // existing call site; kept identical to add-vehicle on purpose.
              vehicle_type: row.fuel_type ?? "gas",
              is_awd: false,
              vehicle_category: row.vehicle_category ?? null,
            },
          }),
          SCHEDULE_TIMEOUT_MS,
        );
        if (res.error) {
          // 409 is the per-vehicle generation lock suppressing a duplicate —
          // the schedule is being built, so this is a success.
          outcomes[tempId] = getInvokeStatus(res.error) === 409 ? "ok" : "failed";
          if (outcomes[tempId] === "failed" && __DEV__) {
            console.warn("[import-fleet] schedule failed:", res.error);
          }
        } else {
          outcomes[tempId] = "ok";
        }
      } catch (e) {
        outcomes[tempId] = "failed";
        if (__DEV__) console.warn("[import-fleet] schedule timed out:", e);
      }
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", vehicleId] });
    }

    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["maintenance_tasks"] });
    return outcomes;
  }, [filteredPayload, queryClient]);

  useEffect(() => {
    if (phase !== "generating" || !commitResult) return;
    let cancelled = false;
    (async () => {
      const tempIds = filteredPayload.vehicles.map((v) => v.temp_id);
      const outcomes = await generateFor(tempIds, commitResult);
      if (cancelled) return;
      setScheduleOutcomes(outcomes);
      const failedCount = Object.values(outcomes).filter((o) => o === "failed").length;
      if (failedCount === 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
      if (!committedCaptureRef.current) {
        committedCaptureRef.current = true;
        capture("fleet_import_committed", {
          vehicles: tempIds.length,
          service_records: commitResult.log_count,
          schedules_failed: failedCount,
          replayed: commitResult.replayed,
        });
      }
      setPhase("done");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, commitResult]);

  const retrySchedules = useCallback(async () => {
    if (inFlightRef.current || !commitResult) return;
    inFlightRef.current = true;
    try {
      const failedIds = Object.keys(scheduleOutcomes).filter((k) => scheduleOutcomes[k] === "failed");
      if (failedIds.length === 0) return;
      setPhase("generating");
      const outcomes = await generateFor(failedIds, commitResult);
      const merged = { ...scheduleOutcomes, ...outcomes };
      setScheduleOutcomes(merged);
      setRetriedSchedules(true);
      const stillFailed = Object.values(merged).filter((o) => o === "failed").length;
      capture("fleet_import_schedules_retried", { retried: failedIds.length, still_failed: stillFailed });
      setPhase("done");
    } finally {
      inFlightRef.current = false;
    }
  }, [commitResult, scheduleOutcomes, generateFor]);

  // -------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------
  const runUndoRemoval = useCallback(async () => {
    if (inFlightRef.current || !commitResult) return;
    inFlightRef.current = true;
    setRequestInFlight(true);
    setUndoStatus("removing");
    try {
      const ids = commitResult.vehicle_ids;
      let okCount = 0;
      for (let i = 0; i < ids.length; i++) {
        try {
          const { error } = await withTimeout(deleteVehicleCascade({ p_vehicle_id: ids[i] }), UNDO_TIMEOUT_MS);
          if (!error) okCount += 1;
        } catch (e) {
          if (__DEV__) console.warn("[import-fleet] undo failed for a vehicle:", e);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_tasks"] });
      capture("fleet_import_undone", { attempted: ids.length, removed: okCount });
      if (okCount === ids.length) {
        setUndoStatus("removed");
      } else {
        setUndoStatus("failed");
      }
    } catch {
      setUndoStatus("failed");
    } finally {
      inFlightRef.current = false;
      setRequestInFlight(false);
    }
  }, [commitResult, queryClient]);

  const confirmUndoRemoval = () => {
    setUndoConfirm(false);
    void runUndoRemoval();
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const preview = previewData?.preview ?? null;
  const totalRecords = preview ? preview.vehicles.reduce((s, v) => s + (v.service_count ?? 0), 0) : 0;
  const failedScheduleCount = Object.values(scheduleOutcomes).filter((o) => o === "failed").length;
  const okScheduleCount = Object.values(scheduleOutcomes).filter((o) => o === "ok").length;
  const committedCount = commitResult ? commitResult.vehicle_ids.length : 0;

  const paywallModal = (
    <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
      <Paywall
        canDismiss
        showSkip={false}
        context={{ vertical: "vehicle", reason: "limit_reached" }}
        onDismiss={() => setShowPaywall(false)}
      />
    </Modal>
  );

  const header = (
    <View style={styles.header}>
      {requestInFlight ? (
        <View style={{ width: 24 }} />
      ) : (
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close import"
        >
          <Ionicons name="close" size={24} color={Colors.text} />
        </Pressable>
      )}
      <Text style={styles.headerTitle}>Import fleet</Text>
      <View style={{ width: 24 }} />
    </View>
  );

  // --- gate ----------------------------------------------------------------
  if (gated) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <View style={[styles.centered, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.heroTile}>
            <Ionicons name="cloud-upload-outline" size={40} color={Colors.accent} />
          </View>
          <Text style={styles.gateTitle}>Fleet import comes with paid plans</Text>
          <Text style={styles.gateBody}>
            Bring in every vehicle and its full service history from a spreadsheet — in one pass.
          </Text>
          <View style={styles.gateCtaWrap}>
            <PaidActionCTA label="See plans" onPress={() => setShowPaywall(true)} />
          </View>
        </View>
        {paywallModal}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {header}

      {phase === "pick" && (
        <ScrollView
          contentContainerStyle={[styles.pickScroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroTile}>
            <Ionicons name="cloud-upload-outline" size={40} color={Colors.accent} />
          </View>
          <Text style={styles.pickTitle}>Import your fleet</Text>
          <Text style={styles.pickBody}>
            Add every vehicle and its service history at once. CSV and Excel files work — up to 4 files, 2 MB each.
          </Text>
          <Text style={styles.pickHint}>
            Any spreadsheet with your vehicles and service records works — we&apos;ll figure out the columns.
          </Text>

          <View style={styles.pickCtaWrap}>
            <PaidActionCTA label="Choose files" variant="secondary" icon="folder-open-outline" onPress={() => { void pickFiles(); }} />
          </View>

          {files.length > 0 && (
            <View style={styles.chipList}>
              {files.map((f) => {
                const oversize = oversizeUris.has(f.uri);
                return (
                  <View key={f.uri} style={[styles.fileChip, oversize ? styles.fileChipBad : null]}>
                    <Ionicons name="document-text-outline" size={15} color={oversize ? Colors.overdue : Colors.accent} />
                    <Text style={styles.fileChipName} numberOfLines={1}>{f.name}</Text>
                    {f.size !== null ? <Text style={styles.fileChipSize}>{formatBytes(f.size)}</Text> : null}
                    <Pressable
                      onPress={() => removeFile(f.uri)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${f.name}`}
                    >
                      <Ionicons name="close" size={15} color={Colors.textTertiary} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {pickError ? <Text style={styles.inlineError}>{pickError}</Text> : null}

          <View style={styles.pickCtaWrap}>
            <PaidActionCTA label="Read my files" disabled={!canRead} onPress={() => { void handleReadFiles(); }} />
          </View>
        </ScrollView>
      )}

      {phase === "mapping" && (
        <MappingScene
          status={sceneStatus}
          failure={sceneFailure}
          onReveal={() => setPhase("preview")}
          onRetry={retryPreview}
          onChooseDifferent={() => { attemptRef.current += 1; setSceneFailure(null); setSceneStatus("running"); setPhase("pick"); }}
          onSeePlans={() => setShowPaywall(true)}
        />
      )}

      {phase === "preview" && preview && (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 140 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.summary}>
              Found {preview.vehicles.length} vehicle{plural(preview.vehicles.length)} and {totalRecords} service record{plural(totalRecords)}
            </Text>

            {showCapBanner && (
              <View style={styles.capBanner}>
                {capKnown ? (
                  <>
                    <Text style={styles.capTitle}>
                      {remaining > 0
                        ? `Your plan has room for ${remaining} more vehicle${plural(remaining)}`
                        : "Your plan's garage is full"}
                    </Text>
                    <Text style={styles.capSub}>
                      {remaining > 0
                        ? `Deselect ${selected.size - remaining}, or upgrade for a bigger garage.`
                        : "Deselect these, or upgrade for a bigger garage."}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.capTitle}>Your garage is full for this plan. Deselect a few or upgrade.</Text>
                )}
                <View style={{ marginTop: 10 }}>
                  <PaidActionCTA label="See plans" variant="secondary" onPress={() => setShowPaywall(true)} />
                </View>
              </View>
            )}

            <View style={{ gap: 10, marginTop: 14 }}>
              {preview.vehicles.map((v) => {
                const checked = selected.has(v.temp_id);
                const parts: string[] = [];
                if (v.mileage !== null && v.mileage !== undefined) parts.push(`${v.mileage.toLocaleString()} mi`);
                if (v.hours !== null && v.hours !== undefined) parts.push(`${v.hours} hrs`);
                parts.push(`${v.service_count} record${plural(v.service_count)}`);
                return (
                  <Pressable
                    key={v.temp_id}
                    style={({ pressed }) => [styles.vehicleCard, { opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => toggleVehicle(v.temp_id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={vehicleTitle(v)}
                  >
                    <Ionicons
                      name={checked ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={checked ? Colors.accent : Colors.textTertiary}
                    />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.vehicleTitle} numberOfLines={1}>{vehicleTitle(v)}</Text>
                      <Text style={styles.vehicleMeta}>{parts.join(" · ")}</Text>
                      {(v.flags?.duplicate_existing || v.flags?.vin_invalid || v.flags?.merged_conflict) && (
                        <View style={styles.pillRow}>
                          {v.flags?.duplicate_existing ? (
                            <View style={[styles.pill, { backgroundColor: Colors.dueSoonMuted }]}>
                              <Text style={[styles.pillText, { color: Colors.dueSoon }]}>Already in your garage</Text>
                            </View>
                          ) : null}
                          {v.flags?.vin_invalid ? (
                            <View style={[styles.pill, { backgroundColor: Colors.overdueMuted }]}>
                              <Text style={[styles.pillText, { color: Colors.overdue }]}>Check VIN later</Text>
                            </View>
                          ) : null}
                          {v.flags?.merged_conflict ? (
                            <View style={[styles.pill, { backgroundColor: Colors.blueMuted }]}>
                              <Text style={[styles.pillText, { color: Colors.blue }]}>Merged from duplicate rows</Text>
                            </View>
                          ) : null}
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {(preview.skipped.length > 0 || preview.unmatched_service.length > 0 || preview.ignored.length > 0) && (
              <View style={styles.disclosureCard}>
                <Text style={styles.disclosureTitle}>What we couldn&apos;t read</Text>
                {preview.skipped.slice(0, MAX_DISCLOSURE_ROWS).map((s, i) => (
                  <Text key={`s${i}`} style={styles.disclosureRow}>
                    {s.count} row{plural(s.count)} skipped — {s.reason}
                  </Text>
                ))}
                {preview.skipped.length > MAX_DISCLOSURE_ROWS ? (
                  <Text style={styles.disclosureRow}>+{preview.skipped.length - MAX_DISCLOSURE_ROWS} more</Text>
                ) : null}
                {preview.unmatched_service.slice(0, MAX_DISCLOSURE_ROWS).map((u, i) => (
                  <Text key={`u${i}`} style={styles.disclosureRow}>
                    {u.count} service record{plural(u.count)} didn&apos;t match a vehicle ({u.identity})
                  </Text>
                ))}
                {preview.unmatched_service.length > MAX_DISCLOSURE_ROWS ? (
                  <Text style={styles.disclosureRow}>+{preview.unmatched_service.length - MAX_DISCLOSURE_ROWS} more</Text>
                ) : null}
                {preview.ignored.slice(0, MAX_DISCLOSURE_ROWS).map((g, i) => (
                  <Text key={`g${i}`} style={styles.disclosureRow}>
                    {g.sheet ? `${g.file} — ${g.sheet}: ${g.reason}` : `${g.file}: ${g.reason}`}
                  </Text>
                ))}
                {preview.ignored.length > MAX_DISCLOSURE_ROWS ? (
                  <Text style={styles.disclosureRow}>+{preview.ignored.length - MAX_DISCLOSURE_ROWS} more</Text>
                ) : null}
              </View>
            )}
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <PaidActionCTA
              label={`Add ${selected.size} vehicle${plural(selected.size)}`}
              disabled={commitDisabled}
              onPress={handleCommitPress}
            />
            <Pressable
              style={({ pressed }) => [styles.tertiary, { opacity: pressed ? 0.7 : 1 }]}
              onPress={resetAll}
              accessibilityRole="button"
              accessibilityLabel="Start over"
            >
              <Text style={styles.tertiaryText}>Start over</Text>
            </Pressable>
          </View>
        </>
      )}

      {phase === "committing" && (
        <View style={[styles.centered, { paddingBottom: insets.bottom + 24 }]}>
          {commitFailure === null ? (
            <>
              <PulsingTile icon="document-text-outline" />
              <Text style={styles.statusTitle}>Adding your fleet…</Text>
            </>
          ) : commitFailure === "sync" ? (
            <>
              <Text style={styles.statusTitle}>Something got out of sync</Text>
              <Text style={styles.statusSub}>
                Start the import again from your files — nothing extra was added.
              </Text>
              <View style={styles.gateCtaWrap}>
                <PaidActionCTA label="Start over" onPress={resetAll} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.statusTitle}>Couldn&apos;t confirm your import</Text>
              <Text style={styles.statusSub}>
                Try again — if it already went through, we&apos;ll pick up the result, not add duplicates.
              </Text>
              <View style={styles.gateCtaWrap}>
                <PaidActionCTA label="Try again" onPress={() => { void runCommit(requestId, filteredPayload); }} />
              </View>
            </>
          )}
        </View>
      )}

      {phase === "generating" && (
        <View style={[styles.centered, { paddingBottom: insets.bottom + 24 }]}>
          <PulsingTile icon="construct-outline" />
          <Text style={styles.statusTitle}>Building maintenance schedules — {genIndex} of {genTotal}</Text>
          <Text style={styles.statusSub}>{genLabel}</Text>
        </View>
      )}

      {phase === "done" && (
        <View style={[styles.centered, { paddingBottom: insets.bottom + 24 }]}>
          {(() => {
            if (undoStatus === "removing") {
              return (
                <>
                  <PulsingTile icon="trash-outline" />
                  <Text style={styles.statusTitle}>Removing your import…</Text>
                </>
              );
            }
            if (undoStatus === "removed") {
              return (
                <>
                  <DoneCheck />
                  <Text style={styles.doneTitle}>Import removed</Text>
                  <Text style={styles.statusSub}>
                    {committedCount} vehicle{plural(committedCount)} and{" "}
                    {committedCount === 1 ? "its" : "their"} service records are gone.
                  </Text>
                  <View style={styles.gateCtaWrap}>
                    <PaidActionCTA
                      label="Done"
                      onPress={() => {
                        router.dismissTo("/(tabs)/vehicles");
                      }}
                    />
                  </View>
                </>
              );
            }
            if (undoStatus === "failed") {
              return (
                <>
                  <Text style={styles.statusTitle}>Couldn&apos;t finish removing your import</Text>
                  <Text style={styles.statusSub}>
                    Try again to complete it — nothing will be added back.
                  </Text>
                  <View style={styles.gateCtaWrap}>
                    <PaidActionCTA label="Try again" onPress={runUndoRemoval} />
                  </View>
                </>
              );
            }
            return (
              <>
              <DoneCheck />
              <Text style={styles.doneTitle}>
                {committedCount} vehicle{plural(committedCount)} added
              </Text>
              <Text style={styles.statusSub}>
                {failedScheduleCount === 0
                  ? `${commitResult?.log_count ?? 0} service record${plural(commitResult?.log_count ?? 0)} attached. Maintenance schedules are ready.`
                  : `${commitResult?.log_count ?? 0} service record${plural(commitResult?.log_count ?? 0)} attached. ${okScheduleCount} of ${okScheduleCount + failedScheduleCount} schedules ready.${retriedSchedules ? " The rest will build from each vehicle's screen." : ""}`}
              </Text>

              {failedScheduleCount > 0 && !retriedSchedules ? (
                <View style={styles.gateCtaWrap}>
                  <PaidActionCTA label="Finish building schedules" variant="secondary" onPress={() => { void retrySchedules(); }} />
                </View>
              ) : null}

              <View style={styles.gateCtaWrap}>
                <PaidActionCTA
                  label="View my vehicles"
                  onPress={() => {
                    // One deterministic action: pop this screen and land on the tab.
                    router.dismissTo("/(tabs)/vehicles");
                  }}
                />
              </View>

              {undoConfirm && undoStatus === "idle" ? (
                <View style={styles.undoWrap}>
                  <Text style={styles.undoPrompt}>
                    Remove all {committedCount} imported vehicles and their records?
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.destructive, { opacity: pressed ? 0.85 : 1 }]}
                    onPress={confirmUndoRemoval}
                    accessibilityRole="button"
                    accessibilityLabel="Yes, remove them"
                  >
                    <Text style={styles.destructiveText}>Yes, remove them</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.tertiary, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => setUndoConfirm(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Keep them"
                  >
                    <Text style={styles.tertiaryText}>Keep them</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.tertiary, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setUndoConfirm(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Undo import"
                >
                  <Text style={styles.tertiaryText}>Undo import</Text>
                </Pressable>
              )}
              </>
            );
          })()}
        </View>
      )}

      {paywallModal}
    </View>
  );
}

function DoneCheck() {
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 12, stiffness: 160 });
    return () => { cancelAnimation(scale); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name="checkmark-circle" size={56} color={Colors.good} />
    </Animated.View>
  );
}

function PulsingTile({ icon }: { icon: React.ComponentProps<typeof Ionicons>["name"] }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);
  const halo = useAnimatedStyle(() => ({
    opacity: 0.05 + pulse.value * 0.10,
    transform: [{ scale: 1 + pulse.value * 0.35 }],
  }));
  const tile = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.09 }],
  }));
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseHalo, halo]} />
      <Animated.View style={[styles.heroTile, tile]}>
        <Ionicons name={icon} size={40} color={Colors.accent} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, gap: 14 },

  heroTile: {
    width: 88,
    height: 88,
    borderRadius: 20,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseWrap: { alignItems: "center", justifyContent: "center" },
  pulseHalo: { position: "absolute", width: 104, height: 104,
               borderRadius: 52, backgroundColor: Colors.accent },
  gateTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center" },
  gateBody: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 21 },
  gateCtaWrap: { alignSelf: "stretch", marginTop: 6 },

  pickScroll: { paddingHorizontal: 20, paddingTop: 32, alignItems: "center", gap: 12 },
  pickTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center", marginTop: 6 },
  pickBody: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 21 },
  pickHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", lineHeight: 19 },
  pickCtaWrap: { alignSelf: "stretch", marginTop: 8 },

  chipList: { alignSelf: "stretch", gap: 8, marginTop: 4 },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 44,
    backgroundColor: Colors.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fileChipBad: { borderColor: Colors.overdue, backgroundColor: Colors.overdueMuted },
  fileChipName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  fileChipSize: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  inlineError: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue, textAlign: "center", lineHeight: 19 },

  summary: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, marginTop: 18, lineHeight: 29 },
  capBanner: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  capTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 21 },
  capSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 4, lineHeight: 19 },

  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    minHeight: 44,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  vehicleMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontFamily: "Inter_500Medium" },

  disclosureCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  disclosureTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 2 },
  disclosureRow: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 19 },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 6,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tertiary: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  tertiaryText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },

  statusTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center", lineHeight: 27 },
  statusSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  doneTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center" },

  undoWrap: { alignSelf: "stretch", gap: 10, marginTop: 4 },
  undoPrompt: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  destructive: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.overdue,
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.white },

  // scene
  sceneRoot: { flex: 1, gap: 28, paddingTop: 40 },
  sceneHeaderSection: { paddingHorizontal: 20, gap: 14, alignItems: "center" },
  sceneTitle: { fontSize: 21, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, lineHeight: 27, textAlign: "center" },
  sceneFailSubtitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 27, textAlign: "center" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.card, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", position: "relative" },
  docGlow: { position: "absolute", width: 140, height: 140, borderRadius: 70 },
  halo: { position: "absolute", width: 200, height: 200, borderRadius: 100 },
  orbit: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  orbitDot: { position: "absolute", width: 5, height: 5, borderRadius: 2.5, opacity: 0.5 },
  doc: { width: 88, height: 88, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  particle: { position: "absolute", width: 6, height: 6, borderRadius: 3 },
  statusCaption: { position: "absolute", top: 0, left: 20, right: 20, fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 27, minHeight: 27, textAlign: "center" },
  readyBadge: { position: "absolute", bottom: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.card, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  readyText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  errorButtons: { paddingHorizontal: 20, gap: 12, marginTop: 20 },
  sceneCta: { borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", backgroundColor: Colors.accent },
  sceneCtaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  sceneSkip: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  sceneSkipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
