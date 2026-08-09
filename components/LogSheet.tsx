import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { router, type Href } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import type { Profile } from "@/lib/subscription";
import { hasPersonalOrAbove, hasProOrAbove } from "@/lib/subscription";
import {
  voiceCapPerDay,
  localVoiceRemainingToday,
  incrementLocalVoiceCount,
  reconcileLocalVoiceFromServer,
  syncVoiceUsedFromServer,
} from "@/lib/voiceQuota";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SaveToast } from "@/components/SaveToast";
import { matchAndUpdateVehicleTask, matchAndUpdatePropertyTask, type MatchResult } from "@/lib/maintenanceMatcher";
import { completeVehicleTask, reverseVehicleTaskCompletion } from "@/lib/rpc";
import { isHoursTracked, resolveTrackingMode } from "@/lib/usageHelpers";
import { updateVehicleUsage } from "@/lib/vehicleUsageHelper";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import DatePicker from "@/components/DatePicker";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import AsyncStorage from "@react-native-async-storage/async-storage";

const VOICE_ORB_FIRST_OPEN_KEY = "@logsheet_voice_orb_first_open_seen";
import Reanimated, {
  useSharedValue,
  withRepeat,
  withTiming,
  withDelay,
  withSpring,
  useAnimatedStyle,
  cancelAnimation,
  Easing as ReaEasing,
} from "react-native-reanimated";

type TranscribeAudioResponse = {
  text?: string;
  error?: string;
  voice_remaining_today?: number | null;
};

type RecordPhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "type"
  | "processing"
  | "results"
  | "error";

type ExtractedItem = {
  category: "vehicle" | "property" | "health";
  asset_id: string | null;
  asset_name: string;
  service_name: string;
  service_date: string;
  cost: number | null;
  mileage: number | null;
  provider_name: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
};

// ─── Voice Orb (Reanimated — sonar pulse rings + breathing glow layers) ──────

type OrbProps = {
  amplitudeRef: React.MutableRefObject<number>;
  isRecording: boolean;
  phase: RecordPhase;
  firstOpen?: boolean;
};

function VoiceOrb({ amplitudeRef, isRecording, phase, firstOpen = false }: OrbProps) {
  // Breathing layers
  const outerScale   = useSharedValue(1.0);
  const outerOpacity = useSharedValue(0.06);
  const midScale     = useSharedValue(1.0);
  const coreScale    = useSharedValue(1.0);

  // Sonar pulse rings (4 rings × scale + opacity)
  const r1s = useSharedValue(0.3); const r1o = useSharedValue(0.35);
  const r2s = useSharedValue(0.3); const r2o = useSharedValue(0.35);
  const r3s = useSharedValue(0.3); const r3o = useSharedValue(0.35);
  const r4s = useSharedValue(0.3); const r4o = useSharedValue(0.35);

  // Start ambient breathing + sonar pulses on mount.
  // First-open prominence boosts amplitude of the ambient animation so the orb
  // visibly invites a tap before any interaction has happened.
  useEffect(() => {
    const scaleBoost = firstOpen ? 0.10 : 0;
    outerScale.value = withRepeat(
      withTiming(1.05 + scaleBoost, { duration: 3500, easing: ReaEasing.inOut(ReaEasing.ease) }),
      -1, true,
    );
    midScale.value = withRepeat(
      withTiming(1.12 + scaleBoost, { duration: 2500, easing: ReaEasing.inOut(ReaEasing.ease) }),
      -1, true,
    );

    const rScales   = [r1s, r2s, r3s, r4s];
    const rOpacities = [r1o, r2o, r3o, r4o];
    rScales.forEach((sv, i) => {
      sv.value = withDelay(
        i * 750,
        withRepeat(
          withTiming(1.4, { duration: 3000, easing: ReaEasing.out(ReaEasing.ease) }),
          -1,
        ),
      );
    });
    rOpacities.forEach((sv, i) => {
      sv.value = withDelay(
        i * 750,
        withRepeat(
          withTiming(0, { duration: 3000, easing: ReaEasing.out(ReaEasing.ease) }),
          -1,
        ),
      );
    });
  }, []);

  // Freeze pulse rings when transcribing (Bug 2 fix)
  useEffect(() => {
    if (phase === "transcribing") {
      [r1s, r2s, r3s, r4s].forEach(sv => cancelAnimation(sv));
      [r1o, r2o, r3o, r4o].forEach(sv => {
        cancelAnimation(sv);
        sv.value = withTiming(0, { duration: 300 });
      });
    }
  }, [phase]);

  // Amplitude → inner core scale + outer glow intensity
  useEffect(() => {
    if (!isRecording) {
      coreScale.value   = withSpring(1.0, { damping: 15, stiffness: 150 });
      outerOpacity.value = withTiming(0.06, { duration: 400 });
      return;
    }
    const id = setInterval(() => {
      const amp = amplitudeRef.current;
      coreScale.value    = withSpring(0.82 + amp * 0.32, { damping: 12, stiffness: 200 });
      outerOpacity.value = withTiming(0.06 + amp * 0.08, { duration: 80 });
    }, 50);
    return () => clearInterval(id);
  }, [isRecording]);

  // Animated styles
  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: outerScale.value }],
    opacity:   outerOpacity.value,
  }));
  const midStyle = useAnimatedStyle(() => ({
    transform: [{ scale: midScale.value }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: coreScale.value }],
  }));
  const ring1Style = useAnimatedStyle(() => ({ transform: [{ scale: r1s.value }], opacity: r1o.value }));
  const ring2Style = useAnimatedStyle(() => ({ transform: [{ scale: r2s.value }], opacity: r2o.value }));
  const ring3Style = useAnimatedStyle(() => ({ transform: [{ scale: r3s.value }], opacity: r3o.value }));
  const ring4Style = useAnimatedStyle(() => ({ transform: [{ scale: r4s.value }], opacity: r4o.value }));

  const RING_SIZE = 280;
  const ringBase = {
    position: "absolute" as const,
    width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
    borderWidth: 2.5, borderColor: Colors.accent,
  };

  return (
    <View style={{ width: 300, height: 300, alignItems: "center", justifyContent: "center" }}>
      {/* Sonar pulse rings */}
      <Reanimated.View style={[ringBase, ring1Style]} />
      <Reanimated.View style={[ringBase, ring2Style]} />
      <Reanimated.View style={[ringBase, ring3Style]} />
      <Reanimated.View style={[ringBase, ring4Style]} />

      {/* Outer glow layer */}
      <Reanimated.View style={[{
        position: "absolute",
        width: 160, height: 160, borderRadius: 80,
        backgroundColor: Colors.accent,
      }, outerStyle]} />

      {/* Mid glow layer */}
      <Reanimated.View style={[{
        position: "absolute",
        width: 110, height: 110, borderRadius: 55,
        backgroundColor: Colors.accent, opacity: 0.16,
      }, midStyle]} />

      {/* Inner core — decorative only */}
      <Reanimated.View style={[{
        position: "absolute",
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: Colors.accent, opacity: 0.88,
      }, coreStyle]} />
    </View>
  );
}

