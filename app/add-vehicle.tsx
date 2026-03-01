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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "truck", label: "Truck" },
  { value: "suv", label: "SUV" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "superbike", label: "Superbike" },
  { value: "rv", label: "RV / Camper" },
  { value: "boat", label: "Boat" },
  { value: "atv", label: "ATV / Off-road" },
  { value: "electric", label: "Electric Vehicle" },
  { value: "other", label: "Other" },
];

export default function AddVehicleScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [nickname, setNickname] = useState("");
  const [vehicleType, setVehicleType] = useState("car");
  const [mileage, setMileage] = useState("");
  const [isSeasonal, setIsSeasonal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!user) return;
    if (!year || !make || !model) {
      setError("Year, make, and model are required");
      return;
    }
    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 2) {
      setError("Please enter a valid year");
      return;
    }
    setIsLoading(true);
    setError(null);
    const { error: err } = await supabase.from("vehicles").insert({
      user_id: user.id,
      year: yearNum,
      make: make.trim(),
      model: model.trim(),
      trim: trim.trim() || null,
      nickname: nickname.trim() || null,
      vehicle_type: vehicleType,
      mileage: mileage ? parseInt(mileage) : null,
      is_seasonal: isSeasonal,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setIsLoading(false);
    if (err) {
      setError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Vehicle</Text>
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

          <FieldGroup label="Vehicle Type">
            <View style={styles.typeGrid}>
              {VEHICLE_TYPES.map(t => (
                <Pressable
                  key={t.value}
                  style={[styles.typeOption, vehicleType === t.value && styles.typeOptionSelected]}
                  onPress={() => { Haptics.selectionAsync(); setVehicleType(t.value); }}
                >
                  <Text style={[styles.typeOptionText, vehicleType === t.value && styles.typeOptionTextSelected]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </FieldGroup>

          <FieldGroup label="Basic Info">
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <TextInputField
                  label="Year *"
                  value={year}
                  onChangeText={setYear}
                  placeholder="2022"
                  keyboardType="numeric"
                  maxLength={4}
                />
              </View>
              <View style={{ flex: 2 }}>
                <TextInputField label="Make *" value={make} onChangeText={setMake} placeholder="Toyota" autoCapitalize="words" />
              </View>
            </View>
            <TextInputField label="Model *" value={model} onChangeText={setModel} placeholder="Camry" autoCapitalize="words" />
            <TextInputField label="Trim" value={trim} onChangeText={setTrim} placeholder="XSE" autoCapitalize="words" />
            <TextInputField label="Nickname" value={nickname} onChangeText={setNickname} placeholder="Daily driver, My truck, etc." autoCapitalize="words" />
          </FieldGroup>

          <FieldGroup label="Mileage">
            <TextInputField label="Current Mileage" value={mileage} onChangeText={setMileage} placeholder="45000" keyboardType="numeric" />
          </FieldGroup>

          <FieldGroup label="Options">
            <Pressable
              style={styles.toggleRow}
              onPress={() => { Haptics.selectionAsync(); setIsSeasonal(!isSeasonal); }}
            >
              <View>
                <Text style={styles.toggleLabel}>Seasonal Vehicle</Text>
                <Text style={styles.toggleSub}>Motorcycles, boats, snowmobiles, etc.</Text>
              </View>
              <View style={[styles.toggle, isSeasonal && styles.toggleOn]}>
                <View style={[styles.toggleThumb, isSeasonal && styles.toggleThumbOn]} />
              </View>
            </Pressable>
          </FieldGroup>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldGroupLabel}>{label}</Text>
      <View style={styles.fieldGroupContent}>{children}</View>
    </View>
  );
}

function TextInputField({ label, value, onChangeText, placeholder, keyboardType, maxLength, autoCapitalize }: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: any;
  maxLength?: number;
  autoCapitalize?: any;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textTertiary}
        keyboardType={keyboardType ?? "default"}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize ?? "none"}
        returnKeyType="done"
      />
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
  fieldGroupLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8 },
  fieldGroupContent: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  fieldInput: {
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
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  typeOptionSelected: { backgroundColor: Colors.vehicleMuted, borderColor: Colors.vehicle },
  typeOptionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  typeOptionTextSelected: { color: Colors.vehicle },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.border },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: Colors.border, justifyContent: "center", paddingHorizontal: 2 },
  toggleOn: { backgroundColor: Colors.accent },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },
});
