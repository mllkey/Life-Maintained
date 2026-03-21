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
  Image,
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
import { parseISO, isBefore, addDays, differenceInDays, formatDistanceToNowStrict } from "date-fns";
import { vehicleLimit } from "@/lib/subscription";
import { MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";

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
  season_start_month: number | null;
  season_end_month: number | null;
  vehicle_category: string | null;
  updated_at: string | null;
  average_miles_per_month: number | null;
  photo_url: string | null;
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
    case "utv":        return "trail-sign-outline";
    case "pwc":        return "water-outline";
    case "snowmobile": return "snow-outline";
    default:           return "car-outline";
  }
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
        .from("user_vehicle_maintenance_tasks")
        .select("vehicle_id, next_due_date, interval_miles")
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
        if (t.interval_miles) map[t.vehicle_id].hasMileageInterval = true;
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
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/add-vehicle");
          }}
          accessibilityLabel="Add a new vehicle"
          accessibilityRole="button"
        >
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0), flexGrow: 1 }]}
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
            const icon = getVehicleIcon(v.vehicle_type);
            const title = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
            const displayName = v.nickname ?? title;

            const isMileageTracked = MILEAGE_TRACKED_TYPES.has(v.vehicle_type ?? "");
            const daysSinceUpdate = v.updated_at ? differenceInDays(new Date(), parseISO(v.updated_at)) : null;
            const isStale = daysSinceUpdate != null && daysSinceUpdate >= 7;

            let metaLine: string;
            if (isMileageTracked && v.mileage != null) {
              const mileStr = v.mileage.toLocaleString() + " mi";
              metaLine = isStale
                ? mileStr + " · Update needed"
                : daysSinceUpdate != null
                  ? mileStr + " · " + formatDistanceToNowStrict(parseISO(v.updated_at!), { addSuffix: true })
                  : mileStr;
            } else {
              const typeLabel = v.vehicle_type
                ? v.vehicle_type.charAt(0).toUpperCase() + v.vehicle_type.slice(1)
                : "Vehicle";
              metaLine = v.nickname ? title || typeLabel : typeLabel;
            }

            const statusDotColor = worstStatus === "overdue"
              ? Colors.overdue
              : worstStatus === "due_soon"
                ? Colors.dueSoon
                : null;

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
                {v.photo_url ? (
                  <Image source={{ uri: v.photo_url }} style={{ width: 36, height: 36, borderRadius: 10 }} resizeMode="cover" />
                ) : (
                  <Ionicons name={icon as any} size={18} color={Colors.vehicle} />
                )}
                <View style={styles.vehicleInfo}>
                  <View style={styles.vehicleTitleRow}>
                    {statusDotColor && <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />}
                    <Text style={styles.vehicleTitle} numberOfLines={1}>{displayName}</Text>
                  </View>
                  <Text
                    style={[styles.vehicleMeta, isStale && isMileageTracked && v.mileage != null && { color: Colors.dueSoon }]}
                    numberOfLines={1}
                  >
                    {metaLine}
                  </Text>
                  {isLocked && (
                    <View style={styles.lockedRow}>
                      <Ionicons name="lock-closed" size={11} color={Colors.textTertiary} />
                      <Text style={styles.lockedText}>Upgrade to access</Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardRight}>
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

function VehicleCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
  return (
    <View style={styles.vehicleCard}>
      <S anim={anim} w={36} h={36} r={10} />
      <Col flex={1} gap={5}>
        <S anim={anim} w="55%" h={16} r={5} />
        <S anim={anim} w="75%" h={13} r={5} />
      </Col>
      <S anim={anim} w={16} h={16} r={4} />
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
      <Text style={styles.emptyTitle}>No vehicles yet</Text>
      <Pressable
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-vehicle"); }}
      >
        <Text style={styles.emptyLink}>Add your first vehicle</Text>
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
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  addText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },

  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  vehicleInfo: { flex: 1, gap: 3, minWidth: 0 },
  vehicleTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  vehicleTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  vehicleMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  cardRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  lockedText: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },

  emptyWrap: { flex: 1, paddingTop: 60, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  emptyLink: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },
});
