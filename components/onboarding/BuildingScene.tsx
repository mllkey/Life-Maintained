import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useAuth, getOnboardingKey } from "@/context/AuthContext";
import { capture } from "@/lib/analytics";
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
  type SharedValue,
} from "react-native-reanimated";

const MIN_SCENE_MS = 6000;
const MAX_WAIT_MS = 25000;
const PARTICLE_COUNT = 12;
const ORBIT_RADIUS = 96;
const ORBIT_DOTS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { x: Math.cos(a) * ORBIT_RADIUS, y: Math.sin(a) * ORBIT_RADIUS };
});

export type IconLib = "ion" | "mci";
export type ChipAnim = "shimmer" | "shimmerScale" | "bounce" | "spin" | "spinSequence" | "pulse";
export type ChipSpec = { lib: IconLib; icon: string; label: string; anim: ChipAnim };
export type GenerateResult = { ok: true } | { ok: false; status?: number; error: unknown };
export type BuildingConfig = {
  tint: string;
  assetId: string;
  assetName: string;
  revealVertical: "vehicle" | "home" | "health";
  analyticsStep: "building_plan" | "building_property_plan" | "building_health_plan";
  docIcon: { lib: IconLib; icon: string };
  chips: [ChipSpec, ChipSpec, ChipSpec];
  copy: { initial: string; beat1: string; beat2: string; beat3: string; slow: string; ready: string };
  failedTitle: string;
  failedSubtitle: string;
  invokeGenerate: () => Promise<GenerateResult>;
  onGenerated: () => void;
};

export function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export function getInvokeStatus(error: unknown): number | undefined {
  return (error as { context?: { status?: number } })?.context?.status;
}

