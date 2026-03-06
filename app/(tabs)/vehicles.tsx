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
import { parseISO, isBefore, addDays, differenceInDays } from "date-fns";
import { vehicleLimit } from "@/lib/subscription";

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
  updated_at: string | null;
  average_miles_per_month: number | null;
};

function getTaskStatus(date: string | null): "overdue" | "due_soon" | "good" {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

function getVehicleIcon(type: string | null): string {
  switch (type) {
    case "motorcycle": return "bicycle-outline";
    case "rv":         return "bus-outline";
    case "boat":       return "boat-outline";
    case "atv":        return "trail-sign-outline";
    default:           return "car-outline";
  }
}

function getEstimatedMileage(v: Vehicle): number | null {
  if (!v.mileage || !v.average_miles_per_month || !v.updated_at) return null;
  const daysSince = differenceInDays(new Date(), parseISO(v.updated_at));
  if (daysSince < 7) return null;
  return Math.round(v.mileage + (daysSince / 30.44) * v.average_miles_per_month);
}

export default function VehiclesScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: vehicles, isLoading, refetch } = useQuery({
    queryKey: ["vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("vehicles")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as Vehicle[];
    },
    enabled: !!user,
  });

  const { data: taskData } = useQuery({
    queryKey: ["vehicle_task_data", user?.id, vehicles?.map(v => v.id).join(",")],
    queryFn: async () => {
      if (!user || !vehicles?.length) return {};
      const ids = vehicles.map(v => v.id);
      const { data } = await supabase
        .from("vehicle_maintenance_tasks")
        .select("vehicle_id, next_due_date, mileage_interval")
        .in("vehicle_id", ids);

      const map: Record<string, {
        worstStatus: "overdue" | "due_soon" | "good";
        pendingCount: number;
        hasMileageInterval: boolean;
      }> = {};

      for (const t of data ?? []) {
        if (!map[t.vehicle_id]) {
          map[t.vehicle_id] = { worstStatus: "good", pendingCount: 0, hasMileageInterval: false };
        }
        const s = getTaskStatus(t.next_due_date);
        if (s !== "good") map[t.vehicle_id].pendingCount++;
        if (s === "overdue" || (s === "due_soon" && map[t.vehicle_id].worstStatus === "good")) {
          map[t.vehicle_id].worstStatus = s;
        }
        if (t.mileage_interval) map[t.vehicle_id].hasMileageInterval = true;
      }
      return map;
    },
    enabled: !!(user && vehicles?.length),
  });

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
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}
      >
        {isLoading ? (
          <VehicleListSkeleton />
        ) : vehicles?.length === 0 ? (
          <EmptyVehicles />
        ) : (
          vehicles?.map((v, idx) => {
            const isLocked = idx >= vehicleLimit(profile);
            const td = taskData?.[v.id];
            const worstStatus = td?.worstStatus ?? "good";
            const pendingCount = td?.pendingCount ?? 0;
            const scheduleLabel = td?.hasMileageInterval ? "Manufacturer" : "Standard";
            const estimatedMileage = getEstimatedMileage(v);
            const icon = getVehicleIcon(v.vehicle_type);
            const title = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
            const displayName = v.nickname ?? title;

            return (
              <Pressable
                key={v.id}
                style={({ pressed }) => [styles.vehicleCard, { opacity: pressed ? 0.88 : isLocked ? 0.55 : 1 }]}
                onPress={() => {
                  if (isLocked) {
                    Alert.alert(
                      "Vehicle Locked",
                      "This vehicle is locked on your current plan. Upgrade to access all your vehicles.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Upgrade Now", onPress: () => router.push("/subscription" as any) },
                      ]
                    );
                    return;
                  }
                  Haptics.selectionAsync();
                  router.push(`/vehicle/${v.id}` as any);
                }}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.iconWrap, { backgroundColor: Colors.vehicleMuted }]}>
                    <Ionicons name={icon as any} size={26} color={Colors.vehicle} />
                  </View>
                  <View style={styles.vehicleInfo}>
                    <Text style={styles.vehicleTitle} numberOfLines={1}>{displayName}</Text>
                    {v.nickname && (
                      <Text style={styles.vehicleSubtitle} numberOfLines={1}>{title}</Text>
                    )}
                    {v.trim && !v.nickname && (
                      <Text style={styles.vehicleTrim} numberOfLines={1}>{v.trim}</Text>
                    )}
                    {v.trim && v.nickname && (
                      <Text style={styles.vehicleTrim} numberOfLines={1}>{title} · {v.trim}</Text>
                    )}
                  </View>
                  <View style={styles.badgesCol}>
                    {pendingCount > 0 && (
                      <View style={[
                        styles.tasksBadge,
                        { backgroundColor: worstStatus === "overdue" ? Colors.overdueMuted : Colors.dueSoonMuted },
                      ]}>
                        <View style={[
                          styles.tasksBadgeDot,
                          { backgroundColor: worstStatus === "overdue" ? Colors.overdue : Colors.dueSoon },
                        ]} />
                        <Text style={[
                          styles.tasksBadgeText,
                          { color: worstStatus === "overdue" ? Colors.overdue : Colors.dueSoon },
                        ]}>
                          {pendingCount}
                        </Text>
                      </View>
                    )}
                    {pendingCount === 0 && (
                      <View style={[styles.tasksBadge, { backgroundColor: Colors.goodMuted }]}>
                        <Ionicons name="checkmark" size={10} color={Colors.good} />
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.mileageRow}>
                  <View style={styles.mileagePill}>
                    <Ionicons name="speedometer-outline" size={13} color={Colors.textSecondary} />
                    {v.mileage != null ? (
                      <Text style={styles.mileageText}>{v.mileage.toLocaleString()} mi</Text>
                    ) : (
                      <Text style={styles.mileageTextDim}>No mileage</Text>
                    )}
                  </View>
                  {estimatedMileage != null && (
                    <View style={styles.estimatedPill}>
                      <Ionicons name="trending-up-outline" size={13} color={Colors.accent} />
                      <Text style={styles.estimatedText}>~{estimatedMileage.toLocaleString()} mi est.</Text>
                    </View>
                  )}
                </View>

                <View style={styles.badgesRow}>
                  <View style={[
                    styles.scheduleBadge,
                    scheduleLabel === "Manufacturer"
                      ? styles.scheduleBadgeManufacturer
                      : styles.scheduleBadgeStandard,
                  ]}>
                    <View style={[
                      styles.scheduleDot,
                      { backgroundColor: scheduleLabel === "Manufacturer" ? Colors.blue : Colors.vehicle },
                    ]} />
                    <Text style={[
                      styles.scheduleText,
                      { color: scheduleLabel === "Manufacturer" ? Colors.blue : Colors.vehicle },
                    ]}>
                      {scheduleLabel}
                    </Text>
                  </View>
                  {pendingCount > 0 && (
                    <View style={styles.taskCountBadge}>
                      <Text style={styles.taskCountText}>{pendingCount} task{pendingCount !== 1 ? "s" : ""}</Text>
                    </View>
                  )}
                </View>

                {!isLocked && (
                  <View style={styles.cardActions}>
                    <Pressable
                      style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.8 : 1 }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push(`/log-service/${v.id}` as any);
                      }}
                    >
                      <Ionicons name="construct-outline" size={14} color={Colors.vehicle} />
                      <Text style={styles.actionBtnAccentText}>Log Service</Text>
                    </Pressable>
                  </View>
                )}
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

function VehicleCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
  return (
    <View style={[styles.vehicleCard, { gap: 14 }]}>
      <Row gap={12} align="flex-start">
        <S anim={anim} w={54} h={54} r={15} />
        <Col flex={1} gap={5}>
          <S anim={anim} w="60%" h={17} r={6} />
          <S anim={anim} w="40%" h={13} r={5} />
        </Col>
        <S anim={anim} w={28} h={24} r={8} />
      </Row>
      <Row gap={8}>
        <S anim={anim} w={90} h={28} r={8} />
      </Row>
      <Row gap={8}>
        <S anim={anim} w={80} h={24} r={8} />
        <S anim={anim} w={64} h={24} r={8} />
      </Row>
      <Row gap={8}>
        <S anim={anim} flex={1} h={44} r={11} />
        <S anim={anim} flex={1} h={44} r={11} />
      </Row>
    </View>
  );
}

function VehicleListSkeleton() {
  const anim = usePulse();
  return (
    <>
      <VehicleCardSkeleton anim={anim} />
      <VehicleCardSkeleton anim={anim} />
    </>
  );
}

function EmptyVehicles() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="car-outline" size={36} color={Colors.vehicle} />
        </View>
        <Text style={styles.emptyTitle}>No vehicles yet</Text>
        <Text style={styles.emptyText}>Add your car, truck, or motorcycle to start tracking service intervals and costs.</Text>
        <Pressable
          style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-vehicle"); }}
        >
          <Ionicons name="add" size={20} color={Colors.textInverse} />
          <Text style={styles.emptyBtnText}>Add Vehicle</Text>
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
    backgroundColor: Colors.vehicle,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },

  vehicleCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    gap: 14,
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
  vehicleInfo: { flex: 1, gap: 2 },
  vehicleTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 22 },
  vehicleSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  vehicleTrim: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  badgesCol: { alignItems: "flex-end", gap: 5, flexShrink: 0 },
  tasksBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 28,
    justifyContent: "center",
  },
  tasksBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  tasksBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },

  mileageRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  mileagePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  mileageText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.text },
  mileageTextDim: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  estimatedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.accentLight,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  estimatedText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent },
  badgesRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scheduleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
  },
  scheduleBadgeManufacturer: {
    backgroundColor: Colors.blueMuted,
    borderColor: Colors.blue + "44",
  },
  scheduleBadgeStandard: {
    backgroundColor: Colors.vehicleMuted,
    borderColor: Colors.vehicle + "44",
  },
  scheduleDot: { width: 5, height: 5, borderRadius: 2.5 },
  scheduleText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  taskCountBadge: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  taskCountText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.textSecondary },

  cardActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: Colors.surface,
    borderRadius: 11,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 44,
  },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  actionBtnAccent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: Colors.vehicleMuted,
    borderRadius: 11,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.vehicle + "40",
    minHeight: 44,
  },
  actionBtnAccentText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.vehicle },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 4, paddingBottom: 2 },
  lockedText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontStyle: "italic" },

  emptyWrap: { flex: 1, paddingTop: 24 },
  emptyCard: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.vehicle + "55",
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
    backgroundColor: Colors.vehicleMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 21 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.vehicle,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginTop: 8,
    minHeight: 44,
  },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
