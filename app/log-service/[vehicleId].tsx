import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import ReceiptScanButton from "@/components/ReceiptScanButton";
import { ReceiptScanResult } from "@/lib/receiptScanner";

export default function LogServiceScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [task, setTask] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [mileage, setMileage] = useState("");
  const [cost, setCost] = useState("");
  const [provider, setProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [scannedItems, setScannedItems] = useState<Array<{ name: string; cost: number | null; details: string | null }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ocrApplied, setOcrApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function formatDate(text: string) {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  function handleScanComplete(result: ReceiptScanResult) {
    if (result.date) setDate(result.date);
    if (result.mileage != null) setMileage(String(result.mileage));
    if (result.provider) setProvider(result.provider);

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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function handleSave() {
    if (!user || !vehicleId) return;
    setIsLoading(true);
    setError(null);

    try {
      if (scannedItems.length > 1) {
        const rows = scannedItems.map(item => ({
          user_id: user!.id,
          vehicle_id: vehicleId,
          service_name: item.name,
          service_date: date || new Date().toISOString().split("T")[0],
          mileage: mileage ? parseInt(mileage) : null,
          cost: item.cost,
          provider_name: provider.trim() || null,
          notes: item.details || null,
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
          mileage: mileage ? parseInt(mileage) : null,
          cost: cost ? parseFloat(cost) : null,
          provider_name: provider.trim() || null,
          notes: notes.trim() || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (err) throw err;
      }

      if (mileage) {
        await supabase.from("vehicles").update({
          mileage: parseInt(mileage),
          updated_at: new Date().toISOString(),
        }).eq("id", vehicleId);
        await supabase.from("vehicle_mileage_history").insert({
          vehicle_id: vehicleId,
          mileage: parseInt(mileage),
          recorded_at: date || new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
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
                <Text style={styles.ocrSuccessText}>Receipt scanned — fields auto-filled below</Text>
              </View>
            ) : null}
            <ReceiptScanButton onScanComplete={handleScanComplete} />
          </View>

          {scannedItems.length > 1 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Services Found ({scannedItems.length})</Text>
              {scannedItems.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.details && (
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 }}>{item.details}</Text>
                    )}
                  </View>
                  {item.cost != null && (
                    <Text style={styles.itemCost}>${item.cost.toFixed(2)}</Text>
                  )}
                </View>
              ))}
              <Text style={styles.itemHint}>
                Each service will be saved as a separate entry in your service history.
              </Text>
            </View>
          )}

          {scannedItems.length <= 1 && (
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
            </View>
            <View style={styles.row}>
              <Field label="Cost ($)" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  value={cost}
                  onChangeText={setCost}
                  placeholder="89.99"
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

          {scannedItems.length <= 1 && (
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  fieldGroup: { gap: 10 },
  groupLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8 },
  quickPicks: { gap: 8, paddingBottom: 4 },
  quickPick: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  quickPickSelected: { backgroundColor: Colors.vehicleMuted, borderColor: Colors.vehicle },
  quickPickText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  quickPickTextSelected: { color: Colors.vehicle },
  row: { flexDirection: "row", gap: 10 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  textArea: { height: 80, paddingTop: 12 },
  ocrSuccess: { flexDirection: "row", alignItems: "center", gap: 6 },
  ocrSuccessText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text, flex: 1 },
  itemCost: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.accent },
  itemHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
