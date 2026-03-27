import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import ReceiptScanButton from "@/components/ReceiptScanButton";
import Paywall from "@/components/Paywall";
import ScanPackModal from "@/components/ScanPackModal";
import { isFreeTier, scansRemaining } from "@/lib/subscription";
import { ReceiptScanResult } from "@/lib/receiptScanner";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import { parseISO, format } from "date-fns";
import { matchAndUpdateVehicleTask, CATEGORY_GROUPS, type MatchResult } from "@/lib/maintenanceMatcher";
import { resolveTrackingMode, isHoursTracked, isMileageTracked } from "@/lib/usageHelpers";

type PricingInsight = {
  cost: number | null;
  provider: string | null;
  assetName: string;
  date: string | null;
};

type ScannedItem = { name: string; cost: number | null; details: string | null };

export default function LogServiceScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [showPaywall, setShowPaywall] = useState(false);
  const [showScanPack, setShowScanPack] = useState(false);
  const [task, setTask] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [mileage, setMileage] = useState("");
  const [cost, setCost] = useState("");
  const [provider, setProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [editingField, setEditingField] = useState<{ index: number; field: "name" | "cost" } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ocrApplied, setOcrApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptLocalUri, setReceiptLocalUri] = useState<string | null>(null);
  const [receiptWarning, setReceiptWarning] = useState(false);
  const [pricingInsight, setPricingInsight] = useState<PricingInsight | null>(null);
  const insightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [vehicleData, setVehicleData] = useState<any>(null);
  const [trackingMode, setTrackingMode] = useState<string | null>(null);
  const [hoursReading, setHoursReading] = useState("");

  useEffect(() => {
    if (!vehicleId) return;
    supabase
      .from("vehicles")
      .select("vehicle_type, tracking_mode, hours, mileage")
      .eq("id", vehicleId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setVehicleType(data.vehicle_type);
          setTrackingMode(data.tracking_mode);
          setVehicleData(data);
        }
      });
  }, [vehicleId]);

  const usageMode = resolveTrackingMode({ vehicle_type: vehicleType, tracking_mode: trackingMode });

  const itemsTotal = scannedItems.length > 0
    ? scannedItems.reduce((sum, item) => sum + (item.cost ?? 0), 0)
    : null;

  useEffect(() => {
    if (insightTimerRef.current) clearTimeout(insightTimerRef.current);
    const trimmed = task.trim();
    if (!trimmed || trimmed.length < 3 || !user) {
      setPricingInsight(null);
      return;
    }
    insightTimerRef.current = setTimeout(async () => {
      try {
        const { data: otherLogs } = await supabase
          .from("maintenance_logs")
          .select("*")
          .eq("user_id", user.id)
          .order("service_date", { ascending: false })
          .limit(100);

        const relevantLogs = (otherLogs ?? []).filter(
          l => l.vehicle_id !== vehicleId
        );
        if (relevantLogs.length === 0) { setPricingInsight(null); return; }

        const norm = (s: string) =>
          s.toLowerCase().replace(/[&,.()\-\/+]/g, " ").replace(/\s+/g, " ").trim();
        const serviceNorm = norm(trimmed);

        let bestLog: any = null;
        let bestScore = 0;
        for (const log of relevantLogs) {
          const logNorm = norm(log.service_name ?? "");
          let score = 0;
          const sWords = serviceNorm.split(" ").filter(w => w.length >= 3);
          const lWords = logNorm.split(" ").filter(w => w.length >= 3);
          for (const sw of sWords) {
            if (lWords.some(lw => lw === sw || lw.includes(sw) || sw.includes(lw))) score += 2;
          }
          for (const group of CATEGORY_GROUPS) {
            const svcHas = group.some(kw => serviceNorm.includes(kw));
            const logHas = group.some(kw => logNorm.includes(kw));
            if (svcHas && logHas) score += 3;
          }
          if (score >= 3 && score > bestScore) { bestScore = score; bestLog = log; }
        }

        if (!bestLog) { setPricingInsight(null); return; }

        let assetName = "another asset";
        if (bestLog.vehicle_id) {
          const { data: veh } = await supabase
            .from("vehicles")
            .select("year, make, model, nickname")
            .eq("id", bestLog.vehicle_id)
            .maybeSingle();
          if (veh) assetName = veh.nickname ?? `${veh.year} ${veh.make} ${veh.model}`;
        } else if (bestLog.property_id) {
          const { data: prop } = await supabase
            .from("properties")
            .select("name")
            .eq("id", bestLog.property_id)
            .maybeSingle();
          if (prop) assetName = prop.name;
        }

        setPricingInsight({
          cost: bestLog.cost,
          provider: bestLog.provider_name,
          assetName,
          date: bestLog.service_date,
        });
      } catch {
        setPricingInsight(null);
      }
    }, 700);
    return () => { if (insightTimerRef.current) clearTimeout(insightTimerRef.current); };
  }, [task, user?.id, vehicleId]);

  function formatDate(text: string) {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  function handleScanComplete(result: ReceiptScanResult) {
    console.log("Scan result:", JSON.stringify(result));
    console.log("Scan result fields - task:", result.task, "serviceType:", result.serviceType, "cost:", result.cost, "provider:", result.provider, "mileage:", result.mileage, "date:", result.date);
    if (result.date) setDate(result.date);
    if (result.mileage != null) setMileage(String(result.mileage));
    if (result.provider) setProvider(result.provider);
    if (result.localUri) setReceiptLocalUri(result.localUri);

    if (result.items && result.items.length > 1) {
      setScannedItems(result.items);
      setCost(result.cost != null ? String(result.cost) : "");
      setTask(result.task || "");
    } else {
      if (result.task) setTask(result.task);
      else if (result.serviceType) setTask(result.serviceType);
      if (result.cost != null) setCost(String(result.cost));
      setScannedItems([]);
    }

    setOcrApplied(true);
    setReceiptWarning(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function uploadReceiptImage(localUri: string, userId: string, assetId: string): Promise<string | null> {
    try {
      const timestamp = Date.now();
      const path = `${userId}/vehicle/${assetId}/${timestamp}.jpg`;
      const response = await fetch(localUri);
      const blob = await response.blob();
      const { data, error: uploadErr } = await supabase.storage
        .from("receipts")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (uploadErr) throw uploadErr;
      return data.path;
    } catch (err) {
      console.error("Receipt upload failed:", err);
      return null;
    }
  }

  function updateItem(index: number, patch: Partial<ScannedItem>) {
    setScannedItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function deleteItem(index: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingField(null);
    setScannedItems(prev => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newIndex = scannedItems.length;
    setScannedItems(prev => [...prev, { name: "", cost: null, details: null }]);
    setEditingField({ index: newIndex, field: "name" });
  }

  // ─────────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (isLoading) return;
    if (!user || !vehicleId) return;
    setIsLoading(true);
    setError(null);
    setReceiptWarning(false);

    try {
      let storedReceiptPath: string | null = null;
      if (receiptLocalUri) {
        storedReceiptPath = await uploadReceiptImage(receiptLocalUri, user.id, vehicleId);
        if (!storedReceiptPath) {
          setReceiptWarning(true);
        }
      }

      let milesVal: number | null = null;
      let hoursVal: number | null = null;
      if (usageMode === "both") {
        if (mileage.trim()) milesVal = parseInt(mileage.replace(/,/g, ""), 10);
        if (hoursReading.trim()) hoursVal = parseFloat(hoursReading.replace(/,/g, ""));
      } else if (usageMode === "hours") {
        if (mileage.trim()) hoursVal = parseFloat(mileage.replace(/,/g, ""));
      } else if (usageMode === "mileage") {
        if (mileage.trim()) milesVal = parseInt(mileage.replace(/,/g, ""), 10);
      }
      const logMeter = milesVal ?? hoursVal ?? null;

      if (scannedItems.length > 0) {
        const rows = scannedItems.map(item => ({
          user_id: user!.id,
          vehicle_id: vehicleId,
          service_name: item.name || "Service",
          service_date: date || new Date().toISOString().split("T")[0],
          mileage: logMeter,
          cost: item.cost,
          provider_name: provider.trim() || null,
          notes: item.details || null,
          receipt_url: storedReceiptPath,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        const { error: err } = await supabase.from("maintenance_logs").insert(rows);
        if (err) throw err;
      } else {
        if (!task.trim()) {
          setError("Service description is required");
          setIsLoading(false);
          return;
        }
        const { error: err } = await supabase.from("maintenance_logs").insert({
          user_id: user!.id,
          vehicle_id: vehicleId,
          service_name: task.trim(),
          service_date: date || new Date().toISOString().split("T")[0],
          mileage: logMeter,
          cost: cost ? parseFloat(cost) : null,
          provider_name: provider.trim() || null,
          notes: notes.trim() || null,
          receipt_url: storedReceiptPath,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (err) throw err;
      }

      const nowIso = new Date().toISOString();
      if (hoursVal != null) {
        await supabase.from("vehicles").update({
          hours: hoursVal,
          updated_at: nowIso,
        }).eq("id", vehicleId);
      }
      if (milesVal != null) {
        await supabase.from("vehicles").update({
          mileage: milesVal,
          updated_at: nowIso,
        }).eq("id", vehicleId);
        await supabase.from("vehicle_mileage_history").insert({
          vehicle_id: vehicleId,
          mileage: milesVal,
          recorded_at: date || new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle_tasks", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      if (user?.id) {
        scheduleMaintenanceNotifications(user.id);
      }

      // Try to auto-update matching maintenance tasks
      const serviceNames = scannedItems.length > 0
        ? scannedItems.map(i => i.name).filter(Boolean)
        : [task.trim()].filter(Boolean);
      const updatedTasks: MatchResult[] = [];
      for (const name of serviceNames) {
        const result = await matchAndUpdateVehicleTask(vehicleId, name, date, milesVal, hoursVal);
        if (result) updatedTasks.push(result);
      }

      if (updatedTasks.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["vehicle_tasks", vehicleId] });
        queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
        const fmt = (iso: string | null) => iso
          ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : null;
        const lines = updatedTasks.map(t => {
          const due = fmt(t.nextDue);
          return due ? `• ${t.taskName}\n  Next due: ${due}` : `• ${t.taskName}`;
        }).join("\n\n");
        const warnSuffix = storedReceiptPath === null && receiptLocalUri
          ? "\n\nNote: Receipt saved but photo could not be uploaded."
          : "";
        Alert.alert("Maintenance Updated", lines + warnSuffix, [{ text: "OK", onPress: () => router.back() }]);
      } else if (storedReceiptPath === null && receiptLocalUri) {
        Alert.alert("Saved", "Receipt saved but photo could not be uploaded.", [{ text: "OK", onPress: () => router.back() }]);
      } else {
        router.back();
      }
    } catch (err: any) {
      setError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  }

  const COMMON_TASKS = ["Oil Change", "Tire Rotation", "Brake Service", "Air Filter", "Fluid Top-off", "Inspection", "Transmission Service", "Battery Replacement"];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Log Service</Text>
          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={handleSave}
            disabled={isLoading}
          >
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.groupLabel}>Receipt</Text>
            {ocrApplied ? (
              <View style={styles.ocrSuccess}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.good} />
                <Text style={styles.ocrSuccessText}>Receipt scanned. Fields auto-filled below.</Text>
              </View>
            ) : null}
            {isFreeTier(profile) ? (
              <Pressable
                style={styles.scanGateBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPaywall(true); }}
              >
                <Ionicons name="camera-outline" size={16} color={Colors.accent} />
                <Text style={styles.scanGateBtnText}>Scan Receipt</Text>
                <View style={styles.scanLockedBadge}>
                  <Ionicons name="lock-closed" size={10} color={Colors.textInverse} />
                  <Text style={styles.scanLockedText}>Upgrade</Text>
                </View>
              </Pressable>
            ) : scansRemaining(profile) <= 0 ? (
              <Pressable
                style={styles.scanGateBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowScanPack(true); }}
              >
                <Ionicons name="camera-outline" size={16} color={Colors.accent} />
                <Text style={styles.scanGateBtnText}>Scan Receipt</Text>
                <View style={[styles.scanLockedBadge, { backgroundColor: Colors.dueSoon }]}>
                  <Text style={styles.scanLockedText}>0 left</Text>
                </View>
              </Pressable>
            ) : (
              <View>
                {scansRemaining(profile) <= 5 && (
                  <View style={styles.scanBadgeRow}>
                    <Ionicons name="information-circle-outline" size={13} color={Colors.dueSoon} />
                    <Text style={styles.scanBadgeText}>{scansRemaining(profile)} scan{scansRemaining(profile) !== 1 ? "s" : ""} left this month</Text>
                  </View>
                )}
                <ReceiptScanButton onScanComplete={handleScanComplete} />
              </View>
            )}
          </View>

          {scannedItems.length > 0 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Services Found ({scannedItems.length})</Text>

              {scannedItems.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <View style={styles.itemLeft}>
                    {editingField?.index === index && editingField?.field === "name" ? (
                      <TextInput
                        autoFocus
                        style={styles.itemEditInput}
                        value={item.name}
                        onChangeText={text => updateItem(index, { name: text })}
                        onBlur={() => setEditingField(null)}
                        returnKeyType="done"
                        onSubmitEditing={() => setEditingField(null)}
                        placeholderTextColor={Colors.textTertiary}
                        placeholder="Service name"
                      />
                    ) : (
                      <Pressable onPress={() => { Haptics.selectionAsync(); setEditingField({ index, field: "name" }); }}>
                        <Text style={styles.itemName}>{item.name || "Tap to name"}</Text>
                        {item.details && (
                          <Text style={styles.itemDetails}>{item.details}</Text>
                        )}
                      </Pressable>
                    )}
                  </View>

                  <View style={styles.itemRight}>
                    {editingField?.index === index && editingField?.field === "cost" ? (
                      <TextInput
                        autoFocus
                        style={styles.itemCostInput}
                        value={item.cost != null ? String(item.cost) : ""}
                        onChangeText={text => updateItem(index, { cost: text ? parseFloat(text) : null })}
                        onBlur={() => setEditingField(null)}
                        onSubmitEditing={() => setEditingField(null)}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        placeholder="0.00"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    ) : (
                      <Pressable onPress={() => { Haptics.selectionAsync(); setEditingField({ index, field: "cost" }); }}>
                        <Text style={[styles.itemCost, item.cost == null && styles.itemCostEmpty]}>
                          {item.cost != null ? `$${item.cost.toFixed(2)}` : "$ -"}
                        </Text>
                      </Pressable>
                    )}

                    <Pressable
                      onPress={() => deleteItem(index)}
                      style={styles.itemDeleteBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
                    </Pressable>
                  </View>
                </View>
              ))}

              <Pressable
                style={({ pressed }) => [styles.addItemBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={addItem}
              >
                <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
                <Text style={styles.addItemText}>Add Item</Text>
              </Pressable>

              <Text style={styles.itemHint}>
                Tap any name or cost to edit. Each item saves as a separate log entry.
              </Text>
            </View>
          )}

          {scannedItems.length === 0 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Service Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickPicks}>
                {COMMON_TASKS.map(t => (
                  <Pressable
                    key={t}
                    style={[styles.quickPick, task === t && styles.quickPickSelected]}
                    onPress={() => { Haptics.selectionAsync(); setTask(t); }}
                  >
                    <Text style={[styles.quickPickText, task === t && styles.quickPickTextSelected]}>{t}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput
                style={styles.input}
                value={task}
                onChangeText={setTask}
                placeholder="Or describe the service..."
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="done"
              />
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.groupLabel}>Details</Text>
            <View style={styles.row}>
              <Field label="Date" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  value={date}
                  onChangeText={t => setDate(formatDate(t))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                  maxLength={10}
                />
              </Field>
              {vehicleData && (isMileageTracked(vehicleData) || isHoursTracked(vehicleData)) && usageMode !== "both" && (
                <Field label={isHoursTracked(vehicleData) ? "Hours" : "Mileage"} style={{ flex: 1 }}>
                  <TextInput
                    style={styles.input}
                    value={mileage}
                    onChangeText={setMileage}
                    placeholder={isHoursTracked(vehicleData) ? "e.g. 150" : "45000"}
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType={isHoursTracked(vehicleData) ? "decimal-pad" : "numeric"}
                  />
                </Field>
              )}
              {usageMode === "both" && (
                <>
                  <Field label="Mileage" style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      value={mileage}
                      onChangeText={setMileage}
                      placeholder="45000"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="numeric"
                    />
                  </Field>
                  <Field label="Hours" style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      value={hoursReading}
                      onChangeText={setHoursReading}
                      placeholder="e.g. 125.5"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="decimal-pad"
                    />
                  </Field>
                </>
              )}
            </View>
            <View style={styles.row}>
              <Field label={scannedItems.length > 0 ? "Total Cost" : "Cost ($)"} style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, scannedItems.length > 0 && styles.inputDerived]}
                  value={scannedItems.length > 0
                    ? (itemsTotal != null ? itemsTotal.toFixed(2) : "")
                    : cost}
                  onChangeText={scannedItems.length > 0 ? undefined : setCost}
                  editable={scannedItems.length === 0}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                />
              </Field>
              <Field label="Provider" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  value={provider}
                  onChangeText={setProvider}
                  placeholder="Jiffy Lube, etc."
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="words"
                />
              </Field>
            </View>
          </View>

          {pricingInsight && scannedItems.length === 0 && (
            <PricingInsightBanner insight={pricingInsight} />
          )}

          {scannedItems.length === 0 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional notes..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          )}
        </ScrollView>
      </View>
      {showPaywall && (
        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <Paywall
            canDismiss
            subtitle="Upgrade to scan receipts with AI"
            onDismiss={() => setShowPaywall(false)}
          />
        </Modal>
      )}
      <ScanPackModal
        visible={showScanPack}
        onClose={() => setShowScanPack(false)}
        onSuccess={() => setShowScanPack(false)}
      />
    </KeyboardAvoidingView>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: any }) {
  return (
    <View style={[{ gap: 5 }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function PricingInsightBanner({ insight }: { insight: PricingInsight }) {
  const dateStr = insight.date
    ? format(parseISO(insight.date), "MMM yyyy")
    : null;

  const parts: string[] = [];
  if (insight.cost != null) parts.push(`$${insight.cost.toFixed(2)}`);
  if (insight.provider) parts.push(`at ${insight.provider}`);
  parts.push(`on your ${insight.assetName}`);
  if (dateStr) parts.push(`(${dateStr})`);

  const label = insight.cost != null
    ? `You paid ${parts.join(" ")}`
    : `Previously logged ${parts.join(" ")}`;

  return (
    <View style={insightStyles.banner}>
      <Ionicons name="information-circle-outline" size={14} color={Colors.accent} style={{ flexShrink: 0, marginTop: 1 }} />
      <Text style={insightStyles.text} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    backgroundColor: Colors.accentMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 17,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  fieldGroup: { gap: 10 },
  groupLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  quickPicks: { gap: 8, paddingBottom: 4 },
  quickPick: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  quickPickSelected: { backgroundColor: Colors.vehicleMuted, borderColor: Colors.vehicle },
  quickPickText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  quickPickTextSelected: { color: Colors.vehicle },
  row: { flexDirection: "row", gap: 10 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  inputDerived: {
    color: Colors.textSecondary,
    backgroundColor: Colors.background,
  },
  textArea: { height: 80, paddingTop: 12 },
  ocrSuccess: { flexDirection: "row", alignItems: "center", gap: 6 },
  ocrSuccessText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good },
  scanGateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  scanGateBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.accent },
  scanLockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scanLockedText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scanBadgeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  scanBadgeText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dueSoon },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  itemLeft: { flex: 1 },
  itemRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  itemDetails: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 },
  itemCost: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.accent },
  itemCostEmpty: { color: Colors.textTertiary, fontFamily: "Inter_400Regular" },
  itemEditInput: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
    paddingVertical: 2,
    minWidth: 80,
  },
  itemCostInput: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
    paddingVertical: 2,
    textAlign: "right",
    minWidth: 54,
  },
  itemDeleteBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
    borderStyle: "dashed",
    justifyContent: "center",
  },
  addItemText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent },
  itemHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
