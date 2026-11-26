import React, { useState, useRef, useEffect, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { setPendingIntent } from "@/lib/onboardingIntent";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { loadOnboardingRevealData, parseRevealPreview, type RevealData, type RevealVertical } from "@/lib/onboardingRevealData";
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

// Fallback path only (no validated payload from the building scene, e.g. a deep
// link or cold entry). Two windows, counted in elapsed time by an explicit
// effect, never inside the query's refetchInterval callback.
const POLL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15; // 15 * 2s = 30s first window
// E1c: after the first window the degraded block shows, but generation may still
// land. Keep polling more slowly for another 120s before giving up for good.
const EXTENDED_POLL_MS = 5000;
const MAX_EXTENDED_ATTEMPTS = 24; // 24 * 5s = 120s
const FIRST_WINDOW_MS = MAX_POLL_ATTEMPTS * POLL_MS;
const EXTENDED_WINDOW_MS = MAX_EXTENDED_ATTEMPTS * EXTENDED_POLL_MS;
const DEGRADED_FADE_MS = 200;

type Vertical = RevealVertical;
type SecondaryKind = "add-vehicle" | "add-home" | "add-another-vehicle";

function oneParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

const CONFIG: Record<Vertical, {
  tint: string;
  heroBadgeIcon: IconName;
  bridge: { icon: IconName; tint: string; text: string };
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
    bridge: { icon: "home-outline", tint: Colors.home, text: "You\u2019re tracking 1 vehicle. Add your home next to see what you\u2019ve been missing." },
    secondaries: ["add-home", "add-another-vehicle"],
    infoText: "Log your last service dates to make due dates more accurate.",
    nameFallback: "vehicle",
    savedTitle: () => "Your vehicle is saved",
    buildingTitle: "Building your schedule",
    stillGeneratingSub: "Your schedule isn\u2019t ready yet. It will show up on your vehicle\u2019s screen once it is built.",
    waitingSub: (name) => `Waiting for your ${name} schedule...`,
  },
  home: {
    tint: Colors.home,
    heroBadgeIcon: "home",
    bridge: { icon: "car-outline", tint: Colors.vehicle, text: "Add a vehicle next to bring your whole life into one plan." },
    secondaries: ["add-vehicle"],
    infoText: null,
    nameFallback: "home",
    savedTitle: (name) => `${name} is saved`,
    buildingTitle: "Building your plan",
    stillGeneratingSub: "Your plan isn\u2019t ready yet. It will show up in the app once it is built.",
    waitingSub: (name) => `Finishing ${name}\u2019s plan...`,
  },
  health: {
    tint: Colors.health,
    heroBadgeIcon: "heart",
    bridge: { icon: "car-outline", tint: Colors.vehicle, text: "Add a vehicle next to bring your whole life into one plan." },
    secondaries: ["add-vehicle"],
    infoText: null,
    nameFallback: "your loved one",
    savedTitle: (name) => `${name} is saved`,
    buildingTitle: "Building your plan",
    stillGeneratingSub: "Your plan isn\u2019t ready yet. It will show up in the app once it is built.",
    waitingSub: (name) => `Finishing ${name}\u2019s plan...`,
  },
};

