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
              <Pressable
                key={p.id}
                style={({ pressed }) => [
                  styles.propertyCard,
                  { opacity: pressed ? 0.88 : isLocked ? 0.5 : 1 },
                ]}
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
                <View style={[styles.iconWrap, { backgroundColor: Colors.homeMuted }]}>
                  <Ionicons name={icon as any} size={18} color={Colors.home} />
                </View>

                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{label}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>{metaLine}</Text>
                </View>

                <View style={styles.cardRight}>
                  {overdue > 0 && (
                    <Text style={styles.statusOverdue}>{overdue} overdue</Text>
                  )}
                  {overdue === 0 && dueSoon > 0 && (
                    <Text style={styles.statusDueSoon}>{dueSoon} upcoming</Text>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                </View>
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

function EmptyProperties() {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>No properties yet</Text>
      <Text style={styles.emptyText}>Add your first property</Text>
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
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.home,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },

  propertyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardInfo: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  statusOverdue: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.overdue },
  statusDueSoon: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.dueSoon },

  emptyWrap: { paddingTop: 60, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.accent },
});
