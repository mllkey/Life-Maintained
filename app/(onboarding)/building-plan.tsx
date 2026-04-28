import React, { useEffect, useRef, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, getOnboardingKey } from "@/context/AuthContext";
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
const POST_READY_HOLD_MS = 700;
const MAX_WAIT_MS = 25000;
const PARTICLE_COUNT = 12;

function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export default function BuildingPlanScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    vehicleId: string | string[];
    vehicleName: string | string[];
    make: string | string[];
    model: string | string[];
    year: string | string[];
    currentMileage: string | string[];
    currentHours: string | string[];
    trackingMode: string | string[];
    fuelType: string | string[];
    vehicleCategory: string | string[];
  }>();
  const queryClient = useQueryClient();
  const { setOnboardingCompleted, user } = useAuth();

  const vehicleId = oneParam(params.vehicleId);
  const vehicleName = oneParam(params.vehicleName);
  const make = oneParam(params.make);
  const model = oneParam(params.model);
  const yearStr = oneParam(params.year);
  const currentMileageStr = oneParam(params.currentMileage);
  const currentHoursStr = oneParam(params.currentHours);
  const trackingMode = oneParam(params.trackingMode);
  const fuelType = oneParam(params.fuelType) || "gas";
  const vehicleCategory = oneParam(params.vehicleCategory);

  const displayName = (vehicleName || `${yearStr} ${make} ${model}`).trim();

  const [typedName, setTypedName] = React.useState("");
  const [subtitleText, setSubtitleText] = React.useState("Reading the factory service manual");  // beat-driven swaps below override at 1.4/1.7/3.6/8.0s
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const hasAttempted = useRef(false);
  const hasFinalized = useRef(false);
  const sceneStart = useRef(Date.now());
  const scheduleDone = useRef(false);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared values
  const titleGlow = useSharedValue(0);
  const chip1Opacity = useSharedValue(0);
  const chip1Y = useSharedValue(12);
  const chip2Opacity = useSharedValue(0);
  const chip2Y = useSharedValue(12);
  const chip3Opacity = useSharedValue(0);
  const chip3Y = useSharedValue(12);
  const gearRotate = useSharedValue(0);
  const pinBounce = useSharedValue(0);
  const bookShimmer = useSharedValue(0);

  const docScale = useSharedValue(0);
  const docOpacity = useSharedValue(0);
  const docGlow = useSharedValue(0);
  const readyOpacity = useSharedValue(0);

  const particleProgress = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, () => useSharedValue(0)),
    []
  );

  const generateSchedule = useCallback(async () => {
    if (!vehicleId) {
      setFailed(true);
      return;
    }
    try {
      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
        body: {
          vehicle_id: vehicleId,
          make,
          model,
          year: parseInt(yearStr, 10) || new Date().getFullYear(),
          current_mileage: parseInt(currentMileageStr, 10) || 0,
          current_hours: parseFloat(currentHoursStr) || 0,
          tracking_mode: trackingMode,
          vehicle_type: fuelType,
          vehicle_category: vehicleCategory,
          is_awd: false,
        },
      });

      if (error) {
        const httpStatus = (error as { context?: { status?: number } })?.context?.status;
        if (httpStatus !== 409) {
          if (__DEV__) console.warn("[onboarding] schedule generation error:", error.message);
          setFailed(true);
          return;
        }
      }

      scheduleDone.current = true;
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      const elapsed = Date.now() - sceneStart.current;
      const remaining = Math.max(MIN_SCENE_MS - elapsed, 0);
      setTimeout(finalizeReveal, remaining);
    } catch (e) {
      if (__DEV__) console.error("[onboarding] generation failed:", e);
      setFailed(true);
    }
  }, [vehicleId, make, model, yearStr, currentMileageStr, currentHoursStr, trackingMode, fuelType, vehicleCategory, queryClient]);

  const finalizeReveal = useCallback(() => {
    if (failed) return;
    if (hasFinalized.current) return;
    hasFinalized.current = true;
    setReady(true);
    setSubtitleText("Your plan is ready.");
    docScale.value = withSpring(1.15, { damping: 10, stiffness: 140 }, () => {
      docScale.value = withSpring(1, { damping: 14, stiffness: 180 });
    });
    docGlow.value = withTiming(1, { duration: 400 });
    readyOpacity.value = withTiming(1, { duration: 300 });
    runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);

    setTimeout(() => {
      router.replace({
        pathname: "/(onboarding)/value-reveal",
        params: {
          vehicleId,
          vehicleName: displayName,
        },
      });
    }, POST_READY_HOLD_MS);
  }, [failed, vehicleId, displayName, docScale, docGlow, readyOpacity]);

  // Typewriter
  useEffect(() => {
    if (!displayName) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypedName(displayName.slice(0, i));
      if (i >= displayName.length) {
        clearInterval(interval);
        titleGlow.value = withSequence(
          withTiming(1, { duration: 280, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: 400 })
        );
      }
    }, Math.max(40, Math.min(80, 1200 / displayName.length)));
    return () => clearInterval(interval);
  }, [displayName, titleGlow]);

  // Scene orchestration
  useEffect(() => {
    if (hasAttempted.current) return;
    hasAttempted.current = true;
    sceneStart.current = Date.now();

    // Beat-driven subtitle (matches chip stagger + particle convergence + slow-state warning)
    const subtitleTimers: ReturnType<typeof setTimeout>[] = [];
    subtitleTimers.push(setTimeout(() => setSubtitleText(`Reading ${displayName}’s service manual`), 1400));
    subtitleTimers.push(setTimeout(() => setSubtitleText("Checking your local climate"), 1700));
    subtitleTimers.push(setTimeout(() => setSubtitleText("Building your personalized plan"), 3600));
    subtitleTimers.push(setTimeout(() => {
      if (!scheduleDone.current && !hasFinalized.current) {
        setSubtitleText("Still working on this — almost there.");
      }
    }, 8000));

    // Stage 2: chips stagger in
    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    bookShimmer.value = withDelay(1400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));

    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    pinBounce.value = withDelay(1700, withSequence(
      withTiming(-8, { duration: 200 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    ));

    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    gearRotate.value = withDelay(2000, withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1));

    // Stage 3: particle convergence starting at 3600ms
    particleProgress.forEach((p, i) => {
      p.value = withDelay(
        3600 + i * 100,
        withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) })
      );
    });

    // Stage 4 pre-emergence: doc scaffolds in lightly at 4.8s so it's ready to catch particles
    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));

    // Kick off edge function
    void generateSchedule();

    // Safety ceiling
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
    setReady(false);
    setTypedName("");
    setSubtitleText("Reading the factory service manual");
    scheduleDone.current = false;
    hasFinalized.current = false;
    hasAttempted.current = false;
    sceneStart.current = Date.now();

    titleGlow.value = 0;
    chip1Opacity.value = 0; chip1Y.value = 12;
    chip2Opacity.value = 0; chip2Y.value = 12;
    chip3Opacity.value = 0; chip3Y.value = 12;
    gearRotate.value = 0;
    pinBounce.value = 0;
    bookShimmer.value = 0;
    docScale.value = 0;
    docOpacity.value = 0;
    docGlow.value = 0;
    readyOpacity.value = 0;
    particleProgress.forEach((p) => { p.value = 0; });

    chip1Opacity.value = withDelay(1400, withTiming(1, { duration: 400 }));
    chip1Y.value = withDelay(1400, withSpring(0, { damping: 14, stiffness: 180 }));
    bookShimmer.value = withDelay(1400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));
    chip2Opacity.value = withDelay(1700, withTiming(1, { duration: 400 }));
    chip2Y.value = withDelay(1700, withSpring(0, { damping: 14, stiffness: 180 }));
    pinBounce.value = withDelay(1700, withSequence(
      withTiming(-8, { duration: 200 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    ));
    chip3Opacity.value = withDelay(2000, withTiming(1, { duration: 400 }));
    chip3Y.value = withDelay(2000, withSpring(0, { damping: 14, stiffness: 180 }));
    gearRotate.value = withDelay(2000, withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1));
    particleProgress.forEach((p, i) => {
      p.value = withDelay(3600 + i * 100, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
    });
    docOpacity.value = withDelay(4800, withTiming(0.6, { duration: 500 }));
    docScale.value = withDelay(4800, withTiming(0.85, { duration: 500 }));

    hasAttempted.current = true;

    // Beat-driven subtitle (mirrors initial useEffect — see above)
    const retrySubtitleTimers: ReturnType<typeof setTimeout>[] = [];
    retrySubtitleTimers.push(setTimeout(() => setSubtitleText(`Reading ${displayName}’s service manual`), 1400));
    retrySubtitleTimers.push(setTimeout(() => setSubtitleText("Checking your local climate"), 1700));
    retrySubtitleTimers.push(setTimeout(() => setSubtitleText("Building your personalized plan"), 3600));
    retrySubtitleTimers.push(setTimeout(() => {
      if (!scheduleDone.current && !hasFinalized.current) {
        setSubtitleText("Still working on this — almost there.");
      }
    }, 8000));

    try {
      await generateSchedule();
    } finally {
      retrySubtitleTimers.forEach(clearTimeout);
    }
  }

  async function handleContinueAnyway() {
    if (user) {
      const { error } = await supabase.from("profiles").upsert(
        { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) {
        Alert.alert("Something went wrong", "Could not save your progress. Please try again.");
        return;
      }
      await AsyncStorage.setItem(getOnboardingKey(user.id), "true");
    }
    setOnboardingCompleted(true);
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

  const bookShimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bookShimmer.value, [0, 0.5, 1], [0.6, 1, 0.6]),
  }));
  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pinBounce.value }],
  }));
  const gearStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${gearRotate.value * 360}deg` }],
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
        <View style={[styles.progressFill, { width: "75%" }]} />
      </View>

      <View style={styles.headerSection}>
        <View style={styles.titleWrap}>
          <Animated.View style={[styles.titleGlow, titleGlowStyle]} />
          <Text style={styles.title} numberOfLines={2}>
            {failed ? "We couldn’t finish that" : (typedName || " ")}
          </Text>
        </View>
        <Text style={styles.subtitle}>
          {failed
            ? "Your vehicle was saved. Try again now, or continue to the app."
            : subtitleText}
        </Text>
      </View>

      {!failed && (
        <View style={styles.chipsRow}>
          <Animated.View style={[styles.chip, chip1Style]}>
            <Animated.View style={bookShimmerStyle}>
              <MaterialCommunityIcons name="book-open-variant" size={15} color={Colors.accent} />
            </Animated.View>
            <Text style={styles.chipText}>Factory manual</Text>
          </Animated.View>

          <Animated.View style={[styles.chip, chip2Style]}>
            <Animated.View style={pinStyle}>
              <Ionicons name="location" size={15} color={Colors.accent} />
            </Animated.View>
            <Text style={styles.chipText}>Local climate</Text>
          </Animated.View>

          <Animated.View style={[styles.chip, chip3Style]}>
            <Animated.View style={gearStyle}>
              <Ionicons name="settings" size={15} color={Colors.accent} />
            </Animated.View>
            <Text style={styles.chipText}>Mileage + wear</Text>
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
            <Ionicons name="document-text" size={40} color={Colors.accent} />
          </Animated.View>

          <Animated.View style={[styles.readyBadge, readyStyle]}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.good} />
            <Text style={styles.readyText}>Ready</Text>
          </Animated.View>
        </View>
      )}

      {failed && (
        <View style={styles.errorButtons}>
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
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.accent },
  headerSection: { paddingHorizontal: 20, gap: 8 },
  titleWrap: { position: "relative" },
  titleGlow: {
    position: "absolute",
    left: -12,
    right: -12,
    top: -8,
    bottom: -8,
    backgroundColor: Colors.accent,
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
    backgroundColor: Colors.accent,
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
    backgroundColor: Colors.accent,
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
  errorButtons: { paddingHorizontal: 20, gap: 12, marginTop: 20 },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#0C111B" },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
