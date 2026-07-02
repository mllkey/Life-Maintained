import React, { useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  runOnJS,
  interpolate,
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

function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export default function BuildingHealthPlanScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    familyMemberId: string | string[];
    memberName: string | string[];
    memberType: string | string[];
    petType: string | string[];
    relationship: string | string[];
  }>();
  const queryClient = useQueryClient();
  const { setOnboardingCompleted, user } = useAuth();

  const familyMemberId = oneParam(params.familyMemberId);
  const memberName = oneParam(params.memberName) || "your loved one";
  const memberType = oneParam(params.memberType) || "person";
  const petType = oneParam(params.petType);
  const relationship = oneParam(params.relationship);
  const isPet = memberType === "pet";

  const [typedName, setTypedName] = React.useState("");
  const [subtitleText, setSubtitleText] = React.useState(isPet ? "Reading pet care guidance" : "Reading preventive-care guidelines");
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [continueError, setContinueError] = React.useState<string | null>(null);

  useEffect(() => {
    capture("onboarding_step_viewed", { step: "building_health_plan" });
  }, []);

  const hasAttempted = useRef(false);
  const hasFinalized = useRef(false);
  const sceneStart = useRef(Date.now());
  const scheduleDone = useRef(false);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleGlow = useSharedValue(0);
  const chip1Opacity = useSharedValue(0);
  const chip1Y = useSharedValue(12);
  const chip2Opacity = useSharedValue(0);
  const chip2Y = useSharedValue(12);
  const chip3Opacity = useSharedValue(0);
  const chip3Y = useSharedValue(12);
  const heartShimmer = useSharedValue(0);
  const pinBounce = useSharedValue(0);
  const calendarPulse = useSharedValue(0);

  const docScale = useSharedValue(0);
  const docOpacity = useSharedValue(0);
  // Continuous "assembling core" — runs the whole scene so the center is never static.
  const haloPulse = useSharedValue(0);
  const orbitSpin = useSharedValue(0);
  const docGlow = useSharedValue(0);
  const readyOpacity = useSharedValue(0);

  // Top-level shared values for particles. Mirrors the building-plan.tsx
  // hook-stability pattern so every useSharedValue has a stable position.
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
  const particleProgress = [
    particle0, particle1, particle2, particle3,
    particle4, particle5, particle6, particle7,
    particle8, particle9, particle10, particle11,
  ];

  const generateSchedule = useCallback(async () => {
    if (!familyMemberId) {
      setFailed(true);
      return;
    }
    try {
      const { error } = await supabase.functions.invoke("generate-health-schedule", {
        body: { family_member_id: familyMemberId },
      });

      if (error) {
        const httpStatus = (error as { context?: { status?: number } })?.context?.status;
        if (httpStatus !== 409) {
          if (__DEV__) console.warn("[onboarding] health schedule error:", error.message);
          setFailed(true);
          return;
        }
      }

      scheduleDone.current = true;
      queryClient.invalidateQueries({ queryKey: ["family_members"] });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: ["health_appointments", user.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["member_appointments", familyMemberId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      const elapsed = Date.now() - sceneStart.current;
      const remaining = Math.max(MIN_SCENE_MS - elapsed, 0);
      setTimeout(finalizeReveal, remaining);
    } catch (e) {
      if (__DEV__) console.error("[onboarding] health generation failed:", e);
      setFailed(true);
    }
  }, [familyMemberId, queryClient, user?.id]);

  const finalizeReveal = useCallback(() => {
    if (failed) return;
    if (hasFinalized.current) return;
    hasFinalized.current = true;
    setReady(true);
    setSubtitleText("Care reminders are ready.");
    docScale.value = withSpring(1.15, { damping: 10, stiffness: 140 }, () => {
      docScale.value = withSpring(1, { damping: 14, stiffness: 180 });
    });
    docGlow.value = withTiming(1, { duration: 400 });
    readyOpacity.value = withTiming(1, { duration: 300 });
    runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
  }, [failed, docScale, docGlow, readyOpacity]);

  useEffect(() => {
    if (!memberName) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypedName(memberName.slice(0, i));
      if (i >= memberName.length) {
        clearInterval(interval);
        titleGlow.value = withSequence(
          withTiming(1, { duration: 280, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: 400 })
        );
      }
    }, Math.max(40, Math.min(80, 1200 / memberName.length)));
    return () => clearInterval(interval);
  }, [memberName, titleGlow]);

  useEffect(() => {
    if (hasAttempted.current) return;
    hasAttempted.current = true;
    sceneStart.current = Date.now();

    const subtitleTimers: ReturnType<typeof setTimeout>[] = [];
    if (isPet) {
      const petLabel = petType ? petType.toLowerCase() : "pet";
      subtitleTimers.push(setTimeout(() => setSubtitleText(`Pulling ${petLabel} care intervals`), 1400));
      subtitleTimers.push(setTimeout(() => setSubtitleText("Checking vaccination cadence"), 1700));
      subtitleTimers.push(setTimeout(() => setSubtitleText(`Building ${memberName}’s reminders`), 3600));
    } else {
      const relLabel = relationship ? relationship.toLowerCase() : "this person";
      subtitleTimers.push(setTimeout(() => setSubtitleText(`Pulling preventive care for ${relLabel}`), 1400));
      subtitleTimers.push(setTimeout(() => setSubtitleText("Checking annual visit intervals"), 1700));
      subtitleTimers.push(setTimeout(() => setSubtitleText(`Building ${memberName}’s reminders`), 3600));
    }
    subtitleTimers.push(setTimeout(() => {
      if (!scheduleDone.current && !hasFinalized.current) {
        setSubtitleText("Cross-checking the schedule — a few more seconds.");
      }
    }, 8000));

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    heartShimmer.value = withDelay(1400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));

    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    pinBounce.value = withDelay(1700, withSequence(
      withTiming(-8, { duration: 200 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    ));

    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    calendarPulse.value = withDelay(2000, withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true));

    particleProgress.forEach((p, i) => {
      p.value = withDelay(
        3600 + i * 100,
        withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) })
      );
    });

    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));

    void generateSchedule();

    // Continuous core motion (independent of beats + generation wait) so nothing reads as frozen.
    haloPulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
    orbitSpin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1);

    maxWaitTimer.current = setTimeout(() => {
      if (!scheduleDone.current && !failed) {
        finalizeReveal();
      }
    }, MAX_WAIT_MS);

    return () => {
      if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
      subtitleTimers.forEach(clearTimeout);
    };
  }, []);

  async function handleRetry() {
    setFailed(false);
    setContinueError(null);
    setReady(false);
    setTypedName("");
    setSubtitleText(isPet ? "Reading pet care guidance" : "Reading preventive-care guidelines");
    scheduleDone.current = false;
    hasFinalized.current = false;
    hasAttempted.current = false;
    sceneStart.current = Date.now();

    titleGlow.value = 0;
    chip1Opacity.value = 0; chip1Y.value = 12;
    chip2Opacity.value = 0; chip2Y.value = 12;
    chip3Opacity.value = 0; chip3Y.value = 12;
    calendarPulse.value = 0;
    pinBounce.value = 0;
    heartShimmer.value = 0;
    docScale.value = 0;
    docOpacity.value = 0;
    docGlow.value = 0;
    readyOpacity.value = 0;
    particleProgress.forEach((p) => { p.value = 0; });
    haloPulse.value = 0;
    orbitSpin.value = 0;
    haloPulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
    orbitSpin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1);

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    heartShimmer.value = withDelay(1400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));
    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    pinBounce.value = withDelay(1700, withSequence(
      withTiming(-8, { duration: 200 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    ));
    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    calendarPulse.value = withDelay(2000, withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true));
    particleProgress.forEach((p, i) => {
      p.value = withDelay(3600 + i * 100, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
    });
    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));

    hasAttempted.current = true;

    const retrySubtitleTimers: ReturnType<typeof setTimeout>[] = [];
    if (isPet) {
      const petLabel = petType ? petType.toLowerCase() : "pet";
      retrySubtitleTimers.push(setTimeout(() => setSubtitleText(`Pulling ${petLabel} care intervals`), 1400));
      retrySubtitleTimers.push(setTimeout(() => setSubtitleText("Checking vaccination cadence"), 1700));
      retrySubtitleTimers.push(setTimeout(() => setSubtitleText(`Building ${memberName}’s reminders`), 3600));
    } else {
      const relLabel = relationship ? relationship.toLowerCase() : "this person";
      retrySubtitleTimers.push(setTimeout(() => setSubtitleText(`Pulling preventive care for ${relLabel}`), 1400));
      retrySubtitleTimers.push(setTimeout(() => setSubtitleText("Checking annual visit intervals"), 1700));
      retrySubtitleTimers.push(setTimeout(() => setSubtitleText(`Building ${memberName}’s reminders`), 3600));
    }
    retrySubtitleTimers.push(setTimeout(() => {
      if (!scheduleDone.current && !hasFinalized.current) {
        setSubtitleText("Cross-checking the schedule — a few more seconds.");
      }
    }, 8000));

    try {
      await generateSchedule();
    } finally {
      retrySubtitleTimers.forEach(clearTimeout);
    }
  }

  async function completeOnboarding(): Promise<boolean> {
    setContinueError(null);
    if (user) {
      const { error } = await supabase.from("profiles").upsert(
        { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) {
        setContinueError("Couldn’t save your progress. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return false;
      }
      await AsyncStorage.setItem(getOnboardingKey(user.id), "true");
    }
    setOnboardingCompleted(true);
    return true;
  }

  async function handleOpenDashboard() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace({
      pathname: "/(onboarding)/plan-reveal",
      params: { vertical: "health", assetId: familyMemberId, assetName: memberName },
    });
  }

  async function handleContinueAnyway() {
    const done = await completeOnboarding();
    if (!done) return;
    router.replace("/(tabs)");
  }

  const titleGlowStyle = useAnimatedStyle(() => ({
    opacity: titleGlow.value,
    transform: [{ scale: interpolate(titleGlow.value, [0, 1], [0.95, 1]) }],
  }));

  const chip1Style = useAnimatedStyle(() => ({
    opacity: chip1Opacity.value,
    transform: [{ translateY: chip1Y.value }],
  }));
  const chip2Style = useAnimatedStyle(() => ({
    opacity: chip2Opacity.value,
    transform: [{ translateY: chip2Y.value }],
  }));
  const chip3Style = useAnimatedStyle(() => ({
    opacity: chip3Opacity.value,
    transform: [{ translateY: chip3Y.value }],
  }));

  const heartShimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(heartShimmer.value, [0, 0.5, 1], [0.6, 1, 0.6]),
    transform: [{ scale: interpolate(heartShimmer.value, [0, 0.5, 1], [1, 1.1, 1]) }],
  }));
  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pinBounce.value }],
  }));
  const calendarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(calendarPulse.value, [0, 0.5, 1], [0.7, 1, 0.7]),
  }));

  const docStyle = useAnimatedStyle(() => ({
    opacity: docOpacity.value,
    transform: [{ scale: docScale.value }],
  }));

  const docGlowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(docGlow.value, [0, 1], [0, 0.35]),
    transform: [{ scale: interpolate(docGlow.value, [0, 1], [0.8, 1.4]) }],
  }));

  const readyStyle = useAnimatedStyle(() => ({ opacity: readyOpacity.value }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(haloPulse.value, [0, 1], [0.10, 0.26]),
    transform: [{ scale: interpolate(haloPulse.value, [0, 1], [0.92, 1.12]) }],
  }));
  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${orbitSpin.value * 360}deg` }],
  }));

  const revealSubtitle = isPet
    ? `Built for ${memberName}’s care.`
    : `Built for ${memberName}.`;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={[styles.progressBar, { marginHorizontal: 20 }]}>
        <View style={[styles.progressFill, { width: "85%" }]} />
      </View>

      <View style={styles.headerSection}>
        <View style={styles.titleWrap}>
          <Animated.View style={[styles.titleGlow, titleGlowStyle]} />
          <Text style={styles.title} numberOfLines={2}>
            {failed ? "Couldn’t build the reminders" : ready ? "Care reminders are ready" : (typedName || " ")}
          </Text>
        </View>
        <Text style={styles.subtitle}>
          {failed
            ? `${memberName} is saved. Retry now, or build reminders later from Health.`
            : ready
              ? revealSubtitle
              : subtitleText}
        </Text>
      </View>

      {!failed && !ready && (
        <View style={styles.chipsRow}>
          <Animated.View style={[styles.chip, chip1Style]}>
            <Animated.View style={heartShimmerStyle}>
              <Ionicons name="heart" size={15} color={Colors.health} />
            </Animated.View>
            <Text style={styles.chipText}>{isPet ? "Pet care" : "Preventive care"}</Text>
          </Animated.View>

          <Animated.View style={[styles.chip, chip2Style]}>
            <Animated.View style={pinStyle}>
              <MaterialCommunityIcons name={isPet ? "paw" : "account-heart"} size={15} color={Colors.health} />
            </Animated.View>
            <Text style={styles.chipText}>{isPet ? petType || "Pet" : relationship || "Person"}</Text>
          </Animated.View>

          <Animated.View style={[styles.chip, chip3Style]}>
            <Animated.View style={calendarStyle}>
              <Ionicons name="calendar" size={15} color={Colors.health} />
            </Animated.View>
            <Text style={styles.chipText}>Appointments + refills</Text>
          </Animated.View>
        </View>
      )}

      {!failed && (
        <View style={styles.stage}>
          <Animated.View style={[styles.halo, haloStyle]} />
          <Animated.View style={[styles.orbit, orbitStyle]}>
            {ORBIT_DOTS.map((d, i) => (
              <View key={i} style={[styles.orbitDot, { transform: [{ translateX: d.x }, { translateY: d.y }] }]} />
            ))}
          </Animated.View>
          <Animated.View style={[styles.docGlow, docGlowStyle]} />

          {particleProgress.map((p, i) => (
            <Particle key={i} progress={p} index={i} total={PARTICLE_COUNT} />
          ))}

          <Animated.View style={[styles.doc, docStyle]}>
            <Ionicons name="heart" size={40} color={Colors.health} />
          </Animated.View>

          {ready && (
            <Animated.View style={[styles.readyBadge, readyStyle]}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.good} />
              <Text style={styles.readyText}>Ready</Text>
            </Animated.View>
          )}
        </View>
      )}

      {!failed && ready && (
        <View style={styles.actions}>
          {continueError ? (
            <Text style={styles.inlineError}>{continueError}</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
            onPress={handleOpenDashboard}
          >
            <Text style={styles.ctaText}>View my plan</Text>
          </Pressable>
        </View>
      )}

      {failed && (
        <View style={styles.errorButtons}>
          {continueError ? (
            <Text style={styles.inlineError}>{continueError}</Text>
          ) : null}
          <Pressable style={styles.cta} onPress={handleRetry}>
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

const Particle = React.memo(function Particle({ progress, index, total }: { progress: SharedValue<number>; index: number; total: number }) {
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

  return <Animated.View style={[styles.particle, pStyle]} />;
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, gap: 28 },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.health },
  headerSection: { paddingHorizontal: 20, gap: 8 },
  titleWrap: { position: "relative" },
  titleGlow: {
    position: "absolute",
    left: -12,
    right: -12,
    top: -8,
    bottom: -8,
    backgroundColor: Colors.health,
    borderRadius: 20,
    opacity: 0,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 34 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: Colors.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  docGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.health,
  },
  halo: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Colors.health,
  },
  orbit: {
    position: "absolute",
    width: 0,
    height: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  orbitDot: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.health,
    opacity: 0.5,
  },
  doc: {
    width: 88,
    height: 88,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  particle: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.health,
  },
  readyBadge: {
    position: "absolute",
    bottom: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  readyText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  actions: { paddingHorizontal: 20, gap: 12 },
  errorButtons: { paddingHorizontal: 20, gap: 12, marginTop: 20 },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.health },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  inlineError: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue, lineHeight: 19, textAlign: "center" },
});
