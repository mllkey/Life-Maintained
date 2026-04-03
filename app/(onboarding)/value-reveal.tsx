import React, { useState, useRef } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { usePulse, S, Row, Col } from "@/components/Skeleton";

const MAX_POLL_ATTEMPTS = 15; // 15 * 2s = 30 seconds max

/** Expo Router may pass string | string[] for params */
function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export default function ValueRevealScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ vehicleId?: string | string[]; vehicleName?: string | string[] }>();
  const vehicleId = oneParam(params.vehicleId);
  const vehicleName = oneParam(params.vehicleName);
  const { setOnboardingCompleted, user } = useAuth();
  const pollCount = useRef(0);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const skeletonAnim = usePulse();

  const { data: topTasks } = useQuery({
    queryKey: ["onboarding_top_tasks", vehicleId],
    queryFn: async () => {
      if (!vehicleId) return [];
      const { data } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("name, next_due_date, next_due_miles, next_due_hours, priority, interval_miles, interval_hours, interval_months")
        .eq("vehicle_id", vehicleId)
        .order("next_due_date", { ascending: true, nullsFirst: false })
        .limit(5);
      return data ?? [];
    },
    enabled: !!vehicleId && !pollTimedOut,
    refetchInterval: query => {
      const hasData = (query.state.data?.length ?? 0) > 0;
      if (hasData) return false;
      pollCount.current++;
      if (pollCount.current >= MAX_POLL_ATTEMPTS) {
        setPollTimedOut(true);
        return false;
      }
      return 2000;
    },
  });

  const { data: estimates } = useQuery({
    queryKey: ["onboarding_estimates", vehicleId],
    queryFn: async () => {
      if (!vehicleId || !topTasks?.length) return {};
      const { data: vehicle } = await supabase.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
      if (!vehicle) return {};
      const vehicleKey = `${vehicle.year ?? ""}|${vehicle.make}|${vehicle.model ?? ""}|${vehicle.vehicle_type ?? ""}`.toLowerCase();
      const names = topTasks.map(t => t.name.toLowerCase().trim());
      const { data: cached } = await supabase
        .from("repair_cost_cache")
        .select("service_name, shop_low, shop_high")
        .eq("vehicle_key", vehicleKey)
        .in("service_name", names);
      const map: Record<string, { shop_low: number | null; shop_high: number | null }> = {};
      for (const c of cached ?? []) {
        map[String(c.service_name).toLowerCase().trim()] = {
          shop_low: c.shop_low,
          shop_high: c.shop_high,
        };
      }
      return map;
    },
    enabled: (topTasks?.length ?? 0) > 0,
  });

  async function completeOnboarding() {
    if (user) {
      const { error } = await supabase.from("profiles").upsert(
        { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) {
        Alert.alert("Something went wrong", "Could not save your progress. Please try again.");
        return;
      }
    }
    await AsyncStorage.setItem("@onboarding_completed", "true");
    setOnboardingCompleted(true);
  }

  async function handleOpenDashboard() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await completeOnboarding();
    router.replace("/(tabs)");
  }

  async function handleAddHome() {
    Haptics.selectionAsync();
    await completeOnboarding();
    router.replace("/(tabs)");
    setTimeout(() => router.push("/add-property"), 400);
  }

  function handleAddAnotherVehicle() {
    Haptics.selectionAsync();
    router.replace({ pathname: "/add-vehicle", params: { onboarding: "true" } });
  }

  const tasksToShow = (topTasks ?? []).slice(0, 3);
  const hasTasks = tasksToShow.length > 0;
  const displayName = vehicleName || "vehicle";

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Progress */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: "100%" }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="checkmark-circle" size={48} color={Colors.good} />
          <Text style={styles.title}>
            {hasTasks ? "Your plan is ready" : pollTimedOut ? "Your vehicle is saved" : "Almost there..."}
          </Text>
          <Text style={styles.subtitle}>
            {hasTasks
              ? `Built for your ${displayName}.`
              : pollTimedOut
                ? "Your schedule is still generating. It\u2019ll appear in the app shortly."
                : `Waiting for your ${displayName} schedule...`}
          </Text>
        </View>

        {/* Trust signal */}
        {hasTasks && (
          <Text style={styles.trust}>Based on your vehicle and current usage</Text>
        )}

        {/* Task preview — skeletons while waiting; empty after poll timeout */}
        {hasTasks ? (
          <View style={styles.tasksSection}>
            <Text style={styles.sectionLabel}>Coming up first</Text>
            {tasksToShow.map((task, i) => {
              const est = estimates?.[task.name.toLowerCase().trim()];
              const costStr = est
                ? Number(est.shop_low) === Number(est.shop_high)
                  ? `$${Number(est.shop_low)}`
                  : `$${Number(est.shop_low)}\u2013$${Number(est.shop_high)}`
                : null;
              return (
                <View key={i} style={styles.taskCard}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.taskName}>{task.name}</Text>
                    <Text style={styles.taskMeta}>
                      {(() => {
                        const dateStr = task.next_due_date != null ? String(task.next_due_date).trim() : "";
                        const parsedDate = dateStr.length > 0 ? new Date(dateStr + (dateStr.includes("T") ? "" : "T12:00:00")) : null;
                        const isValidDate = parsedDate != null && !isNaN(parsedDate.getTime());
                        return isValidDate ? "Due " + parsedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : task.next_due_miles != null ? "Due at " + Number(task.next_due_miles).toLocaleString() + " mi"
                          : task.next_due_hours != null ? "Due at " + Number(task.next_due_hours).toLocaleString() + " hrs"
                          : task.interval_months != null ? "Every " + task.interval_months + " months"
                          : task.interval_miles != null ? "Every " + Number(task.interval_miles).toLocaleString() + " mi"
                          : "";
                      })()}
                    </Text>
                  </View>
                  {costStr && (
                    <Text style={styles.taskCost}>{costStr}</Text>
                  )}
                </View>
              );
            })}
          </View>
        ) : !pollTimedOut ? (
          // Still loading — show skeletons
          <View style={styles.tasksSection}>
            {[0, 1, 2].map(i => (
              <View key={i} style={styles.taskCard}>
                <Row>
                  <Col flex={1} gap={6}>
                    <S anim={skeletonAnim} w="65%" h={14} r={5} />
                    <S anim={skeletonAnim} w="40%" h={11} r={4} />
                  </Col>
                  <S anim={skeletonAnim} w={50} h={18} r={8} />
                </Row>
              </View>
            ))}
          </View>
        ) : null}

        {/* Explainer */}
        {hasTasks && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.textTertiary} />
            <Text style={styles.infoText}>
              Log your last service dates to make due dates more accurate.
            </Text>
          </View>
        )}

        {/* CTAs — always available even if tasks never loaded */}
        <Pressable onPress={handleAddHome} style={styles.secondary}>
          <Ionicons name="home-outline" size={16} color={Colors.home} />
          <Text style={styles.secondaryText}>Add home next</Text>
        </Pressable>

        <Pressable onPress={handleAddAnotherVehicle} style={styles.secondary}>
          <Ionicons name="car-outline" size={16} color={Colors.vehicle} />
          <Text style={[styles.secondaryText, { color: Colors.vehicle }]}>Add another vehicle</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
          onPress={handleOpenDashboard}
        >
          <Text style={styles.ctaText}>Open my dashboard</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 20, gap: 24 },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.good },
  header: { alignItems: "center", gap: 10 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  trust: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center" },
  tasksSection: { gap: 10 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  taskCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: Colors.border,
  },
  taskName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  taskMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  taskCost: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.good },
  infoBox: {
    flexDirection: "row", gap: 8, backgroundColor: Colors.surface ?? Colors.card, borderRadius: 10, padding: 12, alignItems: "center",
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, lineHeight: 19 },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#0C111B" },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.home },
});
