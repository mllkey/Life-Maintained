import React, { useState, useRef, useEffect } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { setPendingIntent } from "@/lib/onboardingIntent";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { formatCostDisplay } from "@/lib/costFormat";
import { useAuth, getOnboardingKey } from "@/context/AuthContext";
import { capture } from "@/lib/analytics";
import { useQuery } from "@tanstack/react-query";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import { REVEAL_BEATS, REVEAL_HAPTIC_OFFSETS } from "@/lib/revealChoreography";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

const MAX_POLL_ATTEMPTS = 15; // 15 * 2s = 30s max

type Vertical = "vehicle" | "home" | "health";
type RevealItem = { name: string; dueLabel: string; costStr: string | null };
type RevealData = { items: RevealItem[]; count: number; heroSentence: string | null };
type SecondaryKind = "add-vehicle" | "add-home" | "add-another-vehicle";

type VehicleTaskRow = {
  name: string;
  next_due_date: string | null;
  next_due_miles: number | null;
  next_due_hours: number | null;
  interval_miles: number | null;
  interval_hours: number | null;
  interval_months: number | null;
};

function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function parseDate(dateStr: string | null): Date | null {
  const s = dateStr != null ? String(dateStr).trim() : "";
  const d = s.length > 0 ? new Date(s + (s.includes("T") ? "" : "T12:00:00")) : null;
  return d != null && !isNaN(d.getTime()) ? d : null;
}

function formatDue(dateStr: string | null, fallback: string | null): string {
  const d = parseDate(dateStr);
  if (d) return "Due " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return fallback || "Added to your plan";
}

function formatCost(v: number | null | undefined): string | null {
  if (v == null || Number(v) <= 0) return null;
  return "$" + Math.round(Number(v)).toLocaleString();
}

function vehicleDueLabel(t: VehicleTaskRow): string {
  const d = parseDate(t.next_due_date);
  if (d) return "Due " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (t.next_due_miles != null) return "Due at " + Number(t.next_due_miles).toLocaleString() + " mi";
  if (t.next_due_hours != null) return "Due at " + Number(t.next_due_hours).toLocaleString() + " hrs";
  if (t.interval_months != null) return "Every " + t.interval_months + " months";
  if (t.interval_miles != null) return "Every " + Number(t.interval_miles).toLocaleString() + " mi";
  if (t.interval_hours != null) return "Every " + Number(t.interval_hours).toLocaleString() + " hrs";
  return "Added to your maintenance plan";
}

function vehicleHeroSentence(t: VehicleTaskRow, displayName: string): string {
  const name = t.name.trim();
  const service = name.toLowerCase();
  if (t.next_due_miles != null) return `${displayName} needs ${service} at ${Number(t.next_due_miles).toLocaleString()} miles.`;
  if (t.next_due_hours != null) return `${displayName} needs ${service} at ${Number(t.next_due_hours).toLocaleString()} hours.`;
  const d = parseDate(t.next_due_date);
  if (d) return `${name} is coming up ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`;
  return `${name} is first in your maintenance plan.`;
}

