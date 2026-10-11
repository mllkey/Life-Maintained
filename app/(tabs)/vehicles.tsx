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
import { Icon, MciIcon, type IconName } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, differenceInDays, differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";
import { vehicleLimit } from "@/lib/subscription";
import { resolveTrackingMode, isHoursTracked, isMileageTracked, currentUsageValue, projectedMileage, projectedHours } from "@/lib/usageHelpers";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import Paywall from "@/components/Paywall";
import LoadErrorState from "@/components/LoadErrorState";
import { vehicleGlyph } from "@/lib/vehicleIcons";
import { vehicleTaskCalibrationState } from "@/lib/calibration";

type Vehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vehicle_type: string | null;
  mileage: number | null;
  hours: number | null;
  color: string | null;
  nickname: string | null;
  is_seasonal: boolean | null;
  season_start_month: number | null;
  season_end_month: number | null;
  vehicle_category: string | null;
  updated_at: string | null;
  average_miles_per_month: number | null;
  last_mileage_update: string | null;
  last_hours_update: string | null;
  photo_url: string | null;
  tracking_mode: string | null;
};

/** "in 8 days" / "today" / "3 days overdue" from a date-only or ISO string. */
function relativeDue(dateStr: string): string {
  const days = differenceInCalendarDays(parseISO(dateStr), new Date());
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
}