const SECONDARY_META: Record<SecondaryKind, { label: string; icon: IconName; tint: string }> = {
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
    taskCount?: string | string[];
    preview?: string | string[];
  }>();
  const vRaw = oneParam(params.vertical);
  const vertical: Vertical = vRaw === "vehicle" ? "vehicle" : vRaw === "health" ? "health" : "home";
  const assetId = oneParam(params.assetId);
  const cfg = CONFIG[vertical];
  const assetName = oneParam(params.assetName) || cfg.nameFallback;
  const taskCountParam = oneParam(params.taskCount);
  const previewParam = oneParam(params.preview);
  // The building scene hands over a preview it has already verified against
  // the database. When that payload validates in full, this screen renders
  // from it at once and never queries, polls, or shows a skeleton.
  const scenePayload = useMemo<RevealData | null>(
    () => (assetId ? parseRevealPreview(previewParam, taskCountParam) : null),
    [assetId, previewParam, taskCountParam],
  );
  const usesFallback = scenePayload === null;

  const { setOnboardingCompleted, user } = useAuth();
  const [pollTimedOut, setPollTimedOut] = useState(!assetId);
  const [extendedGaveUp, setExtendedGaveUp] = useState(!assetId);
  const sawDegraded = useRef(false);
  const degradedOpacity = useSharedValue(1);
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

  const { data: fallbackData } = useQuery<RevealData>({
    queryKey: ["onboarding_reveal", vertical, assetId],
    queryFn: () => loadOnboardingRevealData(vertical, assetId, assetName),
    enabled: usesFallback && !!assetId && !extendedGaveUp,
    // Pure: no counters and no setState in here. The windows are advanced by
    // the elapsed-time effect below.
    refetchInterval: usesFallback
      ? (query) => {
          const hasData = (query.state.data?.items?.length ?? 0) > 0;
          if (hasData) return false;
          return pollTimedOut ? EXTENDED_POLL_MS : POLL_MS;
        }
      : false,
  });
  const data: RevealData | undefined = scenePayload ?? fallbackData;
  const fallbackHasItems = (fallbackData?.items?.length ?? 0) > 0;

  // Fallback windows, measured in elapsed time from mount: degraded copy after
  // the first window, stop polling after the extended one. Nothing to time once
  // rows have arrived or when the scene payload is in use.
  const fallbackStartedAt = useRef(Date.now());
  useEffect(() => {
    if (!usesFallback || !assetId || fallbackHasItems || extendedGaveUp) return;
    const elapsed = Date.now() - fallbackStartedAt.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!pollTimedOut) {
      timers.push(setTimeout(() => setPollTimedOut(true), Math.max(FIRST_WINDOW_MS - elapsed, 0)));
    }
    timers.push(setTimeout(() => setExtendedGaveUp(true), Math.max(FIRST_WINDOW_MS + EXTENDED_WINDOW_MS - elapsed, 0)));
    return () => timers.forEach(clearTimeout);
  }, [usesFallback, assetId, fallbackHasItems, pollTimedOut, extendedGaveUp]);

  const itemsToShow = (data?.items ?? []).slice(0, 3);
  const hasItems = itemsToShow.length > 0;
  const heroItem = itemsToShow[0] ?? null;
  const heroSentence = data?.heroSentence ?? null;
  const supportingItems = itemsToShow.slice(1, 3);

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
    if (pollTimedOut && !hasItems) sawDegraded.current = true;
  }, [pollTimedOut, hasItems]);

  useEffect(() => {
    if (!hasItems) {
      revealHapticsFired.current = false;
      degradedOpacity.value = 1;
      coverageOpacity.value = 0; coverageY.value = 16;
      heroOpacity.value = 0; heroY.value = 16;
      supportOneOpacity.value = 0; supportOneY.value = 12;
      supportTwoOpacity.value = 0; supportTwoY.value = 12;
      bridgeOpacity.value = 0;
      return;
    }
    const ease = Easing.out(Easing.cubic);
    // Late arrival: fade the degraded block out first, then run the cascade exactly
    // as built, shifted by the fade. Fast path is unshifted (offset 0).
    const offset = sawDegraded.current ? DEGRADED_FADE_MS : 0;
    if (offset) degradedOpacity.value = withTiming(0, { duration: DEGRADED_FADE_MS });
    coverageOpacity.value = withDelay(offset, withTiming(1, { duration: 340, easing: ease }));
    coverageY.value = withDelay(offset, withTiming(0, { duration: 340, easing: ease }));
    heroOpacity.value = withDelay(offset + REVEAL_BEATS.hero, withTiming(1, { duration: 340, easing: ease }));
    heroY.value = withDelay(offset + REVEAL_BEATS.hero, withTiming(0, { duration: 340, easing: ease }));
    supportOneOpacity.value = withDelay(offset + REVEAL_BEATS.supportOne, withTiming(1, { duration: 280, easing: ease }));
    supportOneY.value = withDelay(offset + REVEAL_BEATS.supportOne, withTiming(0, { duration: 280, easing: ease }));
    supportTwoOpacity.value = withDelay(offset + REVEAL_BEATS.supportTwo, withTiming(1, { duration: 280, easing: ease }));
    supportTwoY.value = withDelay(offset + REVEAL_BEATS.supportTwo, withTiming(0, { duration: 280, easing: ease }));
    bridgeOpacity.value = withDelay(offset + REVEAL_BEATS.bridge, withTiming(1, { duration: 260, easing: Easing.out(Easing.ease) }));

    if (revealHapticsFired.current) return;
    revealHapticsFired.current = true;
    const timers = REVEAL_HAPTIC_OFFSETS.map((ms, i) =>
      setTimeout(
        () => (i === 0
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
          : Haptics.selectionAsync().catch(() => {})),
        offset + ms,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [hasItems, degradedOpacity, coverageOpacity, coverageY, heroOpacity, heroY, supportOneOpacity, supportOneY, supportTwoOpacity, supportTwoY, bridgeOpacity]);

  const degradedStyle = useAnimatedStyle(() => ({ opacity: degradedOpacity.value }));
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
          <Animated.View style={[styles.header, degradedStyle]}>
            <Text style={styles.title}>{pollTimedOut ? cfg.savedTitle(assetName) : cfg.buildingTitle}</Text>
            <Text style={styles.subtitle}>{pollTimedOut ? cfg.stillGeneratingSub : cfg.waitingSub(assetName)}</Text>
          </Animated.View>
        )}

        {hasItems && (
          <Animated.View style={[styles.coverageBlock, coverageStyle]}>
            <View style={styles.coverageIcon}>
              <Icon name="shield-checkmark" size={20} color={Colors.good} />
            </View>
            <Text style={styles.coverageTitle}>{assetName} is covered</Text>
          </Animated.View>
        )}

        {hasItems && heroItem ? (
          <View style={styles.tasksSection}>
            <Text style={styles.sectionLabel}>First up</Text>
            <Animated.View style={[styles.heroCard, heroStyle, { borderColor: cfg.tint + "40" }]}>
              <View style={styles.heroBadgeRow}>
                <View style={[styles.heroBadgeIcon, { backgroundColor: cfg.tint + "26" }]}>
                  <Icon name={cfg.heroBadgeIcon} size={15} color={cfg.tint} />
                </View>
                <Text style={[styles.heroBadgeText, { color: cfg.tint }]}>Added to your plan</Text>
              </View>
              <Text style={styles.heroName}>{heroItem.name}</Text>
              {heroSentence ? <Text style={styles.heroSentence}>{heroSentence}</Text> : null}
              <View style={styles.heroMetaRow}>
                <View style={styles.heroMetaPill}>
                  <Icon name="calendar-outline" size={14} color={Colors.textSecondary} />
                  <Text style={styles.heroMetaText}>{heroItem.dueLabel}</Text>
                </View>
                {heroItem.costStr ? (
                  <View style={[styles.heroMetaPill, styles.heroCostPill]}>
                    <Icon name="cash-outline" size={14} color={Colors.good} />
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
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.taskName}>{item.name}</Text>
                      <Text style={styles.taskMeta}>{item.dueLabel}</Text>
                    </View>
                    {item.costStr ? <Text style={styles.taskCost}>{item.costStr}</Text> : null}
                  </Animated.View>
                ))}
              </View>
            ) : null}

            {data?.items?.some((i) => !!i.costStr) ? (
              <Text style={{ ...Typography.caption, color: Colors.textTertiary, textAlign: "center", marginTop: 4 }}>
                Cost estimates included with your trial and paid plans.
              </Text>
            ) : null}
            <Animated.View style={[styles.bridgeBox, bridgeStyle]}>
              <Icon name={cfg.bridge.icon} size={15} color={cfg.bridge.tint} />
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
            <Icon name="information-circle-outline" size={16} color={Colors.textTertiary} />
            <Text style={styles.infoText}>{cfg.infoText}</Text>
          </View>
        ) : null}

        {completionError ? <Text style={styles.inlineError}>{completionError}</Text> : null}

        {cfg.secondaries.map((kind) => {
          const meta = SECONDARY_META[kind];
          return (
            <Pressable key={kind} onPress={() => handleSecondary(kind)} style={styles.secondary}>
              <Icon name={meta.icon} size={16} color={meta.tint} />
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
  progressBar: { height: 3, borderRadius: Radius.sm, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: Radius.sm, backgroundColor: Colors.accent },
  header: { alignItems: "center", gap: 12 },
  title: { ...Typography.title2, color: Colors.text },
  subtitle: { ...Typography.subheadline, color: Colors.textSecondary, textAlign: "center" },
  coverageBlock: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 20, borderWidth: 1, borderColor: Colors.goodMuted, gap: 8, alignItems: "flex-start" },
  coverageIcon: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: Colors.goodMuted, marginBottom: 2 },
  coverageTitle: { ...Typography.title2, color: Colors.text },
  tasksSection: { gap: 12 },
  sectionLabel: { ...Typography.footnote, fontWeight: "600", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  heroCard: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 20, borderWidth: 1, gap: 12 },
  heroBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroBadgeIcon: { width: 26, height: 26, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center" },
  heroBadgeText: { ...Typography.caption, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  heroName: { ...Typography.title2, color: Colors.text },
  heroSentence: { ...Typography.subheadline, color: Colors.textSecondary },
  heroMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heroMetaPill: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.surface },
  heroCostPill: { backgroundColor: Colors.goodMuted },
  heroMetaText: { ...Typography.caption, fontWeight: "500", color: Colors.textSecondary },
  heroCostText: { ...Typography.caption, fontWeight: "600", color: Colors.good },
  supportingSection: { gap: 8, marginTop: 2 },
  supportingLabel: { ...Typography.caption, fontWeight: "600", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  supportCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 16, borderWidth: 1, borderColor: Colors.border },
  taskName: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  taskMeta: { ...Typography.footnote, color: Colors.textSecondary },
  taskCost: { ...Typography.footnote, fontWeight: "600", color: Colors.good },
  bridgeBox: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 12 },
  bridgeText: { ...Typography.footnote, fontWeight: "500", flex: 1, color: Colors.textSecondary },
  infoBox: { flexDirection: "row", gap: 8, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 12, alignItems: "center" },
  infoText: { ...Typography.footnote, flex: 1, color: Colors.textTertiary },
  cta: { backgroundColor: Colors.accent, borderRadius: Radius.lg, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { ...Typography.headline, color: Colors.textInverse },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  secondaryText: { ...Typography.subheadline, fontWeight: "500", color: Colors.vehicle },
  inlineError: { ...Typography.footnote, fontWeight: "500", color: Colors.overdue, textAlign: "center" },
});