const CONFIG: Record<Vertical, {
  tint: string;
  heroBadgeIcon: keyof typeof Ionicons.glyphMap;
  coverageNoun: (n: number) => string;
  bridge: { icon: keyof typeof Ionicons.glyphMap; tint: string; text: string };
  secondaries: SecondaryKind[];
  infoText: string | null;
  nameFallback: string;
  savedTitle: (name: string) => string;
  buildingTitle: string;
  stillGeneratingSub: string;
  waitingSub: (name: string) => string;
}> = {
  vehicle: {
    tint: Colors.vehicle,
    heroBadgeIcon: "sparkles",
    coverageNoun: (n) => (n === 1 ? "1 maintenance item" : `${n} maintenance items`),
    bridge: { icon: "home-outline", tint: Colors.home, text: "You\u2019re tracking 1 vehicle. Add your home next to see what you\u2019ve been missing." },
    secondaries: ["add-home", "add-another-vehicle"],
    infoText: "Log your last service dates to make due dates more accurate.",
    nameFallback: "vehicle",
    savedTitle: () => "Your vehicle is saved",
    buildingTitle: "Building your schedule",
    stillGeneratingSub: "Your schedule is still generating. It\u2019ll appear in the app shortly.",
    waitingSub: (name) => `Waiting for your ${name} schedule...`,
  },
  home: {
    tint: Colors.home,
    heroBadgeIcon: "home",
    coverageNoun: (n) => (n === 1 ? "1 maintenance item" : `${n} maintenance items`),
    bridge: { icon: "car-outline", tint: Colors.vehicle, text: "Add a vehicle next to bring your whole life into one plan." },
    secondaries: ["add-vehicle"],
    infoText: null,
    nameFallback: "home",
    savedTitle: (name) => `${name} is saved`,
    buildingTitle: "Building your plan",
    stillGeneratingSub: "Your plan is still generating. It\u2019ll appear in the app shortly.",
    waitingSub: (name) => `Finishing ${name}\u2019s plan...`,
  },
  health: {
    tint: Colors.health,
    heroBadgeIcon: "heart",
    coverageNoun: (n) => (n === 1 ? "1 appointment" : `${n} appointments`),
    bridge: { icon: "car-outline", tint: Colors.vehicle, text: "Add a vehicle next to bring your whole life into one plan." },
    secondaries: ["add-vehicle"],
    infoText: null,
    nameFallback: "your loved one",
    savedTitle: (name) => `${name} is saved`,
    buildingTitle: "Building your plan",
    stillGeneratingSub: "Your plan is still generating. It\u2019ll appear in the app shortly.",
    waitingSub: (name) => `Finishing ${name}\u2019s plan...`,
  },
};

const SECONDARY_META: Record<SecondaryKind, { label: string; icon: keyof typeof Ionicons.glyphMap; tint: string }> = {
  "add-vehicle": { label: "Add a vehicle next", icon: "car-outline", tint: Colors.vehicle },
  "add-home": { label: "Add home next", icon: "home-outline", tint: Colors.home },
  "add-another-vehicle": { label: "Add another vehicle", icon: "car-outline", tint: Colors.vehicle },
};