function getTaskStatus(date: string | null): "overdue" | "due_soon" | "good" {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function VehiclesScreen() {
  const { user, profile } = useAuth();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState<"limit_reached" | "locked_existing">("limit_reached");

  const { data: vehicles, isLoading, isError, fetchStatus, refetch } = useQuery({
    queryKey: ["vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Vehicle[];
    },
    enabled: !!user,
  });

  const { data: taskData } = useQuery({
    queryKey: ["vehicle_task_data", user?.id, vehicles?.map(v => v.id).join(",")],
    queryFn: async () => {
      if (!user || !vehicles?.length) return {};
      const ids = vehicles.map(v => v.id);
      const { data, error } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("vehicle_id, name, next_due_date, interval_miles, last_completed_date, last_completed_miles, last_completed_hours, last_completed_source, created_at")
        .in("vehicle_id", ids);
      if (error) throw error;

      const map: Record<string, {
        worstStatus: "overdue" | "due_soon" | "good";
        pendingCount: number;
        hasMileageInterval: boolean;
        nextTask: string | null;
        nextDue: string | null;
        nextIsEstimate: boolean;
        estTask: string | null;
        estDue: string | null;
      }> = {};

      for (const t of data ?? []) {
        if (!map[t.vehicle_id]) {
          map[t.vehicle_id] = { worstStatus: "good", pendingCount: 0, hasMileageInterval: false, nextTask: null, nextDue: null, nextIsEstimate: false, estTask: null, estDue: null };
        }
        const entry = map[t.vehicle_id];
        // ESTIMATED tasks carry no urgency; they never drive the card status. They only
        // feed the row's third line as a fallback (prefixed "Est.") when nothing confirmed is dated.
        if (vehicleTaskCalibrationState(t) === "estimated") {
          if (t.interval_miles) entry.hasMileageInterval = true;
          if (t.next_due_date && (entry.estDue == null || t.next_due_date < entry.estDue)) { entry.estDue = t.next_due_date; entry.estTask = t.name; }
          continue;
        }
        const s = getTaskStatus(t.next_due_date);
        if (s !== "good") entry.pendingCount++;
        if (s === "overdue" || (s === "due_soon" && entry.worstStatus === "good")) {
          entry.worstStatus = s;
        }
        if (t.interval_miles) entry.hasMileageInterval = true;
        // Nearest dated confirmed task (overdue first, then soonest) feeds the row's third line.
        if (t.next_due_date && (entry.nextDue == null || t.next_due_date < entry.nextDue)) { entry.nextDue = t.next_due_date; entry.nextTask = t.name; }
      }
      for (const entry of Object.values(map)) {
        if (entry.nextTask == null && entry.estTask) { entry.nextTask = entry.estTask; entry.nextDue = entry.estDue; entry.nextIsEstimate = true; }
      }
      return map;
    },
    enabled: !!(user && vehicles?.length),
  });


  const guardedAddVehiclePress = useCallback(() => {
    const count = vehicles?.length ?? 0;
    if (count >= vehicleLimit(profile)) {
      setPaywallReason("limit_reached");
      setShowPaywall(true);
      return;
    }
    router.push('/add-vehicle');
  }, [vehicles, profile, router, setShowPaywall]);

  const trailing = (
    <>
          <Pressable
            style={({ pressed }) => [{ padding: 8, borderRadius: Radius.md, borderWidth: 1,
              borderColor: Colors.border, backgroundColor: Colors.card,
              opacity: pressed ? 0.85 : 1 }]}
            hitSlop={6}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/import-fleet"); }}
            accessibilityRole="button"
            accessibilityLabel="Import vehicles from a file"
          >
            <Icon name="arrow-down-circle-outline" size={18} color={Colors.text} />
          </Pressable>
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
              guardedAddVehiclePress();
            }}
            accessibilityLabel="Add a new vehicle"
            accessibilityRole="button"
          >
            <Icon name="add" size={18} color={Colors.textInverse} />
            <Text style={{ ...Typography.footnote, fontWeight: "600", color: Colors.textInverse }}>Vehicle</Text>
          </Pressable>
    </>
  );

  // One add affordance per state: the loaded-empty state shows only the
  // centered EmptyState (its CTA), so the header pill + import icon hide there.
  // Error/offline states keep the header actions (they have no inline CTA).
  const isLoadedEmpty = !isLoading && vehicles?.length === 0;
  const hasVehicles = (vehicles?.length ?? 0) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Screen
        title="Vehicles"
        trailing={isLoadedEmpty ? null : trailing}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentStyle={styles.content}
      >
        {hasVehicles && (
          <Tooltip
            id={TOOLTIP_IDS.VEHICLES_FIRST_VISIT}
            userId={user?.id}
            message="Tap any vehicle to see its full maintenance schedule, cost estimates, and service history."
            icon="car-sport-outline"
          />
        )}
        {isLoading ? (
          <VehicleListSkeleton />
        ) : (!vehicles?.length && (isError || fetchStatus === "paused")) ? (
          <LoadErrorState onRetry={refetch} title="Unable to load your vehicles" body="Your vehicles are saved and safe. Check your connection and try again." retryAccessibilityLabel="Try loading vehicles again" />
        ) : vehicles?.length === 0 ? (
          <EmptyState
            icon="car-outline"
            tone="vehicle"
            title="No vehicles yet"
            action={{ label: "Add your first vehicle", onPress: guardedAddVehiclePress }}
            secondaryAction={{ label: "or import from a spreadsheet", onPress: () => router.push("/import-fleet") }}
          />
        ) : (
          vehicles?.map((v, idx) => {
            const isLocked = idx >= vehicleLimit(profile);
            const td = taskData?.[v.id];
            const worstStatus = td?.worstStatus ?? "good";
            const icon = vehicleGlyph(v.vehicle_type);
            const title = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
            const displayName = v.nickname ?? title;

            const mode = resolveTrackingMode(v);
            const tracksMiles = isMileageTracked(v);
            const tracksHrs = isHoursTracked(v);
            const daysSinceUpdate = v.updated_at ? differenceInDays(new Date(), parseISO(v.updated_at)) : null;
            const isStale = daysSinceUpdate != null && daysSinceUpdate >= 7;

            let metaLine: string;
            if (mode === "both") {
              const parts: string[] = [];
              if (v.mileage != null) parts.push((projectedMileage(v) ?? v.mileage).toLocaleString() + " mi");
              if (v.hours != null) parts.push((projectedHours(v) ?? v.hours).toLocaleString() + " hrs");
              if (parts.length) {
                const joined = parts.join(" · ");
                metaLine = isStale
                  ? joined + " · Update needed"
                  : daysSinceUpdate != null
                    ? joined + " · " + formatDistanceToNowStrict(parseISO(v.updated_at!), { addSuffix: true })
                    : joined;
              } else {
                metaLine = "No mileage or hours entered yet";
              }
            } else if (tracksMiles && v.mileage != null) {
              const mileStr = (projectedMileage(v) ?? v.mileage).toLocaleString() + " mi";
              metaLine = isStale
                ? mileStr + " · Update needed"
                : daysSinceUpdate != null
                  ? mileStr + " · " + formatDistanceToNowStrict(parseISO(v.updated_at!), { addSuffix: true })
                  : mileStr;
            } else if (tracksMiles) {
              metaLine = "No mileage entered yet";
            } else if (tracksHrs && v.hours != null) {
              const hourStr = (projectedHours(v) ?? v.hours).toLocaleString() + " hrs";
              metaLine = isStale
                ? hourStr + " · Update needed"
                : daysSinceUpdate != null
                  ? hourStr + " · " + formatDistanceToNowStrict(parseISO(v.updated_at!), { addSuffix: true })
                  : hourStr;
            } else if (tracksHrs) {
              metaLine = "No hours entered yet";
            } else {
              metaLine = "";
            }

            // Status is folded into the third line's colour (overdue red, due soon amber,
            // otherwise the vehicle accent) — same information the old dot carried.
            const nextLine = td === undefined
              ? null
              : td.nextTask && td.nextDue
                ? `${td.nextIsEstimate ? "Est. " : ""}${td.nextTask} · ${relativeDue(td.nextDue)}`
                : "All caught up";
            const nextLineColor = worstStatus === "overdue" ? Colors.overdue : worstStatus === "due_soon" ? Colors.dueSoon : Colors.vehicle;
            const subtitle = v.nickname && title ? [title, metaLine].filter(Boolean).join(" · ") : metaLine;

            return (
              <Card
                key={v.id}
                padding={Spacing.md}
                style={isLocked ? styles.lockedCard : null}
                accessibilityLabel={displayName}
                onPress={() => {
                  if (isLocked) {
                    setPaywallReason("locked_existing");
                    setShowPaywall(true);
                    return;
                  }
                  router.push(`/vehicle/${v.id}` as any);
                }}
              >
                <View style={styles.cardRow}>
                {v.photo_url ? (
                  <Image source={{ uri: v.photo_url }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[styles.thumb, styles.thumbGlyph]}>
                    {icon.family === "ionicons" ? (
                      <Icon name={icon.name as IconName} size={28} color={Colors.vehicle} />
                    ) : (
                      <MciIcon name={icon.name} size={28} color={Colors.vehicle} />
                    )}
                  </View>
                )}
                <View style={styles.vehicleInfo}>
                  <Text style={styles.vehicleTitle} numberOfLines={1}>{displayName}</Text>
                  {subtitle ? (
                    <Text
                      style={[styles.vehicleMeta, isStale && (tracksMiles || tracksHrs) && currentUsageValue(v) != null && { color: Colors.dueSoon }]}
                      numberOfLines={1}
                    >
                      {subtitle}
                    </Text>
                  ) : null}
                  {nextLine ? (
                    <Text style={[styles.vehicleNext, { color: nextLineColor }]} numberOfLines={2}>{nextLine}</Text>
                  ) : null}
                  {isLocked && (
                    <View style={styles.lockedRow}>
                      <Icon name="lock-closed" size={11} color={Colors.textTertiary} />
                      <Text style={styles.lockedText}>Upgrade to access</Text>
                    </View>
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
          context={{ vertical: "vehicle", reason: paywallReason }}
          onDismiss={() => setShowPaywall(false)}
        />
      </Modal>
    </View>
  );
}

function VehicleCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
  return (
    <View style={styles.vehicleCard}>
      <S anim={anim} w={72} h={72} r={12} />
      <Col flex={1} gap={5}>
        <S anim={anim} w="55%" h={16} r={5} />
        <S anim={anim} w="75%" h={13} r={5} />
        <S anim={anim} w="60%" h={13} r={5} />
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

const styles = StyleSheet.create({
  content: { gap: Spacing.md },
  cardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  lockedCard: { opacity: 0.55 },

  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
  },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, flexShrink: 0 },
  thumbGlyph: { backgroundColor: Colors.vehicleMuted, alignItems: "center", justifyContent: "center" },
  vehicleInfo: { flex: 1, gap: 3, minWidth: 0 },
  vehicleTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  vehicleMeta: { ...Typography.footnote, color: Colors.textSecondary },
  vehicleNext: { ...Typography.footnote, fontWeight: "500" },
  cardRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  lockedText: { ...Typography.caption, color: Colors.textTertiary },
});
