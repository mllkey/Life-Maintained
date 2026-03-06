import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  Platform,
  Alert,
} from "react-native";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays } from "date-fns";
import { propertyLimit } from "@/lib/subscription";

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
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: properties, isLoading, refetch } = useQuery({
    queryKey: ["properties", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("properties")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as Property[];
    },
    enabled: !!user,
  });

  const { data: taskCounts } = useQuery({
    queryKey: ["property_task_counts", user?.id, properties?.map(p => p.id).join(",")],
    queryFn: async () => {
      if (!user || !properties?.length) return {};
      const ids = properties.map(p => p.id);
      const { data } = await supabase
        .from("property_maintenance_tasks")
        .select("property_id, next_due_date, last_completed_at")
        .in("property_id", ids);

      const map: Record<string, { overdue: number; due_soon: number; total: number }> = {};
      for (const t of data ?? []) {
        if (!map[t.property_id]) map[t.property_id] = { overdue: 0, due_soon: 0, total: 0 };
        map[t.property_id].total++;
        const s = getStatus(t.next_due_date, t.last_completed_at);
        if (s === "overdue") map[t.property_id].overdue++;
        else if (s === "due_soon") map[t.property_id].due_soon++;
      }
      return map;
    },
    enabled: !!(user && properties?.length),
  });

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Properties</Text>
        <Pressable
          style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/add-property");
          }}
        >
          <Ionicons name="add" size={22} color={Colors.textInverse} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}
      >
        {isLoading ? (
          <PropertyListSkeleton />
        ) : properties?.length === 0 ? (
          <EmptyProperties />
        ) : (
          properties?.map((p, idx) => {
            const isLocked = idx >= propertyLimit(profile);
            const counts = taskCounts?.[p.id];
            const overdue = counts?.overdue ?? 0;
            const dueSoon = counts?.due_soon ?? 0;
            const total = counts?.total ?? 0;
            const isMyHome = !!p.is_primary_residence;
            const icon = getPropertyIcon(p.property_type);
            const label = getPropertyLabel(p);

            return (
              <Pressable
                key={p.id}
                style={({ pressed }) => [styles.propertyCard, { opacity: pressed ? 0.88 : isLocked ? 0.55 : 1 }]}
                onPress={() => {
                  if (isLocked) {
                    Alert.alert(
                      "Property Locked",
                      "This property is locked on your current plan. Upgrade to access all your properties.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Upgrade Now", onPress: () => router.push("/subscription" as any) },
                      ]
                    );
                    return;
                  }
                  Haptics.selectionAsync();
                  router.push(`/property/${p.id}` as any);
                }}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.iconWrap, { backgroundColor: Colors.homeMuted }]}>
                    <Ionicons name={icon as any} size={26} color={Colors.home} />
                  </View>

                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{label}</Text>
                    {p.address && (
                      <Text style={styles.cardAddress} numberOfLines={1}>{p.address}</Text>
                    )}
                  </View>

                  {isMyHome && (
                    <View style={styles.myHomeBadge}>
                      <Ionicons name="home" size={10} color={Colors.home} />
                      <Text style={styles.myHomeBadgeText}>My Home</Text>
                    </View>
                  )}
                </View>

                {(p.year_built || p.square_footage) && (
                  <View style={styles.metaRow}>
                    {p.year_built && (
                      <View style={styles.metaPill}>
                        <Ionicons name="calendar-outline" size={11} color={Colors.textTertiary} />
                        <Text style={styles.metaPillText}>Built {p.year_built}</Text>
                      </View>
                    )}
                    {p.square_footage && (
                      <View style={styles.metaPill}>
                        <Ionicons name="resize-outline" size={11} color={Colors.textTertiary} />
                        <Text style={styles.metaPillText}>{p.square_footage.toLocaleString()} sqft</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.statusRow}>
                  {overdue > 0 && (
                    <View style={[styles.statusBadge, { backgroundColor: Colors.overdueMuted }]}>
                      <View style={[styles.statusDot, { backgroundColor: Colors.overdue }]} />
                      <Text style={[styles.statusBadgeText, { color: Colors.overdue }]}>
                        {overdue} overdue
                      </Text>
                    </View>
                  )}
                  {dueSoon > 0 && (
                    <View style={[styles.statusBadge, { backgroundColor: Colors.dueSoonMuted }]}>
                      <View style={[styles.statusDot, { backgroundColor: Colors.dueSoon }]} />
                      <Text style={[styles.statusBadgeText, { color: Colors.dueSoon }]}>
                        {dueSoon} upcoming
                      </Text>
                    </View>
                  )}
                  {overdue === 0 && dueSoon === 0 && total > 0 && (
                    <View style={[styles.statusBadge, { backgroundColor: Colors.goodMuted }]}>
                      <Ionicons name="checkmark-circle" size={11} color={Colors.good} />
                      <Text style={[styles.statusBadgeText, { color: Colors.good }]}>All caught up</Text>
                    </View>
                  )}
                  {total === 0 && (
                    <View style={[styles.statusBadge, { backgroundColor: Colors.surface }]}>
                      <Text style={[styles.statusBadgeText, { color: Colors.textTertiary }]}>No tasks yet</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  {!isLocked && (
                    <Pressable
                      style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push(`/add-property-task/${p.id}` as any);
                      }}
                    >
                      <Ionicons name="add" size={14} color={Colors.home} />
                      <Text style={styles.addTaskBtnText}>Add Task</Text>
                    </Pressable>
                  )}
                </View>
                {isLocked && (
                  <View style={styles.lockedRow}>
                    <Ionicons name="lock-closed" size={12} color={Colors.textTertiary} />
                    <Text style={styles.lockedText}>Locked — upgrade to access</Text>
                  </View>
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function PropertyCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
  return (
    <View style={[styles.propertyCard, { gap: 12 }]}>
      <Row gap={12} align="flex-start">
        <S anim={anim} w={54} h={54} r={15} />
        <Col flex={1} gap={5}>
          <S anim={anim} w="55%" h={17} r={6} />
          <S anim={anim} w="75%" h={13} r={5} />
        </Col>
        <S anim={anim} w={60} h={24} r={8} />
      </Row>
      <Row gap={6}>
        <S anim={anim} w={80} h={24} r={8} />
        <S anim={anim} w={80} h={24} r={8} />
      </Row>
      <Row gap={6}>
        <S anim={anim} w={88} h={28} r={9} />
        <View style={{ flex: 1 }} />
        <S anim={anim} w={72} h={30} r={8} />
      </Row>
    </View>
  );
}

function PropertyListSkeleton() {
  const anim = usePulse();
  return (
    <>
      <PropertyCardSkeleton anim={anim} />
      <PropertyCardSkeleton anim={anim} />
    </>
  );
}

function EmptyProperties() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="home-outline" size={36} color={Colors.home} />
        </View>
        <Text style={styles.emptyTitle}>No properties yet</Text>
        <Text style={styles.emptyText}>Add your home or other properties to track HVAC, roof, appliances, and more.</Text>
        <Pressable
          style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-property"); }}
        >
          <Ionicons name="add" size={20} color={Colors.textInverse} />
          <Text style={styles.emptyBtnText}>Add Property</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.background,
  },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.home,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },

  propertyCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 22 },
  cardAddress: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  myHomeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.homeMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  myHomeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.home },

  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaPillText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.homeMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 30,
  },
  addTaskBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.home },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 4, paddingBottom: 2 },
  lockedText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontStyle: "italic" },

  emptyWrap: { paddingTop: 24 },
  emptyCard: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.home + "55",
    borderRadius: 20,
    backgroundColor: Colors.card,
    marginHorizontal: 4,
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.homeMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 21 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.home,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginTop: 8,
    minHeight: 44,
  },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
