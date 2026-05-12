import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { primeHaptics } from "@/lib/haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, getOnboardingKey } from "@/context/AuthContext";
import { capture } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

type VerticalId = "vehicle" | "home" | "health";

type VerticalOption = {
  id: VerticalId;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  badge: string | null;
  subtitle: string;
  body: string;
  focusCopy: string;
  color: string;
};

const VERTICALS: VerticalOption[] = [
  {
    id: "vehicle",
    icon: "car-sport-outline",
    title: "Vehicle",
    badge: "Start here",
    subtitle: "Fastest way to see value",
    body: "Add your year, make, model, and current mileage. We’ll build a personalized maintenance plan.",
    focusCopy: "Start with your vehicle. We’ll turn mileage and service intervals into a plan you can actually trust.",
    color: Colors.accent,
  },
  {
    id: "home",
    icon: "home-outline",
    title: "Home",
    badge: null,
    subtitle: "Best for homeowners",
    body: "Add your address and property type. We’ll build a home maintenance plan with seasonal tasks.",
    focusCopy: "Start with your home. Seasonal upkeep, filters, safety checks, and repairs stay on one calm schedule.",
    color: Colors.home,
  },
  {
    id: "health",
    icon: "heart-outline",
    title: "Health",
    badge: null,
    subtitle: "Appointments & preventive care",
    body: "Track appointments, medications, and age-based care suggestions for you and your family.",
    focusCopy: "Start with health. Appointments, refills, annual visits, and reminders stop living in separate places.",
    color: Colors.health,
  },
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function optionFor(id: VerticalId): VerticalOption {
  return VERTICALS.find(option => option.id === id) ?? VERTICALS[0];
}

function useOrbStyle(index: number, id: VerticalId, selected: VerticalId, entryProgress: SharedValue<number>, selectedProgress: SharedValue<number>) {
  return useAnimatedStyle(() => {
    const initialX = index === 0 ? -8 : index === 1 ? 8 : 0;
    const initialY = index === 0 ? -12 : index === 1 ? 14 : 10;
    const orbitX = index === 0 ? -94 : index === 1 ? 94 : 0;
    const orbitY = index === 0 ? -18 : index === 1 ? -18 : 92;
    const isSelected = selected === id;
    const selectedX = 0;
    const selectedY = -22;
    const recedeX = index === 0 ? -118 : index === 1 ? 118 : 0;
    const recedeY = index === 0 ? 118 : index === 1 ? 118 : 138;

    const baseX = initialX + (orbitX - initialX) * entryProgress.value;
    const baseY = initialY + (orbitY - initialY) * entryProgress.value;
    const targetX = isSelected ? selectedX : recedeX;
    const targetY = isSelected ? selectedY : recedeY;
    const scale = isSelected
      ? 1 + 0.15 * selectedProgress.value
      : 1 - 0.24 * selectedProgress.value;
    const opacity = isSelected
      ? 1
      : 1 - 0.36 * selectedProgress.value;

    return {
      opacity: entryProgress.value * opacity,
      transform: [
        { translateX: baseX + (targetX - baseX) * selectedProgress.value },
        { translateY: baseY + (targetY - baseY) * selectedProgress.value },
        { scale },
      ],
    };
  }, [id, index, selected]);
}

export default function OnboardingStartScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<VerticalId>("vehicle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const { setOnboardingCompleted, user } = useAuth();

  const entryProgress = useSharedValue(0);
  const selectedProgress = useSharedValue(0);
  const thesisProgress = useSharedValue(0);
  const ctaProgress = useSharedValue(0);

  const selectedOption = optionFor(selected);

  const vehicleOrbStyle = useOrbStyle(0, "vehicle", selected, entryProgress, selectedProgress);
  const homeOrbStyle = useOrbStyle(1, "home", selected, entryProgress, selectedProgress);
  const healthOrbStyle = useOrbStyle(2, "health", selected, entryProgress, selectedProgress);

  useEffect(() => {
    capture("onboarding_step_viewed", { step: "start" });
  }, []);

  useEffect(() => {
    entryProgress.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    selectedProgress.value = withDelay(420, withSpring(1, { damping: 14, stiffness: 135 }));
    thesisProgress.value = withDelay(650, withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) }));
    ctaProgress.value = withDelay(900, withTiming(1, { duration: 420, easing: Easing.out(Easing.ease) }));
  }, [entryProgress, selectedProgress, thesisProgress, ctaProgress]);

  const thesisStyle = useAnimatedStyle(() => ({
    opacity: thesisProgress.value,
    transform: [{ translateY: interpolate(thesisProgress.value, [0, 1], [10, 0]) }],
  }));

  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaProgress.value,
    transform: [{ translateY: interpolate(ctaProgress.value, [0, 1], [16, 0]) }],
  }));

  async function completeAndGo(destination: string, thenPush?: string) {
    setSaveError(null);
    if (user) {
      const { error } = await supabase.from("profiles").upsert(
        { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) {
        setSaveError("Couldn't save your progress. Try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    }
    if (user) {
      await AsyncStorage.setItem(getOnboardingKey(user.id), "true");
    }
    setOnboardingCompleted(true);
    router.replace(destination as any);
    if (thenPush) {
      setTimeout(() => router.push(thenPush as any), 400);
    }
  }

  function handleSelect(id: VerticalId) {
    setSelected(id);
    setSaveError(null);
    primeHaptics();
    Haptics.selectionAsync();
    selectedProgress.value = 0.82;
    selectedProgress.value = withSpring(1, { damping: 12, stiffness: 160 });
    thesisProgress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.ease) });
  }

  function handleContinue() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selected === "vehicle") {
      router.push("/add-vehicle?onboarding=true");
    } else if (selected === "home") {
      completeAndGo("/(tabs)", "/add-property");
    } else {
      completeAndGo("/(tabs)");
    }
  }

  async function handleFinishLater() {
    await completeAndGo("/(tabs)");
    Haptics.selectionAsync();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "25%" }]} />
      </View>

      <View style={styles.header}>
        <Text style={styles.kicker}>LifeMaintained</Text>
        <Text style={styles.title}>Start with what you want to keep running.</Text>
        <Animated.Text style={[styles.thesis, thesisStyle]}>
          Most apps track one. LifeMaintained tracks all three.
        </Animated.Text>
      </View>

      <View style={styles.orbitStage}>
        <View style={styles.orbitHalo} />
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Choose vehicle"
          onPress={() => handleSelect("vehicle")}
          style={[styles.orb, styles.vehicleOrb, selected === "vehicle" && styles.selectedOrb, vehicleOrbStyle]}
        >
          <Ionicons name="car-sport-outline" size={30} color={Colors.accent} />
          <Text style={styles.orbText}>Vehicle</Text>
        </AnimatedPressable>

        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Choose home"
          onPress={() => handleSelect("home")}
          style={[styles.orb, styles.homeOrb, selected === "home" && styles.selectedOrb, homeOrbStyle]}
        >
          <Ionicons name="home-outline" size={30} color={Colors.home} />
          <Text style={styles.orbText}>Home</Text>
        </AnimatedPressable>

        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Choose health"
          onPress={() => handleSelect("health")}
          style={[styles.orb, styles.healthOrb, selected === "health" && styles.selectedOrb, healthOrbStyle]}
        >
          <Ionicons name="heart-outline" size={30} color={Colors.health} />
          <Text style={styles.orbText}>Health</Text>
        </AnimatedPressable>
      </View>

      <Animated.View style={[styles.focusCard, ctaStyle]}>
        <View style={styles.focusHeader}>
          <View style={[styles.focusIcon, { backgroundColor: `${selectedOption.color}20` }]}>
            <Ionicons name={selectedOption.icon} size={22} color={selectedOption.color} />
          </View>
          <View style={styles.focusTextWrap}>
            <View style={styles.focusTitleRow}>
              <Text style={styles.focusTitle}>{selectedOption.title}</Text>
              {selectedOption.badge ? (
                <View style={[styles.badge, { backgroundColor: `${selectedOption.color}20` }]}>
                  <Text style={[styles.badgeText, { color: selectedOption.color }]}>{selectedOption.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.focusSubtitle}>{selectedOption.subtitle}</Text>
          </View>
        </View>
        <Text style={styles.focusCopy}>{selectedOption.focusCopy}</Text>
      </Animated.View>

      <Animated.View style={[styles.actions, ctaStyle]}>
        {saveError ? (
          <Text style={styles.inlineError}>{saveError}</Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
          onPress={handleContinue}
        >
          <Text style={styles.ctaText}>Get started</Text>
        </Pressable>

        <Pressable onPress={handleFinishLater} style={styles.skip}>
          <Text style={styles.skipText}>Finish later</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
    gap: 22,
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.accent,
  },
  header: {
    gap: 10,
    paddingTop: 6,
  },
  kicker: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    lineHeight: 36,
    letterSpacing: -0.4,
  },
  thesis: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    lineHeight: 23,
  },
  orbitStage: {
    flex: 1,
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  orbitHalo: {
    width: 196,
    height: 196,
    borderRadius: 98,
    borderWidth: 1,
    borderColor: Colors.border,
    opacity: 0.6,
  },
  orb: {
    position: "absolute",
    width: 116,
    height: 116,
    borderRadius: 28,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  selectedOrb: {
    borderColor: Colors.accent,
  },
  vehicleOrb: {
    left: "50%",
    top: "50%",
    marginLeft: -58,
    marginTop: -58,
  },
  homeOrb: {
    left: "50%",
    top: "50%",
    marginLeft: -58,
    marginTop: -58,
  },
  healthOrb: {
    left: "50%",
    top: "50%",
    marginLeft: -58,
    marginTop: -58,
  },
  orbText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  focusCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  focusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  focusIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  focusTextWrap: {
    flex: 1,
    gap: 2,
  },
  focusTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  focusTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  focusSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  focusCopy: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    lineHeight: 20,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  actions: {
    gap: 12,
  },
  cta: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: "#0C111B",
  },
  skip: {
    alignItems: "center",
    paddingVertical: 4,
  },
  skipText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
  },
  inlineError: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.overdue,
    lineHeight: 19,
    textAlign: "center",
  },
});