export default function PlanRevealScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    vertical?: string | string[];
    assetId?: string | string[];
    assetName?: string | string[];
  }>();
  const vRaw = oneParam(params.vertical);
  const vertical: Vertical = vRaw === "vehicle" ? "vehicle" : vRaw === "health" ? "health" : "home";
  const assetId = oneParam(params.assetId);
  const cfg = CONFIG[vertical];
  const assetName = oneParam(params.assetName) || cfg.nameFallback;

  const { setOnboardingCompleted, user } = useAuth();
  const pollCount = useRef(0);
  const [pollTimedOut, setPollTimedOut] = useState(!assetId);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const skeletonAnim = usePulse();
  const revealHapticsFired = useRef(false);

  const coverageOpacity = useSharedValue(0);
  const coverageY = useSharedValue(16);
  const heroOpacity = useSharedValue(0);
  const heroY = useSharedValue(16);
  const supportOneOpacity = useSharedValue(0);
  const supportOneY = useSharedValue(12);
  const supportTwoOpacity = useSharedValue(0);
  const supportTwoY = useSharedValue(12);
  const bridgeOpacity = useSharedValue(0);

  useEffect(() => {
    capture("onboarding_step_viewed", { step: "plan_reveal", vertical });
  }, [vertical]);

  const { data } = useQuery<RevealData>({
    queryKey: ["onboarding_reveal", vertical, assetId],
    queryFn: async () => {
      if (!assetId) return { items: [], count: 0, heroSentence: null };

      if (vertical === "vehicle") {
        const [rowsRes, countRes] = await Promise.all([
          supabase
            .from("user_vehicle_maintenance_tasks")
            .select("name, next_due_date, next_due_miles, next_due_hours, interval_miles, interval_hours, interval_months")
            .eq("vehicle_id", assetId)
            .order("next_due_date", { ascending: true, nullsFirst: false })
            .limit(5),
          supabase
            .from("user_vehicle_maintenance_tasks")
            .select("id", { count: "exact", head: true })
            .eq("vehicle_id", assetId),
        ]);
        const raw = (rowsRes.data ?? []).filter((r) => typeof r.name === "string" && r.name.length > 0) as VehicleTaskRow[];
        const costMap: Record<string, string | null> = {};
        if (raw.length > 0) {
          const { data: vehicle } = await supabase
            .from("vehicles")
            .select("year, make, model, vehicle_type")
            .eq("id", assetId)
            .maybeSingle();
          if (vehicle) {
            const vehicleKey = `${vehicle.year ?? ""}|${vehicle.make}|${vehicle.model ?? ""}|${vehicle.vehicle_type ?? ""}`.toLowerCase();
            const names = raw.map((t) => t.name.toLowerCase().trim());
            const { data: cached } = await supabase
              .from("repair_cost_cache")
              .select("service_name, shop_low, shop_high")
              .eq("vehicle_key", vehicleKey)
              .in("service_name", names);
            for (const c of cached ?? []) {
              costMap[String(c.service_name).toLowerCase().trim()] =
                formatCostDisplay(
                  c.shop_low != null ? Number(c.shop_low) : null,
                  c.shop_high != null ? Number(c.shop_high) : null,
                ) || null;
            }
          }
        }
        const items = raw.map((r) => ({
          name: r.name,
          dueLabel: vehicleDueLabel(r),
          costStr: costMap[r.name.toLowerCase().trim()] ?? null,
        }));
        const heroSentence = items.length > 0 ? vehicleHeroSentence(raw[0], assetName) : null;
        return { items, count: countRes.count ?? 0, heroSentence };
      }

      if (vertical === "home") {
        const [rowsRes, countRes] = await Promise.all([
          supabase
            .from("property_maintenance_tasks")
            .select("task, next_due_date, estimated_cost, interval")
            .eq("property_id", assetId)
            .order("next_due_date", { ascending: true, nullsFirst: false })
            .limit(5),
          supabase
            .from("property_maintenance_tasks")
            .select("id", { count: "exact", head: true })
            .eq("property_id", assetId),
        ]);
        const items = (rowsRes.data ?? [])
          .filter((r) => typeof r.task === "string" && r.task.length > 0)
          .map((r) => ({
            name: r.task,
            dueLabel: formatDue(r.next_due_date, r.interval ? String(r.interval) : null),
            costStr: formatCost(r.estimated_cost),
          }));
        return { items, count: countRes.count ?? 0, heroSentence: null };
      }

      const [rowsRes, countRes] = await Promise.all([
        supabase
          .from("health_appointments")
          .select("appointment_type, next_due_date, estimated_cost, interval_months")
          .eq("family_member_id", assetId)
          .order("next_due_date", { ascending: true, nullsFirst: false })
          .limit(5),
        supabase
          .from("health_appointments")
          .select("id", { count: "exact", head: true })
          .eq("family_member_id", assetId),
      ]);
      const items = (rowsRes.data ?? [])
        .filter((r) => typeof r.appointment_type === "string" && r.appointment_type.length > 0)
        .map((r) => ({
          name: r.appointment_type,
          dueLabel: formatDue(r.next_due_date, r.interval_months != null ? `Every ${r.interval_months} months` : null),
          costStr: formatCost(r.estimated_cost),
        }));
      return { items, count: countRes.count ?? 0, heroSentence: null };
    },
    enabled: !!assetId && !pollTimedOut,
    refetchInterval: (query) => {
      const hasData = (query.state.data?.items?.length ?? 0) > 0;
      if (hasData) return false;
      pollCount.current++;
      if (pollCount.current >= MAX_POLL_ATTEMPTS) {
        setPollTimedOut(true);
        return false;
      }
      return 2000;
    },
  });

  const itemsToShow = (data?.items ?? []).slice(0, 3);
  const hasItems = itemsToShow.length > 0;
  const heroItem = itemsToShow[0] ?? null;
  const heroSentence = data?.heroSentence ?? null;
  const supportingItems = itemsToShow.slice(1, 3);
  const rawCount = data?.count ?? 0;
  const coverageTotal = rawCount > 0 ? rawCount : itemsToShow.length;

  async function completeOnboarding(): Promise<boolean> {
    setCompletionError(null);
    if (user) {
      const { error } = await supabase.from("profiles").upsert(
        { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) {
        setCompletionError("Couldn\u2019t save your progress. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return false;
      }
      await AsyncStorage.setItem(getOnboardingKey(user.id), "true");
    }
    setOnboardingCompleted(true);
    return true;
  }

  async function handleViewPlan() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const done = await completeOnboarding();
    if (!done) return;
    if (assetId) {
      setPendingIntent(
        vertical === "home"
          ? { kind: "open-property", id: assetId }
          : vertical === "health"
            ? { kind: "open-member", id: assetId }
            : { kind: "open-vehicle", id: assetId },
      );
    }
    router.replace("/(tabs)");
  }

  async function handleSecondary(kind: SecondaryKind) {
    if (kind === "add-another-vehicle") {
      router.replace({ pathname: "/add-vehicle", params: { onboarding: "true" } });
      Haptics.selectionAsync();
      return;
    }
    const done = await completeOnboarding();
    if (!done) return;
    setPendingIntent(kind === "add-home" ? { kind: "add-property" } : { kind: "add-vehicle" });
    router.replace("/(tabs)");
    Haptics.selectionAsync();
  }

  useEffect(() => {
    if (!hasItems) {
      revealHapticsFired.current = false;
      coverageOpacity.value = 0; coverageY.value = 16;
      heroOpacity.value = 0; heroY.value = 16;
      supportOneOpacity.value = 0; supportOneY.value = 12;
      supportTwoOpacity.value = 0; supportTwoY.value = 12;
      bridgeOpacity.value = 0;
      return;
    }
    const ease = Easing.out(Easing.cubic);
    coverageOpacity.value = withTiming(1, { duration: 340, easing: ease });
    coverageY.value = withTiming(0, { duration: 340, easing: ease });
    heroOpacity.value = withDelay(REVEAL_BEATS.hero, withTiming(1, { duration: 340, easing: ease }));
    heroY.value = withDelay(REVEAL_BEATS.hero, withTiming(0, { duration: 340, easing: ease }));
    supportOneOpacity.value = withDelay(REVEAL_BEATS.supportOne, withTiming(1, { duration: 280, easing: ease }));
    supportOneY.value = withDelay(REVEAL_BEATS.supportOne, withTiming(0, { duration: 280, easing: ease }));
    supportTwoOpacity.value = withDelay(REVEAL_BEATS.supportTwo, withTiming(1, { duration: 280, easing: ease }));
    supportTwoY.value = withDelay(REVEAL_BEATS.supportTwo, withTiming(0, { duration: 280, easing: ease }));
    bridgeOpacity.value = withDelay(REVEAL_BEATS.bridge, withTiming(1, { duration: 260, easing: Easing.out(Easing.ease) }));

    if (revealHapticsFired.current) return;
    revealHapticsFired.current = true;
    const timers = REVEAL_HAPTIC_OFFSETS.map((ms, i) =>
      setTimeout(
        () => (i === 0
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
          : Haptics.selectionAsync().catch(() => {})),
        ms,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [hasItems, coverageOpacity, coverageY, heroOpacity, heroY, supportOneOpacity, supportOneY, supportTwoOpacity, supportTwoY, bridgeOpacity]);

  const coverageStyle = useAnimatedStyle(() => ({ opacity: coverageOpacity.value, transform: [{ translateY: coverageY.value }] }));
  const heroStyle = useAnimatedStyle(() => ({ opacity: heroOpacity.value, transform: [{ translateY: heroY.value }] }));
  const supportOneStyle = useAnimatedStyle(() => ({ opacity: supportOneOpacity.value, transform: [{ translateY: supportOneY.value }] }));
  const supportTwoStyle = useAnimatedStyle(() => ({ opacity: supportTwoOpacity.value, transform: [{ translateY: supportTwoY.value }] }));
  const bridgeStyle = useAnimatedStyle(() => ({ opacity: bridgeOpacity.value }));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: "100%" }]} />
        </View>

        {!hasItems && (
          <View style={styles.header}>
            <Text style={styles.title}>{pollTimedOut ? cfg.savedTitle(assetName) : cfg.buildingTitle}</Text>
            <Text style={styles.subtitle}>{pollTimedOut ? cfg.stillGeneratingSub : cfg.waitingSub(assetName)}</Text>
          </View>
        )}

        {hasItems && (
          <Animated.View style={[styles.coverageBlock, coverageStyle]}>
            <View style={styles.coverageIcon}>
              <Ionicons name="shield-checkmark" size={20} color={Colors.good} />
            </View>
            <Text style={styles.coverageTitle}>{assetName} is covered</Text>
            <Text style={styles.coverageSub}>
              {`We\u2019re watching ${cfg.coverageNoun(coverageTotal)}. We\u2019ll remind you before the first one is due.`}
            </Text>
          </Animated.View>
        )}

        {hasItems && heroItem ? (
          <View style={styles.tasksSection}>
            <Text style={styles.sectionLabel}>First up</Text>
            <Animated.View style={[styles.heroCard, heroStyle, { borderColor: cfg.tint + "40" }]}>
              <View style={styles.heroBadgeRow}>
                <View style={[styles.heroBadgeIcon, { backgroundColor: cfg.tint + "26" }]}>
                  <Ionicons name={cfg.heroBadgeIcon} size={15} color={cfg.tint} />
                </View>
                <Text style={[styles.heroBadgeText, { color: cfg.tint }]}>Added to your plan</Text>
              </View>
              <Text style={styles.heroName}>{heroItem.name}</Text>
              {heroSentence ? <Text style={styles.heroSentence}>{heroSentence}</Text> : null}
              <View style={styles.heroMetaRow}>
                <View style={styles.heroMetaPill}>
                  <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
                  <Text style={styles.heroMetaText}>{heroItem.dueLabel}</Text>
                </View>
                {heroItem.costStr ? (
                  <View style={[styles.heroMetaPill, styles.heroCostPill]}>
                    <Ionicons name="cash-outline" size={14} color={Colors.good} />
                    <Text style={styles.heroCostText}>{heroItem.costStr}</Text>
                  </View>
                ) : null}
              </View>
            </Animated.View>

            {supportingItems.length > 0 ? (
              <View style={styles.supportingSection}>
                <Text style={styles.supportingLabel}>Also ready</Text>
                {supportingItems.map((item, i) => (
                  <Animated.View key={item.name + i} style={[styles.supportCard, i === 0 ? supportOneStyle : supportTwoStyle]}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.taskName}>{item.name}</Text>
                      <Text style={styles.taskMeta}>{item.dueLabel}</Text>
                    </View>
                    {item.costStr ? <Text style={styles.taskCost}>{item.costStr}</Text> : null}
                  </Animated.View>
                ))}
              </View>
            ) : null}

            <Animated.View style={[styles.bridgeBox, bridgeStyle]}>
              <Ionicons name={cfg.bridge.icon} size={15} color={cfg.bridge.tint} />
              <Text style={styles.bridgeText}>{cfg.bridge.text}</Text>
            </Animated.View>
          </View>
        ) : !pollTimedOut ? (
          <View style={styles.tasksSection}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.supportCard}>
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

        {hasItems && cfg.infoText ? (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.textTertiary} />
            <Text style={styles.infoText}>{cfg.infoText}</Text>
          </View>
        ) : null}

        {completionError ? <Text style={styles.inlineError}>{completionError}</Text> : null}

        {cfg.secondaries.map((kind) => {
          const meta = SECONDARY_META[kind];
          return (
            <Pressable key={kind} onPress={() => handleSecondary(kind)} style={styles.secondary}>
              <Ionicons name={meta.icon} size={16} color={meta.tint} />
              <Text style={[styles.secondaryText, { color: meta.tint }]}>{meta.label}</Text>
            </Pressable>
          );
        })}

        <Pressable style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]} onPress={handleViewPlan}>
          <Text style={styles.ctaText}>View my plan</Text>
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
  coverageBlock: { backgroundColor: Colors.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: Colors.goodMuted, gap: 8, alignItems: "flex-start" },
  coverageIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: Colors.goodMuted, marginBottom: 2 },
  coverageTitle: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5, lineHeight: 32 },
  coverageSub: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  tasksSection: { gap: 12 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 22, padding: 18, borderWidth: 1, gap: 12 },
  heroBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroBadgeIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  heroBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  heroName: { fontSize: 23, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 29 },
  heroSentence: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  heroMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heroMetaPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.surface },
  heroCostPill: { backgroundColor: Colors.goodMuted },
  heroMetaText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  heroCostText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.good },
  supportingSection: { gap: 9, marginTop: 2 },
  supportingLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  supportCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  taskName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  taskMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  taskCost: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.good },
  bridgeBox: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: Colors.surface, borderRadius: 14, padding: 12 },
  bridgeText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary, lineHeight: 19 },
  infoBox: { flexDirection: "row", gap: 8, backgroundColor: Colors.surface, borderRadius: 10, padding: 12, alignItems: "center" },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, lineHeight: 19 },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.vehicle },
  inlineError: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue, lineHeight: 19, textAlign: "center" },
});
