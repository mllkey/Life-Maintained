import React, { useState, useCallback} from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  RefreshControl,
  Modal,
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
import { parseISO, isBefore, addDays } from "date-fns";
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
};

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

function getPropertyLabel(p: Property): string {
  if (p.nickname) return p.nickname;
  const typeLabel: Record<string, string> = {
    house: "House", condo: "Condo", apartment: "Apartment",
    townhouse: "Townhouse", commercial: "Commercial Building",
    vacation: "Vacation Home", other: "Property",
  };
  return typeLabel[p.property_type ?? "other"] ?? "Property";
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
        .select("property_id, next_due_date, last_completed_at, last_completed_source, created_at")
        .in("property_id", ids);
      if (error) throw error;

      const map: Record<string, { overdue: number; due_soon: number; total: number }> = {};
      for (const t of data ?? []) {
        if (!map[t.property_id]) map[t.property_id] = { overdue: 0, due_soon: 0, total: 0 };
        map[t.property_id].total++;
        // ESTIMATED tasks carry no urgency; they never drive the card badge.
        if (propertyTaskCalibrationState(t) === "estimated") continue;
        const s = getStatus(t.next_due_date, t.last_completed_at);
        if (s === "overdue") map[t.property_id].overdue++;
        else if (s === "due_soon") map[t.property_id].due_soon++;
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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Screen
        title="Properties"
        trailing={trailing}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentStyle={styles.content}
      >
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
            const label = getPropertyLabel(p);

            const metaParts: string[] = [];
            if (p.year_built) metaParts.push(`Built ${p.year_built}`);
            if (p.square_footage) metaParts.push(`${p.square_footage.toLocaleString()} sqft`);
            const typeLabel: Record<string, string> = {
              house: "Single Family Home", condo: "Condo", apartment: "Apartment",
              townhouse: "Townhouse", commercial: "Commercial Building",
              vacation: "Vacation Home", other: "Property",
            };
            const metaLine = metaParts.length > 0
              ? metaParts.join(" · ")
              : (typeLabel[p.property_type ?? "other"] ?? "Property");

            return (
              <Card
                key={p.id}
                padding={Spacing.lg}
                style={isLocked ? styles.lockedCard : null}
                accessibilityLabel={label}
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
                <Icon name={icon as any} size={18} color={Colors.textSecondary} />

                <View style={styles.cardInfo}>
                  <View style={styles.cardTitleRow}>
                    {statusDotColor && <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />}
                    <Text style={styles.cardTitle} numberOfLines={1}>{label}</Text>
                  </View>
                  <Text style={styles.cardMeta} numberOfLines={1}>{metaLine}</Text>
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
      <S anim={anim} w={36} h={36} r={10} />
      <Col flex={1} gap={6}>
        <S anim={anim} w="55%" h={16} r={5} />
        <S anim={anim} w="70%" h={13} r={5} />
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
  cardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.lg },
  lockedCard: { opacity: 0.5 },

  propertyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
  },
  cardInfo: { flex: 1, gap: 4 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  cardMeta: { ...Typography.footnote, color: Colors.textSecondary },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  statusDot: { width: 8, height: 8, borderRadius: Radius.pill },
});