// ─── Field Row ───────────────────────────────────────────────────────────────

function FieldRow({
  label, value, onChange, placeholder, keyboard, prefix, suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: "default" | "decimal-pad" | "number-pad";
  prefix?: string;
  suffix?: string;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        {!!prefix && <Text style={styles.fieldAffix}>{prefix}</Text>}
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textTertiary}
          keyboardType={keyboard ?? "default"}
        />
        {!!suffix && <Text style={styles.fieldAffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

// ─── Confirm Card ────────────────────────────────────────────────────────────

type CardItem = ExtractedItem & { _key: string };

type CardPhase = "editing" | "saving" | "matched" | "picker";

function formatNextDue(m: MatchResult): string {
  if (m.nextDueMiles != null) return `Next due ${m.nextDueMiles.toLocaleString()} mi`;
  if (m.nextDueHours != null) return `Next due ${m.nextDueHours.toLocaleString()} hrs`;
  if (m.nextDueDate) return `Next due ${new Date(m.nextDueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return "Logged";
}

function ConfirmCard({
  item, userId, onRemove, onToast,
}: {
  item: ExtractedItem;
  userId: string;
  onRemove: () => void;
  onToast?: (title: string, subtitle?: string) => void;
}) {
  const queryClient = useQueryClient();
  const [serviceName, setServiceName] = useState(item.service_name);
  const [date, setDate] = useState(item.service_date);
  const [cost, setCost] = useState(item.cost != null ? String(item.cost) : "");
  const [mileage, setMileage] = useState(item.mileage != null ? String(item.mileage) : "");
  const [hoursReading, setHoursReading] = useState("");
  const [provider, setProvider] = useState(item.provider_name ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [phase, setPhase] = useState<CardPhase>("editing");
  const [cardError, setCardError] = useState("");
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [rejectedTaskId, setRejectedTaskId] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const meterRef = useRef<{ miles: number | null; hours: number | null }>({ miles: null, hours: null });

  const isVehicle = item.category === "vehicle";

  const { data: vehicleData } = useQuery({
    queryKey: ["vehicle", item.asset_id],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", item.asset_id!).single();
      return data;
    },
    enabled: isVehicle && !!item.asset_id,
    staleTime: 1000 * 60 * 5,
  });
  const usageMode = vehicleData ? resolveTrackingMode(vehicleData) : "mileage";
  const tracksHours = usageMode === "hours";
  const tracksBoth = usageMode === "both";
  const tracksMileage = usageMode === "mileage";
  const vehicleReady = !isVehicle || !!vehicleData;

  const { data: pickerTasks, isError: pickerError, refetch: refetchPicker } = useQuery({
    queryKey: ["confirm_picker_tasks", item.asset_id],
    queryFn: async () => {
      const vid = item.asset_id;
      if (!vid) return [];
      const { data, error } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("id,name")
        .eq("vehicle_id", vid)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isVehicle && !!item.asset_id && phase === "picker",
    staleTime: 1000 * 60,
  });

  const catIcon = item.category === "vehicle" ? "car-outline" : item.category === "property" ? "home-outline" : "heart-outline";
  const catColor = item.category === "vehicle" ? Colors.blue : item.category === "property" ? Colors.good : Colors.health;

  async function handleSave() {
    if (savingRef.current) return;
    if (item.category === "health") {
      setCardError("Health logging from voice is coming soon. Use the Health tab for now.");
      return;
    }
    if (!serviceName.trim()) { setCardError("Service name is required"); return; }
    if (!vehicleReady) return;
    savingRef.current = true;
    setPhase("saving");
    setCardError("");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const now = new Date().toISOString();
      let milesVal: number | null = null;
      let hoursVal: number | null = null;
      const asInt = (v: string) => { const n = parseInt(v.replace(/,/g, ""), 10); return Number.isFinite(n) ? n : null; };
      const asFloat = (v: string) => { const n = parseFloat(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
      if (tracksBoth) {
        if (mileage.trim()) milesVal = asInt(mileage);
        if (hoursReading.trim()) hoursVal = asFloat(hoursReading);
      } else if (tracksHours) {
        if (mileage.trim()) hoursVal = asFloat(mileage);
      } else {
        if (mileage.trim()) milesVal = asInt(mileage);
      }
      meterRef.current = { miles: milesVal, hours: hoursVal };
      const logMeter = milesVal ?? hoursVal ?? null;

      const { error: insertErr } = await supabase.from("maintenance_logs").insert({
        user_id: userId,
        vehicle_id: isVehicle && item.asset_id ? item.asset_id : null,
        property_id: item.category === "property" && item.asset_id ? item.asset_id : null,
        service_name: serviceName.trim(),
        service_date: date || now.split("T")[0],
        mileage: logMeter,
        cost: asFloat(cost),
        provider_name: provider.trim() || null,
        notes: notes.trim() || null,
        receipt_url: null,
        created_at: now,
        updated_at: now,
      });
      if (insertErr) throw insertErr;

      if (isVehicle && item.asset_id && (milesVal != null || hoursVal != null)) {
        try {
          await updateVehicleUsage(item.asset_id, milesVal, hoursVal, date || now, vehicleData?.mileage ?? null, vehicleData?.hours ?? null);
        } catch (usageErr) { console.error("updateVehicleUsage failed (non-blocking):", usageErr); }
      }

      let matchResult: MatchResult | null = null;
      if (isVehicle && item.asset_id) {
        try {
          matchResult = await matchAndUpdateVehicleTask(item.asset_id, serviceName.trim(), date || now.split("T")[0], milesVal, hoursVal);
        } catch (matchErr) { console.error("vehicle match failed (non-blocking):", matchErr); }
      } else if (item.category === "property" && item.asset_id) {
        try {
          await matchAndUpdatePropertyTask(item.asset_id, serviceName.trim(), date || now.split("T")[0]);
        } catch (matchErr) { console.error("property match failed (non-blocking):", matchErr); }
      }

      queryClient.invalidateQueries({ queryKey: ["maintenance_logs"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", item.asset_id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_spending"] });
      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
      if (isVehicle && item.asset_id) {
        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["vehicle"] });
        queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", item.asset_id] });
      } else if (item.category === "property" && item.asset_id) {
        queryClient.invalidateQueries({ queryKey: ["properties"] });
        queryClient.invalidateQueries({ queryKey: ["property_tasks", item.asset_id] });
        queryClient.invalidateQueries({ queryKey: ["property_logs", item.asset_id] });
      }

      try { await scheduleMaintenanceNotifications(userId); }
      catch (notifErr) { console.error("scheduleMaintenanceNotifications failed (non-blocking):", notifErr); }

      if (isVehicle) {
        if (matchResult) { setMatch(matchResult); setPhase("matched"); }
        else { setPhase("picker"); }
      } else {
        onToast?.(`${serviceName.trim()} logged`);
        onRemove();
      }
    } catch (err) {
      console.error("ConfirmCard save error:", err);
      setCardError("Save failed. Try again.");
      setPhase("editing");
    } finally {
      savingRef.current = false;
    }
  }

  async function handleWrongTask() {
    const prior = match?.prior;
    if (!match || !prior) { setPhase("picker"); return; }
    if (reversing) return;
    setReversing(true);
    setCardError("");
    try {
      const { data, error } = await reverseVehicleTaskCompletion({
        p_task_id: match.taskId,
        p_prior_status: prior.status,
        p_prior_last_completed_date: prior.last_completed_date ?? undefined,
        p_prior_last_completed_miles: prior.last_completed_miles ?? undefined,
        p_prior_last_completed_hours: prior.last_completed_hours ?? undefined,
        p_prior_next_due_date: prior.next_due_date ?? undefined,
        p_prior_next_due_miles: prior.next_due_miles ?? undefined,
        p_prior_next_due_hours: prior.next_due_hours ?? undefined,
        p_expected_next_due_date_str: match.expected?.next_due_date_str ?? undefined,
        p_expected_next_due_miles: match.expected?.next_due_miles ?? undefined,
        p_expected_next_due_hours: match.expected?.next_due_hours ?? undefined,
      });
      if (error) throw error;
      if (!data?.applied) {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", item.asset_id] });
        setCardError("This task already changed — refresh to see the latest.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", item.asset_id] });
      Haptics.selectionAsync().catch(() => {});
      setRejectedTaskId(match.taskId);
      setPhase("picker");
    } catch (e) {
      console.error("reverse RPC failed:", e);
      setCardError("Couldn't undo — try again.");
    } finally {
      setReversing(false);
    }
  }

  async function handlePickTask(taskId: string) {
    if (pickingId) return;
    setPickingId(taskId);
    setCardError("");
    try {
      const { error } = await completeVehicleTask({
        p_task_id: taskId,
        p_completed_date: date || new Date().toISOString().split("T")[0],
        p_mileage: meterRef.current.miles ?? undefined,
        p_hours: meterRef.current.hours ?? undefined,
        p_skip_log: true,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", item.asset_id] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onToast?.("Task updated");
      onRemove();
    } catch (e) {
      console.error("picker complete failed:", e);
      setCardError("Couldn't update the task — try again.");
      setPickingId(null);
    }
  }

  function handleJustLog() {
    onToast?.(`${serviceName.trim()} logged`);
    onRemove();
  }

  if (phase === "matched" && match) {
    return (
      <View style={styles.confirmCard}>
        <View style={styles.confirmMatchedRow}>
          <Ionicons name="checkmark-circle" size={20} color={Colors.good} />
          <View style={{ flex: 1 }}>
            <Text style={styles.confirmMatchedText} numberOfLines={1}>{match.taskName}</Text>
            <Text style={styles.confirmMatchedSub} numberOfLines={1}>{formatNextDue(match)}</Text>
          </View>
          <Pressable onPress={handleWrongTask} hitSlop={8} style={styles.confirmWrongTaskBtn} disabled={reversing}>
            {reversing ? <ActivityIndicator size="small" color={Colors.textSecondary} /> : <Text style={styles.confirmWrongTaskText}>Wrong task?</Text>}
          </Pressable>
        </View>
        {!!cardError && <Text style={styles.confirmCardError}>{cardError}</Text>}
      </View>
    );
  }

  if (phase === "picker") {
    const tasks = (pickerTasks ?? []).filter(t => t.id !== rejectedTaskId);
    const header = rejectedTaskId
      ? `Not ${match?.taskName ?? "that task"} — which one?`
      : "Logged — which task did this complete?";
    return (
      <View style={styles.confirmCard}>
        <Text style={styles.confirmPickerTitle}>{header}</Text>
        {pickerError ? (
          <View style={styles.confirmPickerLoading}>
            <Text style={styles.confirmPickerErrorText}>Couldn{"'"}t load tasks.</Text>
            <Pressable onPress={() => refetchPicker()} style={styles.confirmPickerRetry}>
              <Text style={styles.confirmPickerRetryText}>Retry</Text>
            </Pressable>
          </View>
        ) : pickerTasks === undefined ? (
          <View style={styles.confirmPickerLoading}><ActivityIndicator size="small" color={Colors.accent} /></View>
        ) : (
          <View style={styles.confirmPickerList}>
            {tasks.map(t => (
              <Pressable key={t.id} style={styles.confirmPickerRow} onPress={() => handlePickTask(t.id)} disabled={!!pickingId}>
                <Text style={styles.confirmPickerRowText} numberOfLines={1}>{t.name}</Text>
                {pickingId === t.id
                  ? <ActivityIndicator size="small" color={Colors.textTertiary} />
                  : <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />}
              </Pressable>
            ))}
          </View>
        )}
        {!!cardError && <Text style={styles.confirmCardError}>{cardError}</Text>}
        <Pressable style={styles.confirmJustLogBtn} onPress={handleJustLog} disabled={!!pickingId}>
          <Text style={styles.confirmJustLogText}>Just log it — no task</Text>
        </Pressable>
      </View>
    );
  }

  const saving = phase === "saving";
  return (
    <View style={styles.confirmCard}>
      <View style={styles.confirmCardHeader}>
        <View style={[styles.confirmCatIcon, { backgroundColor: catColor + "22" }]}>
          <Ionicons name={catIcon as any} size={15} color={catColor} />
        </View>
        <Text style={styles.confirmAssetName} numberOfLines={1}>{item.asset_name || "Unknown"}</Text>
        {item.confidence === "low" && (
          <View style={styles.confirmLowBadge}>
            <Ionicons name="alert-circle-outline" size={11} color={Colors.dueSoon} />
            <Text style={styles.confirmLowBadgeText}>Please verify</Text>
          </View>
        )}
      </View>

      <View style={styles.confirmFields}>
        <FieldRow label="Service" value={serviceName} onChange={setServiceName} placeholder="e.g. Oil Change" />
        <View style={styles.fieldRow}>
          <DatePicker value={date} onChange={setDate} maximumDate={new Date()} />
        </View>
        <FieldRow label="Cost" value={cost} onChange={setCost} placeholder="0.00" keyboard="decimal-pad" prefix="$" />
        {isVehicle && tracksBoth && (
          <>
            <FieldRow label="Mileage" value={mileage} onChange={setMileage} placeholder="0" keyboard="number-pad" suffix=" mi" />
            <FieldRow label="Hours" value={hoursReading} onChange={setHoursReading} placeholder="0" keyboard="decimal-pad" suffix=" hrs" />
          </>
        )}
        {isVehicle && tracksHours && (
          <FieldRow label="Hours" value={mileage} onChange={setMileage} placeholder="0" keyboard="decimal-pad" suffix=" hrs" />
        )}
        {isVehicle && tracksMileage && (
          <FieldRow label="Mileage" value={mileage} onChange={setMileage} placeholder="0" keyboard="number-pad" suffix=" mi" />
        )}
        <FieldRow label="Provider" value={provider} onChange={setProvider} placeholder="Shop or clinic name" />
        <FieldRow label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
      </View>

      {!!cardError && <Text style={styles.confirmCardError}>{cardError}</Text>}

      <View style={styles.confirmActions}>
        <Pressable style={styles.confirmDiscardBtn} onPress={onRemove} disabled={saving}>
          <Text style={styles.confirmDiscardText}>Discard</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmSaveBtn, (saving || !vehicleReady) && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving || !vehicleReady}
        >
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmSaveBtnText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ─── LogSheet ────────────────────────────────────────────────────────────────

export function LogSheet({
  visible, onClose, userId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
}) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [text, setText] = useState("");
  const [items, setItems] = useState<CardItem[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [voiceCapHit, setVoiceCapHit] = useState(false);
  const [firstOpenProminence, setFirstOpenProminence] = useState(false);
  const [logToastVisible, setLogToastVisible] = useState(false);
  const [logToastTitle, setLogToastTitle] = useState("");
  const [logToastSubtitle, setLogToastSubtitle] = useState<string | undefined>(undefined);

  function fireLogSuccessToast(title: string, subtitle?: string) {
    setLogToastTitle(title);
    setLogToastSubtitle(subtitle);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLogToastVisible(true);
    setTimeout(() => setLogToastVisible(false), 2800);
  }

  // Normalized 0-1 amplitude written by metering updates, read by WaveformCircle each RAF frame
  const amplitudeRef = useRef<number>(0);
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Reset when sheet becomes visible or hidden
  useEffect(() => {
    if (visible) {
      setPhase("idle");
      setText("");
      setItems([]);
      setErrorMsg("");
      setVoiceCapHit(false);
      amplitudeRef.current = 0;
      void syncVoiceUsedFromServer(profile);

      AsyncStorage.getItem(VOICE_ORB_FIRST_OPEN_KEY)
        .then(seen => {
          if (seen === null) setFirstOpenProminence(true);
        })
        .catch(() => {});
    } else {
      safeStopRecording();
      amplitudeRef.current = 0;
    }
  }, [visible]);

  function dismissFirstOpenProminence() {
    if (!firstOpenProminence) return;
    setFirstOpenProminence(false);
    AsyncStorage.setItem(VOICE_ORB_FIRST_OPEN_KEY, "true").catch(() => {});
  }

  async function safeStopRecording() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    try {
      await rec.stopAndUnloadAsync();
    } catch (err) {
      console.warn("[LogSheet] recorder stopAndUnload failed:", err);
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (err) {
      console.warn("[LogSheet] audio mode reset failed:", err);
    }
  }

  async function handleStartRecording() {
    dismissFirstOpenProminence();
    try {
      // Tier-aware cap gate fires BEFORE permissions / recording start.
      const remaining = await localVoiceRemainingToday(profile);
      if (remaining <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setVoiceCapHit(true);
        return;
      }

      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setPhase("type");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      rec.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording && status.metering !== undefined) {
          amplitudeRef.current = Math.max(0, (status.metering + 60) / 60);
        }
      });
      rec.setProgressUpdateInterval(100);
      await rec.startAsync();

      recordingRef.current = rec;
      setPhase("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.error("[LogSheet] Start recording error:", err);
      setPhase("type");
    }
  }

  async function handleStopRecording() {
    const rec = recordingRef.current;
    if (!rec) { setPhase("type"); return; }

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      amplitudeRef.current = 0;

      setPhase("transcribing");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await handleTranscribe(uri);
    } catch (err) {
      console.error("[LogSheet] Stop recording error:", err);
      recordingRef.current = null;
      setPhase("type");
    }
  }

  async function handleTranscribe(uri: string | null) {
    if (!uri) {
      setPhase("type");
      return;
    }
    try {
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: "base64" as any,
      });
      let clientTz = "UTC";
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (typeof tz === "string" && tz.length > 0) clientTz = tz;
      } catch {}
      const { data, error } = await supabase.functions.invoke<TranscribeAudioResponse>("transcribe-audio", {
        body: { audio: fileContent, mimeType: "audio/m4a" },
        headers: { "x-client-tz": clientTz },
      });

      // Daily voice cap is a structured HTTP 200 payload with error="voice_cap_reached".
      // Recognised by body, not status. Reconcile local count to 0 and show cap UI.
      if (data?.error === "voice_cap_reached") {
        await reconcileLocalVoiceFromServer(profile, 0);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setVoiceCapHit(true);
        return;
      }

      // 429 from this endpoint means the per-minute abuse rate-limit fired,
      // NOT a daily cap. Surface as transient error; do NOT touch local count.
      if (error instanceof FunctionsHttpError && error.context.status === 429) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setErrorMsg("Voice is busy right now. Please try again in a moment, or type your log below.");
        setText("");
        setPhase("type");
        return;
      }

      if (error || data?.error) {
        console.error("[transcribe] error:", error ?? data?.error);
        setErrorMsg("Transcription failed. You can type your log below.");
        setText("");
        setPhase("type");
        return;
      }
      const transcribed: string = data?.text ?? "";
      const remainingFromServer = data?.voice_remaining_today;
      if (typeof remainingFromServer === "number") {
        await reconcileLocalVoiceFromServer(profile, remainingFromServer);
      } else {
        await incrementLocalVoiceCount();
      }
      setText(transcribed);
      setPhase("type");
    } catch (err) {
      console.error("[transcribe] caught:", err);
      setErrorMsg("Transcription failed. You can type your log below.");
      setText("");
      setPhase("type");
    }
  }

  function handleClose() {
    safeStopRecording();
    amplitudeRef.current = 0;
    setText("");
    setPhase("idle");
    setItems([]);
    setErrorMsg("");
    onClose();
  }

  async function handleProcess() {
    if (!text.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase("processing");
    try {
      const { data, error } = await supabase.functions.invoke("extract-maintenance-data", {
        body: { text: text.trim() },
      });

      if (__DEV__) console.log("[extract-maintenance-data] data:", JSON.stringify(data));
      if (__DEV__) console.log("[extract-maintenance-data] error:", error);

      if (error) {
        console.error("[extract-maintenance-data] invoke error:", error);
        const status = error instanceof FunctionsHttpError ? error.context?.status : undefined;
        setErrorMsg(
          status === 402 || status === 403
            ? "Upgrade to log by voice or text. Describe the work and we'll file it for you."
            : status === 429
              ? "You're sending those a little fast. Try again in a moment."
              : "Couldn't process that. Please try again.",
        );
        setPhase("error");
        return;
      }

      if (data?.error) {
        console.error("[extract-maintenance-data] function error:", data.error);
        setErrorMsg("Couldn't read that one. Try adding a bit more detail.");
        setPhase("error");
        return;
      }

      const extracted: ExtractedItem[] = data?.items ?? [];
      if (extracted.length === 0) {
        setErrorMsg("No maintenance items found. Try adding more detail (e.g. service type, vehicle, mileage).");
        setPhase("error");
        return;
      }
      setItems(extracted.map((it, i) => ({ ...it, _key: `${Date.now()}-${i}` })));
      setPhase("results");
      dismissFirstOpenProminence();
    } catch (err) {
      console.error("[extract-maintenance-data] caught:", err);
      setErrorMsg("Couldn't process that. Please try again.");
      setPhase("error");
    }
  }

  function removeCard(key: string) {
    setItems(prev => prev.filter(x => x._key !== key));
  }

  useEffect(() => {
    if (phase === "results" && items.length === 0) {
      const t = setTimeout(handleClose, 400);
      return () => clearTimeout(t);
    }
  }, [phase, items.length]);

  const isRecordingPhase = phase === "idle" || phase === "recording" || phase === "transcribing";
  const isTextPhase = phase === "type" || phase === "error";

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1 }}>

        {/* ── Recording overlay (idle / recording / transcribing) ── */}
        {isRecordingPhase && (
          <View style={[styles.recordingScreen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
            {/* Close button */}
            <View style={styles.recordingTopBar}>
              <Pressable onPress={handleClose} hitSlop={12} style={styles.recordingCloseBtn}>
                <Ionicons name="close" size={22} color={Colors.textTertiary} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 20 }}>
              <Tooltip
                id={TOOLTIP_IDS.VOICE_LOG_TIP}
                message="Tap the microphone, say what you did, and we'll log it automatically. Works for vehicles, home, and health."
                icon="mic-outline"
                delay={500}
              />
            </View>

            {/* Orb — centered in upper portion */}
            <View style={styles.recordingCenter}>
              <Pressable
                onPress={dismissFirstOpenProminence}
                disabled={!firstOpenProminence}
                hitSlop={12}
              >
                <VoiceOrb
                  amplitudeRef={amplitudeRef}
                  isRecording={phase === "recording"}
                  phase={phase}
                  firstOpen={firstOpenProminence}
                />
              </Pressable>
              {firstOpenProminence ? (
                <Pressable
                  onPress={dismissFirstOpenProminence}
                  hitSlop={8}
                  style={styles.firstOpenCaption}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss voice introduction"
                >
                  <Text style={styles.firstOpenCaptionText}>Tap to record by voice</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Bottom group: button → status text → type-instead */}
            <View style={styles.recordingBottom}>
              {voiceCapHit ? (
                <View style={styles.voiceCapBlock}>
                  <Text style={styles.voiceCapTitle}>{voiceCapTitleFor(profile)}</Text>
                  <Text style={styles.voiceCapBody}>{voiceCapBodyFor(profile)}</Text>
                  <Pressable
                    style={styles.voiceCapBtn}
                    onPress={() => {
                      const cta = voiceCapCtaActionFor(profile);
                      handleClose();
                      if (cta === "paywall") {
                        setTimeout(() => router.push("/subscription?vertical=voice&reason=limit_reached" as Href), 50);
                      }
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.voiceCapBtnText}>{voiceCapCtaLabelFor(profile)}</Text>
                  </Pressable>
                  <Pressable onPress={() => { setVoiceCapHit(false); setPhase("type"); }} hitSlop={12} style={{ marginTop: 14 }}>
                    <Text style={styles.typeInsteadText}>or type instead</Text>
                  </Pressable>
                </View>
              ) : phase === "transcribing" ? (
                <View style={styles.transcribingRow}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                  <Text style={styles.transcribingText}>Processing audio...</Text>
                </View>
              ) : (
                <>
                  <Pressable
                    style={[
                      styles.recordingBtn,
                      phase === "recording" && styles.recordingBtnStop,
                    ]}
                    onPress={phase === "idle" ? handleStartRecording : handleStopRecording}
                    accessibilityLabel="Start recording"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={phase === "idle" ? "mic" : "stop"}
                      size={24}
                      color="#fff"
                    />
                  </Pressable>
                  <Text style={[
                    styles.recordingStatus,
                    { marginTop: 12 },
                    phase === "recording" && { color: "#fff" },
                  ]}>
                    {phase === "idle" ? "Tap to record" : "Recording..."}
                  </Text>
                  <Pressable onPress={() => setPhase("type")} hitSlop={12} style={{ marginTop: 16 }}>
                    <Text style={styles.typeInsteadText}>or type instead</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        {/* ── Text / Processing / Results (bottom sheet) ── */}
        {!isRecordingPhase && (
          <>
            <Pressable style={styles.sheetOverlay} onPress={handleClose} />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              style={styles.sheetKAV}
            >
              <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                <View style={styles.sheetHandleBar} />

                <Tooltip
                  id={TOOLTIP_IDS.VOICE_LOG_TIP}
                  message="Tap the microphone, say what you did, and we'll log it automatically. Works for vehicles, home, and health."
                  icon="mic-outline"
                  delay={500}
                />

                <View style={styles.sheetHeader}>
                  <View style={styles.sheetIconWrap}>
                    <Ionicons name="mic-outline" size={17} color={Colors.accent} />
                  </View>
                  <Text style={styles.sheetTitle}>Log Maintenance</Text>
                  <Pressable onPress={handleClose} hitSlop={10} style={styles.sheetCloseBtn}>
                    <Ionicons name="close" size={20} color={Colors.textTertiary} />
                  </Pressable>
                </View>

                {isTextPhase && (
                  <View style={{ gap: 12 }}>
                    {phase === "error" && (
                      <View style={styles.sheetErrorBanner}>
                        <Ionicons name="alert-circle-outline" size={14} color={Colors.overdue} />
                        <Text style={styles.sheetErrorText}>{errorMsg}</Text>
                      </View>
                    )}
                    {errorMsg !== "" && phase === "type" && (
                      <View style={styles.sheetErrorBanner}>
                        <Ionicons name="alert-circle-outline" size={14} color={Colors.overdue} />
                        <Text style={styles.sheetErrorText}>{errorMsg}</Text>
                      </View>
                    )}
                    <View>
                      <TextInput
                        style={styles.sheetTextInput}
                        value={text}
                        onChangeText={setText}
                        placeholder="Tap 🎤 on keyboard to dictate, or type here"
                        placeholderTextColor={Colors.textTertiary}
                        multiline
                        numberOfLines={4}
                        autoFocus
                        textAlignVertical="top"
                        returnKeyType="default"
                      />
                      <Text style={styles.sheetHint}>Use your keyboard{"'"}s microphone button to speak</Text>
                    </View>
                    <Pressable
                      style={[styles.sheetProcessBtn, !text.trim() && { opacity: 0.45 }]}
                      onPress={handleProcess}
                      disabled={!text.trim()}
                      accessibilityLabel="Process voice entry"
                      accessibilityRole="button"
                    >
                      <Ionicons name="sparkles-outline" size={15} color="#fff" />
                      <Text style={styles.sheetProcessBtnText}>Process</Text>
                    </Pressable>
                  </View>
                )}

                {phase === "processing" && (
                  <View style={styles.sheetProcessing}>
                    <ActivityIndicator size="small" color={Colors.accent} />
                    <Text style={styles.sheetProcessingText}>Analyzing...</Text>
                  </View>
                )}

                {phase === "results" && (
                  <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
                    {items.map(it => (
                      <ConfirmCard key={it._key} item={it} userId={userId} onRemove={() => removeCard(it._key)} onToast={fireLogSuccessToast} />
                    ))}
                  </ScrollView>
                )}
              </View>
            </KeyboardAvoidingView>
          </>
        )}
        <SaveToast visible={logToastVisible} message={logToastTitle} subtitle={logToastSubtitle} />
      </View>
    </Modal>
    <SaveToast visible={logToastVisible} message={logToastTitle} subtitle={logToastSubtitle} />
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Recording overlay
  recordingScreen: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "space-between",
  },
  recordingTopBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  recordingCloseBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: Colors.surface,
  },
  recordingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  recordingStatus: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  recordingBottom: {
    alignItems: "center",
    paddingHorizontal: 20,
  },
  recordingBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  recordingBtnStop: {
    backgroundColor: Colors.overdue,
    shadowColor: Colors.overdue,
  },
  typeInsteadText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  transcribingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
  },
  transcribingText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },

  // Bottom sheet
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheetKAV: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTextInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 96,
    textAlignVertical: "top",
  },
  sheetHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 8,
  },
  sheetProcessBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    height: 46,
  },
  sheetProcessBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  sheetProcessing: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  sheetProcessingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  sheetErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.overdueMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,69,58,0.25)",
  },
  sheetErrorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
    lineHeight: 18,
  },

  // Confirm card
  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  confirmCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  confirmCatIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  confirmAssetName: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  confirmLowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dueSoonMuted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  confirmLowBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dueSoon,
  },
  confirmFields: {
    gap: 8,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 2,
  },
  confirmDiscardBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmDiscardText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  confirmSaveBtn: {
    flex: 2,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  confirmSaveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  confirmMatchedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  confirmMatchedText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  confirmMatchedSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 1 },
  confirmWrongTaskBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, minWidth: 76, alignItems: "center" },
  confirmWrongTaskText: { fontSize: 12.5, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  confirmPickerTitle: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 10 },
  confirmPickerLoading: { paddingVertical: 20, alignItems: "center", gap: 10 },
  confirmPickerErrorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  confirmPickerRetry: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  confirmPickerRetryText: { fontSize: 12.5, fontFamily: "Inter_500Medium", color: Colors.text },
  confirmPickerList: { gap: 6 },
  confirmPickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  confirmPickerRowText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text, flex: 1 },
  confirmJustLogBtn: { marginTop: 10, paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  confirmJustLogText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  confirmCardError: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
  },

  // Field row
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
  },
  fieldLabel: {
    width: 66,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  fieldInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 9,
    height: 36,
  },
  fieldInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    height: 36,
  },
  fieldAffix: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    flexShrink: 0,
  },
  voiceCapBlock: {
    alignItems: "center",
    paddingHorizontal: 24,
  },
  voiceCapTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  voiceCapBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 18,
  },
  voiceCapBtn: {
    height: 44,
    paddingHorizontal: 22,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  voiceCapBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  firstOpenCaption: {
    marginTop: 18,
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignSelf: "center",
  },
  firstOpenCaptionText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
});

function voiceCapTitleFor(profile: Profile | null | undefined): string {
  if (hasProOrAbove(profile)) return "Voice paused for now";
  if (hasPersonalOrAbove(profile)) return "Daily voice limit reached";
  return "You used your 5 free voice logs today";
}

function voiceCapBodyFor(profile: Profile | null | undefined): string {
  if (hasProOrAbove(profile)) {
    return "Voice will be back shortly. You can type your log below in the meantime.";
  }
  if (hasPersonalOrAbove(profile)) {
    return "Personal includes 30 voice logs per day. Upgrade to Pro for unlimited voice logging.";
  }
  const cap = voiceCapPerDay(profile);
  const capLabel = cap === Infinity ? "unlimited" : String(cap);
  return `Free includes ${capLabel} voice logs per day. Upgrade to Personal for 30/day, or Pro for unlimited.`;
}

function voiceCapCtaLabelFor(profile: Profile | null | undefined): string {
  if (hasProOrAbove(profile)) return "Got it";
  return "See plans";
}

function voiceCapCtaActionFor(profile: Profile | null | undefined): "paywall" | "dismiss" {
  if (hasProOrAbove(profile)) return "dismiss";
  return "paywall";
}
