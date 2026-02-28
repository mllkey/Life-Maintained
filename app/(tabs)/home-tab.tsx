import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, differenceInDays } from "date-fns";

type Property = {
  id: string;
  address: string | null;
  property_type: string | null;
  year_built: number | null;
  square_footage: number | null;
  nickname: string | null;
};

function getStatus(date: string | null) {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

const PROPERTY_ICONS: Record<string, string> = {
  house: "home-outline",
  condo: "business-outline",
  apartment: "business-outline",
  townhouse: "home-outline",
  commercial: "storefront-outline",
  vacation: "sunny-outline",
  other: "home-outline",
};

export default function HomeTabScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: properties, isLoading, refetch } = useQuery({
    queryKey: ["properties", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("properties").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return (data ?? []) as Property[];
    },
    enabled: !!user,
  });

  const { data: taskCounts } = useQuery({
    queryKey: ["property_task_counts", user?.id],
    queryFn: async () => {
      if (!user || !properties?.length) return {};
      const ids = properties.map(p => p.id);
      const { data } = await supabase.from("property_maintenance_tasks").select("property_id, next_due_date").in("property_id", ids);
      const map: Record<string, { overdue: number; due_soon: number; total: number }> = {};
      for (const t of data ?? []) {
        if (!map[t.property_id]) map[t.property_id] = { overdue: 0, due_soon: 0, total: 0 };
        map[t.property_id].total++;
        const s = getStatus(t.next_due_date);
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
        <Text style={styles.title}>Home</Text>
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
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}
      >
        {isLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : properties?.length === 0 ? (
          <EmptyProperties />
        ) : (
          properties?.map(p => {
            const counts = taskCounts?.[p.id];
            const worstStatus =
              (counts?.overdue ?? 0) > 0 ? "overdue" :
              (counts?.due_soon ?? 0) > 0 ? "due_soon" : "good";
            const statusColor = worstStatus === "overdue" ? Colors.overdue : worstStatus === "due_soon" ? Colors.dueSoon : Colors.good;
            const icon = PROPERTY_ICONS[p.property_type ?? "other"] ?? "home-outline";

            return (
              <Pressable
                key={p.id}
                style={({ pressed }) => [styles.propertyCard, { opacity: pressed ? 0.88 : 1 }]}
                onPress={() => router.push(`/property/${p.id}` as any)}
              >
                <View style={styles.propertyCardTop}>
                  <View style={[styles.propertyIcon, { backgroundColor: Colors.homeMuted }]}>
                    <Ionicons name={icon as any} size={26} color={Colors.home} />
                  </View>
                  <View style={styles.propertyInfo}>
                    <Text style={styles.propertyName} numberOfLines={1}>
                      {p.nickname ?? p.address ?? "Property"}
                    </Text>
                    {p.nickname && p.address && (
                      <Text style={styles.propertyAddress} numberOfLines={1}>{p.address}</Text>
                    )}
                  </View>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                </View>

                <View style={styles.propertyMeta}>
                  {p.property_type && (
                    <MetaPill icon="pricetag-outline" label={p.property_type} />
                  )}
                  {p.year_built && (
                    <MetaPill icon="calendar-outline" label={`Built ${p.year_built}`} />
                  )}
                  {p.square_footage && (
                    <MetaPill icon="resize-outline" label={`${p.square_footage.toLocaleString()} sqft`} />
                  )}
                </View>

                {counts && (
                  <View style={styles.taskSummary}>
                    {(counts.overdue > 0 || counts.due_soon > 0) ? (
                      <>
                        {counts.overdue > 0 && (
                          <View style={[styles.taskBadge, { backgroundColor: Colors.overdueMuted }]}>
                            <Text style={[styles.taskBadgeText, { color: Colors.overdue }]}>{counts.overdue} overdue</Text>
                          </View>
                        )}
                        {counts.due_soon > 0 && (
                          <View style={[styles.taskBadge, { backgroundColor: Colors.dueSoonMuted }]}>
                            <Text style={[styles.taskBadgeText, { color: Colors.dueSoon }]}>{counts.due_soon} due soon</Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={[styles.taskBadge, { backgroundColor: Colors.goodMuted }]}>
                        <Text style={[styles.taskBadgeText, { color: Colors.good }]}>{counts.total} tasks — all good</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }} />
                    <Pressable
                      style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        router.push(`/add-property-task/${p.id}` as any);
                      }}
                    >
                      <Ionicons name="add" size={14} color={Colors.home} />
                      <Text style={styles.addTaskBtnText}>Add Task</Text>
                    </Pressable>
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

function MetaPill({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={12} color={Colors.textTertiary} />
      <Text style={styles.metaPillText}>{label}</Text>
    </View>
  );
}

function EmptyProperties() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="home-outline" size={40} color={Colors.home} />
      </View>
      <Text style={styles.emptyTitle}>No properties yet</Text>
      <Text style={styles.emptyText}>Add your home or other properties to track HVAC, roof, appliances, and more.</Text>
      <Pressable
        style={({ pressed }) => [styles.emptyButton, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push("/add-property")}
      >
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.emptyButtonText}>Add Property</Text>
      </Pressable>
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
  },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  addButton: { width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.home, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  propertyCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  propertyCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  propertyIcon: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  propertyInfo: { flex: 1 },
  propertyName: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  propertyAddress: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  propertyMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  metaPillText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textTransform: "capitalize" },
  taskSummary: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  taskBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  taskBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  addTaskBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.homeMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  addTaskBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.home },
  empty: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 32, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: Colors.homeMuted, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  emptyButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.home, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyButtonText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
