import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";

export type UndoResult = { ok: true } | { ok: false; message: string };

export type UndoToastRequest = {
  message: string;
  subtitle?: string;
  undoLabel?: string;
  durationMs?: number;
  onUndo: () => Promise<UndoResult>;
};

const DEFAULT_DURATION_MS = 6000;
const RESULT_HOLD_MS = 1600;
const EXIT_MS = 210;
const UNDO_TIMEOUT_MS = 10000;

type Phase = "hidden" | "visible" | "undoing" | "result";

let emitter: ((req: UndoToastRequest | null) => void) | null = null;

export function showUndoToast(req: UndoToastRequest): void {
  emitter?.(req);
}

export function hideUndoToast(): void {
  emitter?.(null);
}

export function UndoToastHost() {
  const insets = useSafeAreaInsets();
  const [req, setReq] = useState<UndoToastRequest | null>(null);
  const [phase, setPhase] = useState<Phase>("hidden");
  const [resultMessage, setResultMessage] = useState("");
  const [resultOk, setResultOk] = useState(true);

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>("hidden");
  const queueRef = useRef<UndoToastRequest[]>([]);
  // Latest-ref indirection: runExit is declared before present and must not
  // close over it directly (callback cycle); the effect below keeps it fresh.
  const presentRef = useRef<(next: UndoToastRequest) => void>(() => {});

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(64);

  const clearTimers = useCallback(() => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    if (exitTimer.current) { clearTimeout(exitTimer.current); exitTimer.current = null; }
  }, []);

  const runExit = useCallback(() => {
    // Mark hidden IMMEDIATELY so any in-flight onUndo resolving during the exit
    // animation fails its guard instead of flashing a result state on a fading view.
    phaseRef.current = "hidden";
    opacity.value = withTiming(0, { duration: 160 });
    translateY.value = withTiming(64, { duration: 200, easing: Easing.in(Easing.cubic) });
    exitTimer.current = setTimeout(() => {
      setPhase("hidden");
      setReq(null);
      setResultMessage("");
      const next = queueRef.current.shift();
      if (next) presentRef.current(next);
    }, EXIT_MS);
  }, [opacity, translateY]);

  const present = useCallback((next: UndoToastRequest) => {
    clearTimers();
    setReq(next);
    setResultMessage("");
    setResultOk(true);
    phaseRef.current = "visible";
    setPhase("visible");
    opacity.value = withTiming(1, { duration: 180 });
    translateY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    try { AccessibilityInfo.announceForAccessibility(next.message); } catch {}
    dismissTimer.current = setTimeout(() => {
      if (phaseRef.current === "visible") runExit();
    }, next.durationMs ?? DEFAULT_DURATION_MS);
  }, [clearTimers, opacity, translateY, runExit]);

  useEffect(() => {
    presentRef.current = present;
  }, [present]);

  useEffect(() => {
    emitter = (next) => {
      if (next) {
        if (phaseRef.current === "hidden" && queueRef.current.length === 0) { present(next); } else { queueRef.current.push(next); }
        return;
      }
      queueRef.current = [];
      // Only tear down when not already exiting. Clearing timers while phaseRef is
      // already "hidden" would kill the pending exitTimer and strand the mounted view.
      if (phaseRef.current !== "hidden") { clearTimers(); runExit(); }
    };
    return () => {
      emitter = null;
      queueRef.current = [];
      clearTimers();
      // An onUndo still in flight must fail its post-await guard rather than write
      // state or arm timers on an unmounted host.
      phaseRef.current = "hidden";
    };
  }, [present, clearTimers, runExit]);

  const onUndoPress = useCallback(async () => {
    const active = req;
    if (!active || phaseRef.current !== "visible") return;
    clearTimers();
    phaseRef.current = "undoing";
    setPhase("undoing");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    let raceTimer: ReturnType<typeof setTimeout> | null = null;
    let result: UndoResult;
    try {
      // Every state must exit in bounded time: supabase-js has no default timeout,
      // so a stalled socket would otherwise leave the spinner up forever.
      result = await Promise.race([
        active.onUndo(),
        new Promise<UndoResult>((resolve) => {
          raceTimer = setTimeout(
            () => resolve({ ok: false, message: "Couldn't undo. Check your connection." }),
            UNDO_TIMEOUT_MS
          );
        }),
      ]);
    } catch {
      result = { ok: false, message: "Couldn't undo. Please try again." };
    } finally {
      if (raceTimer !== null) clearTimeout(raceTimer);
    }
    if (phaseRef.current !== "undoing") return;
    phaseRef.current = "result";
    setPhase("result");
    setResultOk(result.ok);
    setResultMessage(result.ok ? "Undone" : result.message);
    try { AccessibilityInfo.announceForAccessibility(result.ok ? "Undone" : result.message); } catch {}
    if (result.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    dismissTimer.current = setTimeout(() => {
      if (phaseRef.current === "result") runExit();
    }, RESULT_HOLD_MS);
  }, [req, clearTimers, runExit]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (phase === "hidden" || !req) return null;

  const showingResult = phase === "result";
  const title = showingResult ? resultMessage : req.message;
  const subtitle = showingResult ? undefined : req.subtitle;

  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 24 }, animStyle]}>
      <View style={styles.card}>
        <Ionicons
          name={showingResult && !resultOk ? "alert-circle" : "checkmark-circle"}
          size={18}
          color={showingResult && !resultOk ? Colors.overdue : "#34C759"}
        />
        <View style={styles.textCol}>
          <Text style={[styles.title, showingResult && !resultOk ? styles.titleWarn : null]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        {showingResult ? null : (
          <Pressable
            onPress={onUndoPress}
            disabled={phase === "undoing"}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={req.undoLabel ?? "Undo"}
            accessibilityState={{ disabled: phase === "undoing" }}
            style={({ pressed }) => [styles.undoBtn, pressed ? styles.undoBtnPressed : null]}
          >
            {phase === "undoing"
              ? <ActivityIndicator size="small" color={Colors.accent} />
              : <Text style={styles.undoText}>{req.undoLabel ?? "Undo"}</Text>}
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 999 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 8,
    width: "100%", maxWidth: 560, alignSelf: "center",
    backgroundColor: Colors.card, borderColor: Colors.border, borderWidth: 1,
    borderRadius: 20, paddingVertical: 12, paddingHorizontal: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8,
    elevation: 8,
  },
  textCol: { flex: 1, flexShrink: 1 },
  title: { color: Colors.text, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  titleWarn: { color: Colors.overdue },
  subtitle: { color: Colors.textSecondary, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 1 },
  undoBtn: { minWidth: 64, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 10 },
  undoBtnPressed: { opacity: 0.6 },
  undoText: { color: Colors.accent, fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
