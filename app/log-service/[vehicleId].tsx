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
  Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";

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
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function formatDate(text: string) {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  async function pickReceipt() {
    const [permission, requestPermission] = await ImagePicker.getCameraPermissionsAsync() as any;
    if (!permission?.granted) {
      await ImagePicker.requestCameraPermissionsAsync();
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
    }
  }

  async function handleSave() {
    if (!user || !vehicleId) return;
    if (!task.trim()) {
      setError("Service description is required");
      return;
    }
    setIsLoading(true);
    setError(null);

    const { error: err } = await supabase.from("maintenance_logs").insert({
      vehicle_id: vehicleId,
      task: task.trim(),
      date: date || new Date().toISOString().split("T")[0],
      mileage: mileage ? parseInt(mileage) : null,
      cost: cost ? parseFloat(cost) : null,
      provider: provider.trim() || null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (!err && mileage) {
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

    setIsLoading(false);
    if (err) {
      setError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
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

          <View style={styles.fieldGroup}>
            <Text style={styles.groupLabel}>Receipt</Text>
            {receiptUri ? (
              <View style={styles.receiptPreview}>
                <Image source={{ uri: receiptUri }} style={styles.receiptImage} resizeMode="cover" />
                <Pressable onPress={() => setReceiptUri(null)} style={styles.removeReceipt}>
                  <Ionicons name="close-circle" size={24} color={Colors.overdue} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.receiptRow}>
                <Pressable style={({ pressed }) => [styles.receiptBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={takePhoto}>
                  <Ionicons name="camera-outline" size={20} color={Colors.textSecondary} />
                  <Text style={styles.receiptBtnText}>Camera</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.receiptBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={pickReceipt}>
                  <Ionicons name="image-outline" size={20} color={Colors.textSecondary} />
                  <Text style={styles.receiptBtnText}>Gallery</Text>
                </Pressable>
              </View>
            )}
          </View>
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
  receiptRow: { flexDirection: "row", gap: 10 },
  receiptBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.card, borderRadius: 12, paddingVertical: 16, borderWidth: 1, borderColor: Colors.border, borderStyle: "dashed" },
  receiptBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  receiptPreview: { borderRadius: 12, overflow: "hidden", position: "relative" },
  receiptImage: { width: "100%", height: 180 },
  removeReceipt: { position: "absolute", top: 8, right: 8 },
});
