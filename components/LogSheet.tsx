import React, { useState } from "react";
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
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { matchAndUpdateVehicleTask, matchAndUpdatePropertyTask } from "@/lib/maintenanceMatcher";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";

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

function ConfirmCard({
  item, userId, onDone,
}: {
  item: ExtractedItem;
  userId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [serviceName, setServiceName] = useState(item.service_name);
  const [date, setDate] = useState(item.service_date);
  const [cost, setCost] = useState(item.cost != null ? String(item.cost) : "");
  const [mileage, setMileage] = useState(item.mileage != null ? String(item.mileage) : "");
  const [provider, setProvider] = useState(item.provider_name ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState("");

  const isVehicle = item.category === "vehicle";
  const catIcon = item.category === "vehicle" ? "car-outline" : item.category === "property" ? "home-outline" : "heart-outline";
  const catColor = item.category === "vehicle" ? Colors.blue : item.category === "property" ? Colors.good : Colors.health;

  async function handleSave() {
    if (item.category === "health") {
      setCardError("Health logging from voice is coming soon. Use the Health tab for now.");
      return;
    }
    if (!serviceName.trim()) { setCardError("Service name is required"); return; }
    setSaving(true);
    setCardError("");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const now = new Date().toISOString();
      const { error: insertErr } = await supabase.from("maintenance_logs").insert({
        user_id: userId,
        vehicle_id: isVehicle && item.asset_id ? item.asset_id : null,
        property_id: item.category === "property" && item.asset_id ? item.asset_id : null,
        service_name: serviceName.trim(),
        service_date: date || now.split("T")[0],
        mileage: mileage ? parseInt(mileage) : null,
        cost: cost ? parseFloat(cost) : null,
        provider_name: provider.trim() || null,
        notes: notes.trim() || null,
        receipt_url: null,
        created_at: now,
        updated_at: now,
      });
      if (insertErr) throw insertErr;

      if (isVehicle && item.asset_id && mileage) {
        await supabase.from("vehicles").update({
          mileage: parseInt(mileage),
          updated_at: now,
        }).eq("id", item.asset_id);
        await supabase.from("vehicle_mileage_history").insert({
          vehicle_id: item.asset_id,
          mileage: parseInt(mileage),
          recorded_at: date || now,
          created_at: now,
        });
      }

      if (isVehicle && item.asset_id) {
        try {
          await matchAndUpdateVehicleTask(
            item.asset_id,
            serviceName.trim(),
            date || now.split("T")[0],
            mileage ? parseInt(mileage) : null,
          );
        } catch (matchErr) {
          console.error("matchAndUpdateVehicleTask failed (non-blocking):", matchErr);
        }
      } else if (item.category === "property" && item.asset_id) {
        try {
          await matchAndUpdatePropertyTask(
            item.asset_id,
            serviceName.trim(),
            date || now.split("T")[0],
          );
        } catch (matchErr) {
          console.error("matchAndUpdatePropertyTask failed (non-blocking):", matchErr);
        }
      }

      try {
        await scheduleMaintenanceNotifications(userId);
      } catch (notifErr) {
        console.error("scheduleMaintenanceNotifications failed (non-blocking):", notifErr);
      }

      queryClient.invalidateQueries({ queryKey: ["maintenance_logs"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", item.asset_id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_spending"] });
      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
      if (isVehicle && item.asset_id) {
        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", item.asset_id] });
      } else if (item.category === "property" && item.asset_id) {
        queryClient.invalidateQueries({ queryKey: ["properties"] });
        queryClient.invalidateQueries({ queryKey: ["property_tasks", item.asset_id] });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (err) {
      console.error("ConfirmCard save error:", err);
      setCardError("Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

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
        <FieldRow label="Date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <FieldRow label="Cost" value={cost} onChange={setCost} placeholder="0.00" keyboard="decimal-pad" prefix="$" />
        {isVehicle && (
          <FieldRow label="Mileage" value={mileage} onChange={setMileage} placeholder="0" keyboard="number-pad" suffix=" mi" />
        )}
        <FieldRow label="Provider" value={provider} onChange={setProvider} placeholder="Shop or clinic name" />
        <FieldRow label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
      </View>

      {!!cardError && <Text style={styles.confirmCardError}>{cardError}</Text>}

      <View style={styles.confirmActions}>
        <Pressable style={styles.confirmDiscardBtn} onPress={onDone} disabled={saving}>
          <Text style={styles.confirmDiscardText}>Discard</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmSaveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.confirmSaveBtnText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export function LogSheet({
  visible, onClose, userId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<"input" | "processing" | "results" | "error">("input");
  const [text, setText] = useState("");
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  function handleClose() {
    setText("");
    setPhase("input");
    setItems([]);
    setDoneCount(0);
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

      console.log("[extract-maintenance-data] data:", JSON.stringify(data));
      console.log("[extract-maintenance-data] error:", error);

      if (error) {
        const msg = (error as any)?.message ?? String(error);
        console.error("[extract-maintenance-data] invoke error:", msg);
        setErrorMsg(`Error: ${msg}`);
        setPhase("error");
        return;
      }

      if (data?.error) {
        console.error("[extract-maintenance-data] function error:", data.error);
        setErrorMsg(`Error: ${data.error}`);
        setPhase("error");
        return;
      }

      const extracted: ExtractedItem[] = data?.items ?? [];
      if (extracted.length === 0) {
        setErrorMsg("No maintenance items found. Try adding more detail (e.g. service type, vehicle, mileage).");
        setPhase("error");
        return;
      }
      setItems(extracted);
      setDoneCount(0);
      setPhase("results");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error("[extract-maintenance-data] caught:", msg);
      setErrorMsg(`Error: ${msg}`);
      setPhase("error");
    }
  }

  function markDone() {
    const next = doneCount + 1;
    setDoneCount(next);
    if (next >= items.length) {
      setTimeout(handleClose, 500);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1 }}>
        <Pressable style={styles.sheetOverlay} onPress={handleClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.sheetKAV}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.sheetHandleBar} />

            <View style={styles.sheetHeader}>
              <View style={styles.sheetIconWrap}>
                <Ionicons name="mic-outline" size={17} color={Colors.accent} />
              </View>
              <Text style={styles.sheetTitle}>Log Maintenance</Text>
              <Pressable onPress={handleClose} hitSlop={10} style={styles.sheetCloseBtn}>
                <Ionicons name="close" size={20} color={Colors.textTertiary} />
              </Pressable>
            </View>

            {(phase === "input" || phase === "error") && (
              <View style={{ gap: 12 }}>
                {phase === "error" && (
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
                    placeholder="Tap the mic on your keyboard to speak, or type here"
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    numberOfLines={4}
                    autoFocus
                    textAlignVertical="top"
                    returnKeyType="default"
                  />
                  <Text style={styles.sheetHint}>Use your keyboard{"'"}s microphone button to dictate</Text>
                </View>
                <Pressable
                  style={[styles.sheetProcessBtn, !text.trim() && { opacity: 0.45 }]}
                  onPress={handleProcess}
                  disabled={!text.trim()}
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
                {items.map((item, idx) => (
                  <ConfirmCard key={idx} item={item} userId={userId} onDone={markDone} />
                ))}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheetKAV: {
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
    borderRadius: 8,
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
  confirmCardError: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
  },
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
    borderRadius: 8,
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
});