function VerticalIcon({ lib, icon, size, color }: { lib: IconLib; icon: string; size: number; color: string }) {
  if (lib === "mci") return <MaterialCommunityIcons name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={size} color={color} />;
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

function chipIconStyle(kind: ChipAnim, v: number) {
  "worklet";
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

export function BuildingScene({ config }: { config: BuildingConfig }) {
  const insets = useSafeAreaInsets();
  const { setOnboardingCompleted, user } = useAuth();

  const [subtitleText, setSubtitleText] = useState(config.copy.initial);
  const [failed, setFailed] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  const hasAttempted = useRef(false);
  const hasFinalized = useRef(false);
  const sceneStart = useRef(Date.now());
  const scheduleDone = useRef(false);
  const failedRef = useRef(false);
  const retrying = useRef(false);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  useEffect(() => { failedRef.current = failed; }, [failed]);

  const swapSubtitle = useCallback((next: string) => {
    if (failedRef.current) return;
    subtitleOpacity.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.ease) }, (finished) => {
      if (finished) {
        runOnJS(setSubtitleText)(next);
        subtitleOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.ease) });
      }
    });
  }, [subtitleOpacity]);

  const markFailed = useCallback(() => {
    failedRef.current = true;
    subtitleOpacity.value = 1;
    setFailed(true);
  }, [subtitleOpacity]);

  const handleViewPlan = useCallback(() => {
    setContinueError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace({
      pathname: "/(onboarding)/plan-reveal",
      params: { vertical: config.revealVertical, assetId: config.assetId, assetName: config.assetName },
    });
  }, [config.revealVertical, config.assetId, config.assetName]);

  const finalizeReveal = useCallback(() => {
    if (failedRef.current || hasFinalized.current) return;
    hasFinalized.current = true;
    swapSubtitle(config.copy.ready);
    docScale.value = withSpring(1.15, { damping: 10, stiffness: 140 }, () => {
      docScale.value = withSpring(1, { damping: 14, stiffness: 180 });
    });
    docGlow.value = withTiming(1, { duration: 400 });
    readyOpacity.value = withTiming(1, { duration: 300 });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    autoAdvanceTimer.current = setTimeout(() => {
      autoAdvanceTimer.current = null;
      if (failedRef.current) return;
      handleViewPlan();
    }, 1100);
  }, [config.copy.ready, swapSubtitle, docScale, docGlow, readyOpacity, handleViewPlan]);

  const generateSchedule = useCallback(async () => {
    if (!config.assetId) { markFailed(); return; }
    try {
      const result = await config.invokeGenerate();
      if (!result.ok) { markFailed(); return; }
      scheduleDone.current = true;
      config.onGenerated();
      const elapsed = Date.now() - sceneStart.current;
      const remaining = Math.max(MIN_SCENE_MS - elapsed, 0);
      finalizeTimer.current = setTimeout(finalizeReveal, remaining);
    } catch (e) {
      if (__DEV__) console.error("[onboarding] generation failed:", e);
      markFailed();
    }
  }, [config, finalizeReveal, markFailed]);

  const armScene = useCallback(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    titleOpacity.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    titleY.value = withSpring(0, { damping: 17, stiffness: 150 });
    haloPulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
    orbitSpin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1);

    timers.push(setTimeout(() => swapSubtitle(config.copy.beat1), 1400));
    timers.push(setTimeout(() => swapSubtitle(config.copy.beat2), 1900));
    timers.push(setTimeout(() => swapSubtitle(config.copy.beat3), 3600));
    timers.push(setTimeout(() => { if (!scheduleDone.current && !hasFinalized.current) swapSubtitle(config.copy.slow); }, 8000));

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));

    armChip(chipIcon0, config.chips[0].anim, 1400);
    armChip(chipIcon1, config.chips[1].anim, 1700);
    armChip(chipIcon2, config.chips[2].anim, 2000);

    particleProgress.forEach((p, i) => {
      p.value = withDelay(3600 + i * 100, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
    });
    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));
    return timers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, swapSubtitle]);

  useEffect(() => {
    if (hasAttempted.current) return;
    hasAttempted.current = true;
    sceneStart.current = Date.now();
    capture("onboarding_step_viewed", { step: config.analyticsStep });
    sceneTimers.current = armScene();
    void generateSchedule();
    maxWaitTimer.current = setTimeout(() => {
      if (!scheduleDone.current && !failedRef.current) finalizeReveal();
    }, MAX_WAIT_MS);
    return () => {
      if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
      sceneTimers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    if (retrying.current) return;
    retrying.current = true;
    setFailed(false);
    failedRef.current = false;
    setContinueError(null);
    setSubtitleText(config.copy.initial);
    scheduleDone.current = false;
    hasFinalized.current = false;
    sceneStart.current = Date.now();
    sceneTimers.current.forEach(clearTimeout);
    if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
    if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);

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

    sceneTimers.current = armScene();
    maxWaitTimer.current = setTimeout(() => {
      if (!scheduleDone.current && !failedRef.current) finalizeReveal();
    }, MAX_WAIT_MS);
    try {
      await generateSchedule();
    } finally {
      retrying.current = false;
    }
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
  const chipIcon0Style = useAnimatedStyle(() => chipIconStyle(chip0Anim, chipIcon0.value));
  const chipIcon1Style = useAnimatedStyle(() => chipIconStyle(chip1Anim, chipIcon1.value));
  const chipIcon2Style = useAnimatedStyle(() => chipIconStyle(chip2Anim, chipIcon2.value));
  const docStyle = useAnimatedStyle(() => ({ opacity: docOpacity.value, transform: [{ scale: docScale.value }] }));
  const docGlowStyle = useAnimatedStyle(() => ({ opacity: interpolate(docGlow.value, [0, 1], [0, 0.35]), transform: [{ scale: interpolate(docGlow.value, [0, 1], [0.8, 1.4]) }] }));
  const readyStyle = useAnimatedStyle(() => ({ opacity: readyOpacity.value }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: interpolate(haloPulse.value, [0, 1], [0.10, 0.26]), transform: [{ scale: interpolate(haloPulse.value, [0, 1], [0.92, 1.12]) }] }));
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${orbitSpin.value * 360}deg` }] }));

  const chipStyles = [chip1Style, chip2Style, chip3Style];
  const chipIconStyles = [chipIcon0Style, chipIcon1Style, chipIcon2Style];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={[styles.progressBar, { marginHorizontal: 20 }]}>
        <View style={[styles.progressFill, { width: "75%", backgroundColor: config.tint }]} />
      </View>

      <View style={styles.headerSection}>
        <View style={styles.titleWrap}>
          <Animated.Text style={[styles.title, titleStyle]} numberOfLines={2}>
            {failed ? config.failedTitle : config.assetName}
          </Animated.Text>
        </View>
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          {failed ? config.failedSubtitle : subtitleText}
        </Animated.Text>
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
          <Animated.View style={[styles.halo, { backgroundColor: config.tint }, haloStyle]} />
          <Animated.View style={[styles.orbit, orbitStyle]}>
            {ORBIT_DOTS.map((d, i) => (
              <View key={i} style={[styles.orbitDot, { backgroundColor: config.tint, transform: [{ translateX: d.x }, { translateY: d.y }] }]} />
            ))}
          </Animated.View>
          <Animated.View style={[styles.docGlow, { backgroundColor: config.tint }, docGlowStyle]} />

          {particleProgress.map((p, i) => (
            <Particle key={i} progress={p} index={i} total={PARTICLE_COUNT} color={config.tint} />
          ))}

          <Animated.View style={[styles.doc, docStyle]}>
            <VerticalIcon lib={config.docIcon.lib} icon={config.docIcon.icon} size={40} color={config.tint} />
          </Animated.View>

          <Animated.View style={[styles.readyBadge, readyStyle]}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.good} />
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
  container: { flex: 1, backgroundColor: Colors.background, gap: 28 },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2 },
  headerSection: { paddingHorizontal: 20, gap: 14, alignItems: "center" },
  titleWrap: { position: "relative" },
  title: { fontSize: 21, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, lineHeight: 27, textAlign: "center" },
  subtitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 27, minHeight: 27, textAlign: "center" },
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
  readyBadge: { position: "absolute", bottom: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.card, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  readyText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  errorButtons: { paddingHorizontal: 20, gap: 12, marginTop: 20 },
  cta: { borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  inlineError: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue, lineHeight: 19, textAlign: "center" },
});
