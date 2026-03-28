import React, { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";

const STEPS = [
  "Analyzing your vehicle",
  "Building your schedule",
  "Pricing common jobs",
  "Preparing your dashboard",
];

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
  const skeletonAnim = usePulse();
  const [currentStep, setCurrentStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTime = useRef(Date.now());

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

  const generateSchedule = useCallback(async () => {
    if (!vehicleId) {
      setFailed(true);
      return;
    }
    try {
      // CRITICAL: Match the exact invoke body shape from app/add-vehicle.tsx
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
        const httpStatus = ((error as { context?: { status?: number } })?.context?.status);
        if (httpStatus !== 409) {
          if (__DEV__) console.warn("[onboarding] schedule generation error:", error.message);
          setFailed(true);
          return;
        }
      }

      // Wait a beat for animation
      await new Promise(r => setTimeout(r, 1500));
      setCurrentStep(STEPS.length - 1);
      await new Promise(r => setTimeout(r, 800));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      // Navigate to value reveal
      setTimeout(() => {
        router.replace({
          pathname: "/(onboarding)/value-reveal",
          params: {
            vehicleId,
            vehicleName: vehicleName || `${yearStr} ${make} ${model}`.trim(),
          },
        });
      }, 600);
    } catch (e) {
      if (__DEV__) console.error("[onboarding] generation failed:", e);
      setFailed(true);
    }
  }, [vehicleId, vehicleName, make, model, yearStr, currentMileageStr, currentHoursStr, trackingMode, fuelType, vehicleCategory, queryClient]);

  useEffect(() => {
    startTime.current = Date.now();
    stepTimer.current = setInterval(() => {
      setCurrentStep(prev => {
        if (prev < STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 4000);

    void generateSchedule();

    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, [generateSchedule]);

  async function handleRetry() {
    setFailed(false);
    setCurrentStep(0);
    startTime.current = Date.now();
    await generateSchedule();
  }

  async function handleContinueAnyway() {
    // Complete onboarding and go to dashboard — vehicle is saved even if schedule failed
    try {
      if (user) {
        await supabase.from("profiles").upsert(
          { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      }
      await AsyncStorage.setItem("@onboarding_completed", "true");
      setOnboardingCompleted(true);
      router.replace("/(tabs)");
    } catch (e) {
      if (__DEV__) console.error("[onboarding] complete error:", e);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      {/* Progress */}
      <View style={[styles.progressBar, { marginHorizontal: 20 }]}>
        <View style={[styles.progressFill, { width: "75%" }]} />
      </View>

      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.title}>{failed ? "We couldn\u2019t finish that" : "Building your plan"}</Text>
        <Text style={styles.subtitle}>
          {failed
            ? "Your vehicle was saved. Try again now, or continue to the app."
            : "This usually takes 10\u201320 seconds the first time."}
        </Text>
      </View>

      {/* Steps */}
      {!failed && (
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              {i <= currentStep ? (
                <Ionicons name="checkmark-circle" size={20} color={i < currentStep ? Colors.good : Colors.accent} />
              ) : (
                <View style={styles.stepDot} />
              )}
              <Text style={[styles.stepText, i <= currentStep && { color: Colors.text }]}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Skeleton preview */}
      {!failed && (
        <View style={styles.skeletonSection}>
          {[0, 1, 2].map(i => (
            <View key={i} style={styles.skeletonCard}>
              <Row>
                <Col flex={1} gap={6}>
                  <S anim={skeletonAnim} w="70%" h={14} r={5} />
                  <S anim={skeletonAnim} w="45%" h={11} r={4} />
                </Col>
                <S anim={skeletonAnim} w={60} h={24} r={12} />
              </Row>
              <S anim={skeletonAnim} w="55%" h={11} r={4} />
            </View>
          ))}
        </View>
      )}

      {/* Error buttons */}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, gap: 28 },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.accent },
  headerSection: { paddingHorizontal: 20, gap: 8 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  steps: { paddingHorizontal: 20, gap: 16 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border },
  stepText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  skeletonSection: { paddingHorizontal: 20, gap: 12 },
  skeletonCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  errorButtons: { paddingHorizontal: 20, gap: 12, marginTop: 20 },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#0C111B" },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
