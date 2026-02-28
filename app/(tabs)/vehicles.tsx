import React, { useState } from "react";
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
import { parseISO, isBefore, addDays } from "date-fns";

type Vehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vehicle_type: string | null;
  mileage: number | null;
  color: string | null;
  nickname: string | null;
  is_seasonal: boolean | null;
  vehicle_category: string | null;
};

function getTaskStatus(date: string | null) {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function VehiclesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: vehicles, isLoading, refetch } = useQuery({
    queryKey: ["vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("vehicles").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: taskStatuses } = useQuery({
    queryKey: ["vehicle_task_statuses", user?.id],
    queryFn: async () => {
      if (!user || !vehicles?.length) return {};
      const ids = vehicles.map(v => v.id);
      const { data } = await supabase.from("vehicle_maintenance_tasks").select("vehicle_id, next_due_date").in("vehicle_id", ids);
      const map: Record<string, "overdue" | "due_soon" | "good"> = {};
      for (const t of data ?? []) {
        const s = getTaskStatus(t.next_due_date);
        const current = map[t.vehicle_id] ?? "good";
        if (s === "overdue" || (s === "due_soon" && current === "good")) {
          map[t.vehicle_id] = s;
        }
      }
      return map;
    },
    enabled: !!(user && vehicles?.length),
  });

  function getVehicleIcon(type: string | null) {
    switch (type) {
      case "motorcycle": case "superbike": return "bicycle-outline";
      case "truck": return "car-sport-outline";
      case "rv": return "bus-outline";
      case "boat": return "boat-outline";
      default: return "car-outline";
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Vehicles</Text>
        <Pressable
          style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/add-vehicle");
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
        ) : vehicles?.length === 0 ? (
          <EmptyVehicles />
        ) : (
          vehicles?.map(v => {
            const status = taskStatuses?.[v.id] ?? "good";
            const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
            return (
              <Pressable
                key={v.id}
                style={({ pressed }) => [styles.vehicleCard, { opacity: pressed ? 0.88 : 1 }]}
                onPress={() => router.push(`/vehicle/${v.id}` as any)}
              >
                <View style={styles.vehicleCardTop}>
                  <View style={[styles.vehicleIcon, { backgroundColor: Colors.vehicleMuted }]}>
                    <Ionicons name={getVehicleIcon(v.vehicle_type) as any} size={26} color={Colors.vehicle} />
                  </View>
                  <View style={styles.vehicleInfo}>
                    <Text style={styles.vehicleName} numberOfLines={1}>
                      {v.nickname ?? `${v.year} ${v.make} ${v.model}`}
                    </Text>
                    {v.nickname && (
                      <Text style={styles.vehicleSubname}>{`${v.year} ${v.make} ${v.model}`}</Text>
                    )}
                  </View>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                </View>

                <View style={styles.vehicleStats}>
                  {v.mileage != null && (
                    <StatPill icon="speedometer-outline" label={`${v.mileage.toLocaleString()} mi`} />
                  )}
                  {v.vehicle_type && (
                    <StatPill icon="pricetag-outline" label={v.vehicle_type} />
                  )}
                  {v.is_seasonal && (
                    <StatPill icon="sunny-outline" label="Seasonal" />
                  )}
                </View>

                <View style={styles.vehicleActions}>
                  <Pressable
                    style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push(`/update-mileage/${v.id}` as any);
                    }}
                  >
                    <Ionicons name="speedometer-outline" size={14} color={Colors.textSecondary} />
                    <Text style={styles.actionBtnText}>Update Mileage</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.actionBtnAccent, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push(`/log-service/${v.id}` as any);
                    }}
                  >
                    <Ionicons name="construct-outline" size={14} color={Colors.textInverse} />
                    <Text style={styles.actionBtnAccentText}>Log Service</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function StatPill({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon} size={12} color={Colors.textTertiary} />
      <Text style={styles.statPillText}>{label}</Text>
    </View>
  );
}

function EmptyVehicles() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="car-outline" size={40} color={Colors.vehicle} />
      </View>
      <Text style={styles.emptyTitle}>No vehicles yet</Text>
      <Text style={styles.emptyText}>Add your car, truck, motorcycle, or any other vehicle to start tracking maintenance.</Text>
      <Pressable
        style={({ pressed }) => [styles.emptyButton, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push("/add-vehicle")}
      >
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.emptyButtonText}>Add Vehicle</Text>
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
    backgroundColor: Colors.background,
  },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  vehicleCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  vehicleIcon: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  vehicleInfo: { flex: 1 },
  vehicleName: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  vehicleSubname: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  vehicleStats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statPillText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  vehicleActions: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 9, borderWidth: 1, borderColor: Colors.border },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  actionBtnAccent: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 9 },
  actionBtnAccentText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textInverse },
  empty: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 32, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: Colors.vehicleMuted, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  emptyButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.vehicle, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyButtonText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
