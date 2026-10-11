import React, { useState, useCallback} from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  RefreshControl,
  Modal,
  Image,
} from "react-native";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, differenceInCalendarDays } from "date-fns";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import { propertyLimit } from "@/lib/subscription";
import { propertyTaskCalibrationState } from "@/lib/calibration";
import Paywall from "@/components/Paywall";
import LoadErrorState from "@/components/LoadErrorState";

type Property = {
  id: string;
  address: string | null;
  property_type: string | null;
  year_built: number | null;
  square_footage: number | null;
  nickname: string | null;
  is_primary_residence: boolean | null;
  photo_url: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  house: "Single Family Home", condo: "Condo", apartment: "Apartment",
  townhouse: "Townhouse", commercial: "Commercial Building",
  vacation: "Vacation Home", other: "Property",
};

/** Title precedence for the list row: nickname → first line of the address → type. */
function propertyTitle(p: Property): string {
  if (p.nickname?.trim()) return p.nickname.trim();
  const firstLine = p.address?.split(",")[0]?.trim();
  if (firstLine) return firstLine;
  return TYPE_LABEL[p.property_type ?? "other"] ?? "Property";
}

/** "in 8 days" / "today" / "3 days overdue" from a date-only or ISO string. */
function relativeDue(dateStr: string): string {
  const days = differenceInCalendarDays(parseISO(dateStr), new Date());
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
}

function getStatus(nextDueDate: string | null, lastCompletedAt: string | null): "overdue" | "due_soon" | "good" {
  const now = new Date();
  const soon = addDays(now, 30);

  if (nextDueDate) {
    const due = parseISO(nextDueDate);
    if (isBefore(due, now)) return "overdue";
    if (isBefore(due, soon)) return "due_soon";
  }

  // A task with no completion record is never "all caught up",
  // treat as upcoming at minimum.
  if (!lastCompletedAt) return "due_soon";

  return "good";
}

function getPropertyIcon(type: string | null): string {
  switch (type) {
    case "condo": case "apartment": return "business-outline";
    case "commercial": return "storefront-outline";
    case "vacation": return "sunny-outline";
    case "townhouse": return "home-outline";
    default: return "home-outline";
  }
}

