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

function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export default function BuildingPropertyPlanScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    propertyId: string | string[];
    propertyName: string | string[];
    propertyType: string | string[];
    yearBuilt: string | string[];
    squareFootage: string | string[];
    zipCode: string | string[];
  }>();
  const queryClient = useQueryClient();
  const { setOnboardingCompleted, user } = useAuth();

  const propertyId = oneParam(params.propertyId);
  const propertyName = oneParam(params.propertyName) || "home";
  const propertyType = oneParam(params.propertyType);
  const yearBuiltStr = oneParam(params.yearBuilt);
  const squareFootageStr = oneParam(params.squareFootage);
  const zipCode = oneParam(params.zipCode);

  const [typedName, setTypedName] = React.useState("");
  const [subtitleText, setSubtitleText] = React.useState("Reading regional climate data");
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [continueError, setContinueError] = React.useState<string | null>(null);

  useEffect(() => {
    capture("onboarding_step_viewed", { step: "building_property_plan" });
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
  const climateShimmer = useSharedValue(0);
  const pinBounce = useSharedValue(0);
  const wrenchRotate = useSharedValue(0);

  const docScale = useSharedValue(0);
  const docOpacity = useSharedValue(0);
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
    if (!propertyId) {
      setFailed(true);
      return;
    }
    try {
      const yearBuiltNum = yearBuiltStr ? parseInt(yearBuiltStr, 10) : null;
      const sqftNum = squareFootageStr ? parseInt(squareFootageStr, 10) : null;
      const { error } = await supabase.functions.invoke("generate-property-schedule", {
        body: {
          property_id: propertyId,
          property_type: propertyType,
          year_built: yearBuiltNum,
          square_footage: sqftNum,
          zip_code: zipCode || null,
        },
      });

      if (error) {
        const httpStatus = (error as { context?: { status?: number } })?.context?.status;
        if (httpStatus !== 409) {
          if (__DEV__) console.warn("[onboarding] property schedule error:", error.message);
          setFailed(true);
          return;
        }
      }

      scheduleDone.current = true;
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["property_tasks", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      const elapsed = Date.now() - sceneStart.current;
      const remaining = Math.max(MIN_SCENE_MS - elapsed, 0);
      setTimeout(finalizeReveal, remaining);
    } catch (e) {
      if (__DEV__) console.error("[onboarding] property generation failed:", e);
      setFailed(true);
    }
  }, [propertyId, propertyType, yearBuiltStr, squareFootageStr, zipCode, queryClient]);

  const finalizeReveal = useCallback(() => {
    if (failed) return;
    if (hasFinalized.current) return;
    hasFinalized.current = true;
    setReady(true);
    setSubtitleText("Your home plan is ready.");
    docScale.value = withSpring(1.15, { damping: 10, stiffness: 140 }, () => {
      docScale.value = withSpring(1, { damping: 14, stiffness: 180 });
    });
    docGlow.value = withTiming(1, { duration: 400 });
    readyOpacity.value = withTiming(1, { duration: 300 });
    runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
  }, [failed, docScale, docGlow, readyOpacity]);

  useEffect(() => {
    if (!propertyName) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypedName(propertyName.slice(0, i));
      if (i >= propertyName.length) {
        clearInterval(interval);
        titleGlow.value = withSequence(
          withTiming(1, { duration: 280, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: 400 })
        );
      }
    }, Math.max(40, Math.min(80, 1200 / propertyName.length)));
    return () => clearInterval(interval);
  }, [propertyName, titleGlow]);

  useEffect(() => {
    if (hasAttempted.current) return;
    hasAttempted.current = true;
    sceneStart.current = Date.now();

    const subtitleTimers: ReturnType<typeof setTimeout>[] = [];
    subtitleTimers.push(setTimeout(() => setSubtitleText(`Reading ${propertyName}’s climate zone`), 1400));
    subtitleTimers.push(setTimeout(() => setSubtitleText("Checking seasonal maintenance"), 1700));
    subtitleTimers.push(setTimeout(() => setSubtitleText("Building your home checklist"), 3600));
    subtitleTimers.push(setTimeout(() => {
      if (!scheduleDone.current && !hasFinalized.current) {
        setSubtitleText("Cross-checking the schedule — a few more seconds.");
      }
    }, 8000));

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    climateShimmer.value = withDelay(1400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));

    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    pinBounce.value = withDelay(1700, withSequence(
      withTiming(-8, { duration: 200 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    ));

    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    wrenchRotate.value = withDelay(2000, withRepeat(withSequence(
      withTiming(0.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      withTiming(-0.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
    ), -1, true));

    particleProgress.forEach((p, i) => {
      p.value = withDelay(
        3600 + i * 100,
        withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) })
      );
    });

    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));

    void generateSchedule();

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
    setSubtitleText("Reading regional climate data");
    scheduleDone.current = false;
    hasFinalized.current = false;
    hasAttempted.current = false;
    sceneStart.current = Date.now();

    titleGlow.value = 0;
    chip1Opacity.value = 0; chip1Y.value = 12;
    chip2Opacity.value = 0; chip2Y.value = 12;
    chip3Opacity.value = 0; chip3Y.value = 12;
    wrenchRotate.value = 0;
    pinBounce.value = 0;
    climateShimmer.value = 0;
    docScale.value = 0;
    docOpacity.value = 0;
    docGlow.value = 0;
    readyOpacity.value = 0;
    particleProgress.forEach((p) => { p.value = 0; });

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    climateShimmer.value = withDelay(1400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));
    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    pinBounce.value = withDelay(1700, withSequence(
      withTiming(-8, { duration: 200 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    ));
    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    wrenchRotate.value = withDelay(2000, withRepeat(withSequence(
      withTiming(0.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      withTiming(-0.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
    ), -1, true));
    particleProgress.forEach((p, i) => {
      p.value = withDelay(3600 + i * 100, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
    });
    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));

    hasAttempted.current = true;

    const retrySubtitleTimers: ReturnType<typeof setTimeout>[] = [];
    retrySubtitleTimers.push(setTimeout(() => setSubtitleText(`Reading ${propertyName}’s climate zone`), 1400));
    retrySubtitleTimers.push(setTimeout(() => setSubtitleText("Checking seasonal maintenance"), 1700));
    retrySubtitleTimers.push(setTimeout(() => setSubtitleText("Building your home checklist"), 3600));
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
    const done = await completeOnboarding();
    if (!done) return;
    router.replace("/(tabs)");
  }

  async function handleAddVehicleNext() {
    const done = await completeOnboarding();
    if (!done) return;
    router.replace("/(tabs)");
    setTimeout(() => router.push("/add-vehicle"), 400);
    Haptics.selectionAsync();
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

  const climateShimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(climateShimmer.value, [0, 0.5, 1], [0.6, 1, 0.6]),
  }));
  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pinBounce.value }],
  }));
  const wrenchStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wrenchRotate.value}rad` }],
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

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={[styles.progressBar, { marginHorizontal: 20 }]}>
        <View style={[styles.progressFill, { width: "85%" }]} />
      </View>

      <View style={styles.headerSection}>
        <View style={styles.titleWrap}>
          <Animated.View style={[styles.titleGlow, titleGlowStyle]} />
          <Text style={styles.title} numberOfLines={2}>
            {failed ? "Couldn’t build your plan" : ready ? "Your property plan is ready" : (typedName || " ")}
          </Text>
        </View>
        <Text style={styles.subtitle}>
          {failed
            ? "Your home is saved. Retry now, or build it later from the home screen."
            : ready
              ? `Built for ${propertyName}.`
              : subtitleText}
        </Text>
      </View>

      {!failed && !ready && (
        <View style={styles.chipsRow}>
          <Animated.View style={[styles.chip, chip1Style]}>
            <Animated.View style={climateShimmerStyle}>
              <MaterialCommunityIcons name="weather-partly-cloudy" size={15} color={Colors.home} />
            </Animated.View>
            <Text style={styles.chipText}>Climate zone</Text>
          </Animated.View>

          <Animated.View style={[styles.chip, chip2Style]}>
            <Animated.View style={pinStyle}>
              <Ionicons name="location" size={15} color={Colors.home} />
            </Animated.View>
            <Text style={styles.chipText}>ZIP + region</Text>
          </Animated.View>

          <Animated.View style={[styles.chip, chip3Style]}>
            <Animated.View style={wrenchStyle}>
              <MaterialCommunityIcons name="home-variant-outline" size={15} color={Colors.home} />
            </Animated.View>
            <Text style={styles.chipText}>Seasonal upkeep</Text>
          </Animated.View>
        </View>
      )}

      {!failed && (
        <View style={styles.stage}>
          <Animated.View style={[styles.docGlow, docGlowStyle]} />

          {particleProgress.map((p, i) => (
            <Particle key={i} progress={p} index={i} total={PARTICLE_COUNT} />
          ))}

          <Animated.View style={[styles.doc, docStyle]}>
            <MaterialCommunityIcons name="home-variant" size={40} color={Colors.home} />
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

          <Pressable onPress={handleAddVehicleNext} style={styles.secondary}>
            <Ionicons name="car-outline" size={16} color={Colors.vehicle} />
            <Text style={[styles.secondaryText, { color: Colors.vehicle }]}>Add vehicle next</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
            onPress={handleOpenDashboard}
          >
            <Text style={styles.ctaText}>Open my dashboard</Text>
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
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.home },
  headerSection: { paddingHorizontal: 20, gap: 8 },
  titleWrap: { position: "relative" },
  titleGlow: {
    position: "absolute",
    left: -12,
    right: -12,
    top: -8,
    bottom: -8,
    backgroundColor: Colors.home,
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
    backgroundColor: Colors.home,
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
    backgroundColor: Colors.home,
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
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#0C111B" },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.home },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  inlineError: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue, lineHeight: 19, textAlign: "center" },
});