export default function HomeTabScreen() {
  const { user, profile } = useAuth();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState<"limit_reached" | "locked_existing">("limit_reached");

  const { data: properties, isLoading, isError, fetchStatus, refetch } = useQuery({
    queryKey: ["properties", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Property[];
    },
    enabled: !!user,
  });

  const { data: taskCounts } = useQuery({
    queryKey: ["property_task_counts", user?.id, properties?.map(p => p.id).join(",")],
    queryFn: async () => {
      if (!user || !properties?.length) return {};
      const ids = properties.map(p => p.id);
      const { data, error } = await supabase
        .from("property_maintenance_tasks")
        .select("property_id, task, next_due_date, last_completed_at, last_completed_source, created_at")
        .in("property_id", ids);
      if (error) throw error;

      const map: Record<string, { overdue: number; due_soon: number; total: number; nextTask: string | null; nextDue: string | null; nextIsEstimate: boolean; estTask: string | null; estDue: string | null }> = {};
      for (const t of data ?? []) {
        if (!map[t.property_id]) map[t.property_id] = { overdue: 0, due_soon: 0, total: 0, nextTask: null, nextDue: null, nextIsEstimate: false, estTask: null, estDue: null };
        const entry = map[t.property_id];
        entry.total++;
        // ESTIMATED tasks carry no urgency; they never drive the card badge. They only
        // feed the row's third line as a fallback (prefixed "Est.") when nothing confirmed is dated.
        if (propertyTaskCalibrationState(t) === "estimated") {
          if (t.next_due_date && (entry.estDue == null || t.next_due_date < entry.estDue)) { entry.estDue = t.next_due_date; entry.estTask = t.task; }
          continue;
        }
        const s = getStatus(t.next_due_date, t.last_completed_at);
        if (s === "overdue") entry.overdue++;
        else if (s === "due_soon") entry.due_soon++;
        // Nearest dated confirmed task (overdue first, then soonest) feeds the row's third line.
        if (t.next_due_date && (entry.nextDue == null || t.next_due_date < entry.nextDue)) { entry.nextDue = t.next_due_date; entry.nextTask = t.task; }
      }
      for (const entry of Object.values(map)) {
        if (entry.nextTask == null && entry.estTask) { entry.nextTask = entry.estTask; entry.nextDue = entry.estDue; entry.nextIsEstimate = true; }
      }
      return map;
    },
    enabled: !!(user && properties?.length),
  });


  const guardedAddPropertyPress = useCallback(() => {
    const count = properties?.length ?? 0;
    if (count >= propertyLimit(profile)) {
      setPaywallReason("limit_reached");
      setShowPaywall(true);
      return;
    }
    router.push('/add-property');
  }, [properties, profile, router, setShowPaywall]);

  const trailing = (
        <Pressable
          style={({ pressed }) => [{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            backgroundColor: Colors.accent,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: Radius.md,
            opacity: pressed ? 0.85 : 1,
          }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            guardedAddPropertyPress();
          }}
          accessibilityLabel="Add a new property"
          accessibilityRole="button"
        >
          <Icon name="add" size={18} color={Colors.textInverse} />
          <Text style={{ ...Typography.footnote, fontWeight: "600", color: Colors.textInverse }}>Property</Text>
        </Pressable>
  );

  // One add affordance per state: the loaded-empty state shows only the
  // EmptyState CTA, so the header pill hides there. Error/offline states keep it.
  const isLoadedEmpty = !isLoading && properties?.length === 0;
  const hasProperties = (properties?.length ?? 0) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Screen
        title="Properties"
        trailing={isLoadedEmpty ? null : trailing}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentStyle={styles.content}
      >
        {hasProperties && (
          <Tooltip
            id={TOOLTIP_IDS.PROPERTY_DETAIL_SCHEDULE}
            userId={user?.id}
            message="Tap any property to see its seasonal schedule, cost estimates, and service history."
            icon="home-outline"
          />
        )}
        {isLoading ? (
          <PropertyListSkeleton />
        ) : (!properties?.length && (isError || fetchStatus === "paused")) ? (
          <LoadErrorState onRetry={refetch} title="Unable to load your properties" body="Your properties are saved and safe. Check your connection and try again." retryAccessibilityLabel="Try loading properties again" />
        ) : properties?.length === 0 ? (
          <EmptyState
            icon="home-outline"
            tone="home"
            title="No properties yet"
            action={{ label: "Add your first property", onPress: guardedAddPropertyPress }}
          />
        ) : (
          properties?.map((p, idx) => {
            const isLocked = idx >= propertyLimit(profile);
            const counts = taskCounts?.[p.id];
            const overdue = counts?.overdue ?? 0;
            const dueSoon = counts?.due_soon ?? 0;
            const statusDotColor = overdue > 0 ? Colors.overdue : dueSoon > 0 ? Colors.dueSoon : null;
            const icon = getPropertyIcon(p.property_type);
            const title = propertyTitle(p);

            const metaParts: string[] = [];
            if (p.year_built) metaParts.push(`Built ${p.year_built}`);
            if (p.square_footage) metaParts.push(`${p.square_footage.toLocaleString()} sqft`);
            const metaLine = metaParts.length > 0
              ? metaParts.join(" · ")
              : (TYPE_LABEL[p.property_type ?? "other"] ?? "Property");

            // Third line: the nearest due task with a relative date, or all caught up.
            // Undefined while task data is still loading → render nothing rather than a false "caught up".
            const nextLine = counts === undefined
              ? null
              : counts.nextTask && counts.nextDue
                ? `${counts.nextIsEstimate ? "Est. " : ""}${counts.nextTask} · ${relativeDue(counts.nextDue)}`
                : "All caught up";
            const nextLineColor = overdue > 0 ? Colors.overdue : Colors.home;

            return (
              <Card
                key={p.id}
                padding={Spacing.md}
                style={isLocked ? styles.lockedCard : null}
                accessibilityLabel={title}
                onPress={() => {
                  if (isLocked) {
                    setPaywallReason("locked_existing");
                    setShowPaywall(true);
                    return;
                  }
                  router.push(`/property/${p.id}` as any);
                }}
              >
                <View style={styles.cardRow}>
                {p.photo_url ? (
                  <Image source={{ uri: p.photo_url }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[styles.thumb, styles.thumbGlyph]}>
                    <Icon name={icon as any} size={28} color={Colors.home} />
                  </View>
                )}

                <View style={styles.cardInfo}>
                  <View style={styles.cardTitleRow}>
                    {statusDotColor && <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />}
                    <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
                  </View>
                  <Text style={styles.cardMeta} numberOfLines={1}>{metaLine}</Text>
                  {nextLine ? (
                    <Text style={[styles.cardNext, { color: nextLineColor }]} numberOfLines={2}>{nextLine}</Text>
                  ) : null}
                  {isLocked && (
                    <Text style={styles.lockedText}>Upgrade to access</Text>
                  )}
                </View>

                <View style={styles.cardRight}>
                  <Icon name="chevron-forward" size={16} color={Colors.textTertiary} />
                </View>
                </View>
              </Card>
            );
          })
        )}
      </Screen>

      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
        <Paywall
          canDismiss
          showSkip={false}
          context={{ vertical: "property", reason: paywallReason }}
          onDismiss={() => setShowPaywall(false)}
        />
      </Modal>
    </View>
  );
}

function PropertyCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
  return (
    <View style={styles.propertyCard}>
      <S anim={anim} w={72} h={72} r={12} />
      <Col flex={1} gap={6}>
        <S anim={anim} w="55%" h={16} r={5} />
        <S anim={anim} w="70%" h={13} r={5} />
        <S anim={anim} w="60%" h={13} r={5} />
      </Col>
      <S anim={anim} w={16} h={16} r={4} />
    </View>
  );
}

function PropertyListSkeleton() {
  const anim = usePulse();
  return (
    <>
      <PropertyCardSkeleton anim={anim} />
      <PropertyCardSkeleton anim={anim} />
      <PropertyCardSkeleton anim={anim} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md },
  cardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  lockedCard: { opacity: 0.5 },

  propertyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
  },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, flexShrink: 0 },
  thumbGlyph: { backgroundColor: Colors.homeMuted, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 3, minWidth: 0 },
  cardNext: { ...Typography.footnote, fontWeight: "500" },
  lockedText: { ...Typography.caption, color: Colors.textTertiary, marginTop: 2 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  cardMeta: { ...Typography.footnote, color: Colors.textSecondary },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  statusDot: { width: 8, height: 8, borderRadius: Radius.pill },
});
