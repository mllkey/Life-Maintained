import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  Keyboard,
  InputAccessoryView,
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
import { HOURS_TRACKED_TYPES, MILEAGE_TRACKED_TYPES, inferTrackingMode } from "@/lib/vehicleTypes";
import { SaveToast } from "@/components/SaveToast";
import { currentUsageValue } from "@/lib/usageHelpers";
import type { Database } from "@/lib/supabase-types";

type VehicleUpdate = Database["public"]["Tables"]["vehicles"]["Update"];

const VEHICLE_TYPE_OPTIONS = [
  { value: "car", label: "Car / Truck / SUV" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "semi_truck", label: "Semi Truck" },
  { value: "rv", label: "RV / Camper" },
  { value: "boat", label: "Boat" },
  { value: "atv", label: "ATV" },
  { value: "utv", label: "UTV / Side-by-Side" },
  { value: "pwc", label: "Personal Watercraft" },
  { value: "snowmobile", label: "Snowmobile" },
  { value: "trailer", label: "Trailer" },
  { value: "dump_truck", label: "Dump Truck" },
  { value: "dumpster", label: "Dumpster" },
  { value: "other", label: "Other" },
];

export default function EditVehicleScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vehicle, setVehicle] = useState<any>(null);
  const [nickname, setNickname] = useState("");
  const [mileage, setMileage] = useState("");
  const [hours, setHours] = useState("");
  const [color, setColor] = useState("");
  const [trim, setTrim] = useState("");
  const [vehicleType, setVehicleType] = useState("car");
  const [avgMilesPerMonth, setAvgMilesPerMonth] = useState("");
  const [mileageWarning, setMileageWarning] = useState<string | null>(null);
  const [correctingReading, setCorrectingReading] = useState(false);
  const [showSaveErrorToast, setShowSaveErrorToast] = useState(false);
  const [saveErrorSubtitle, setSaveErrorSubtitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!vehicleId) return;
    supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setVehicle(data);
          setNickname(data.nickname ?? "");
          setMileage(data.mileage != null ? String(data.mileage) : "");
          setHours(data.hours != null ? String(data.hours) : "");
          setColor(data.color ?? "");
          setTrim(data.trim ?? "");
          setVehicleType(data.vehicle_type ?? "car");
          setAvgMilesPerMonth(data.average_miles_per_month != null ? String(data.average_miles_per_month) : "");
        }
        setLoading(false);
      });
  }, [vehicleId]);

  const tracksMileage = MILEAGE_TRACKED_TYPES.has(vehicleType);
  const tracksHours = HOURS_TRACKED_TYPES.has(vehicleType);
  const vehicleTitle = vehicle
    ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
    : "Vehicle";

  async function handleSave() {
    if (!vehicle || !user) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updates: VehicleUpdate = {
      nickname: nickname.trim() || null,
      color: color.trim() || null,
      trim: trim.trim() || null,
      vehicle_type: vehicleType,
    };

    if (tracksMileage && mileage.trim()) {
      const newMileage = parseInt(mileage, 10);
      if (isNaN(newMileage) || newMileage < 0) {
        setMileageWarning("Enter a valid mileage.");
        setSaving(false);
        return;
      }
      const currentMileage = vehicle.mileage ?? 0;
      if (currentMileage > 0 && newMileage < currentMileage && !correctingReading) {
        setMileageWarning(
          `Mileage can only go up. Current: ${currentMileage.toLocaleString()} mi. If the shown number is wrong, tap "Correct reading" below.`,
        );
        setSaving(false);
        return;
      }
      if (newMileage !== currentMileage) {
        // Re-anchor on every accepted reading write (up OR corrected-down) so the projection
        // clock restarts from the value the user just entered.
        updates.mileage = newMileage;
        updates.last_mileage_update = new Date().toISOString();
      }
    }

    if (tracksHours && hours.trim()) {
      const newHours = parseFloat(hours);
      if (!isNaN(newHours) && newHours >= 0) {
        const currentHours = vehicle.hours ?? 0;
        if (currentHours > 0 && newHours < currentHours && !correctingReading) {
          setMileageWarning('Hours can only go up. If the shown number is wrong, tap "Correct reading" below.');
          setSaving(false);
          return;
        }
        updates.hours = newHours;
        updates.last_hours_update = new Date().toISOString();
      }
    }

    // Driving habits change: when the monthly estimate is edited or cleared,
    // crystallize the miles accrued at the OLD rate into stored mileage and reset
    // the clock, so the new rate only drives accrual going forward (never the past).
    if (tracksMileage || tracksHours) {
      const raw = avgMilesPerMonth.trim();
      let newRate: number | null = null;
      if (raw !== "") {
        if (!/^[0-9]+$/.test(raw)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setSaving(false);
          return;
        }
        const n = parseInt(raw, 10);
        if (n < 1 || n > 10000) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setSaving(false);
          return;
        }
        newRate = n;
      }
      if (newRate !== (vehicle.average_miles_per_month ?? null)) {
        updates.average_miles_per_month = newRate;
        // Re-anchor the projection clock to NOW at the stored value, WITHOUT writing the
        // projected estimate into stored mileage. The new rate then only drives future
        // accrual; past time is never retroactively recomputed at the new rate. (Previously
        // this crystallized the always-inflated projection into stored mileage, which the
        // up-only guard then locked in — a guaranteed trap on every rate edit.)
        if (tracksMileage && updates.mileage == null) {
          updates.last_mileage_update = new Date().toISOString();
        }
      }
    }

    updates.tracking_mode = inferTrackingMode(vehicleType as string);

    try {
      const { error } = await supabase.from("vehicles").update(updates).eq("id", vehicleId!);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setCorrectingReading(false);
      setTimeout(() => router.back(), 150);
    } catch (err: any) {
      setSaveErrorSubtitle("Give it another shot.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setShowSaveErrorToast(true);
      setTimeout(() => setShowSaveErrorToast(false), 2800);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit {vehicleTitle}</Text>
        <View style={{ width: 24 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.field}>
            <Text style={styles.label}>Vehicle Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {VEHICLE_TYPE_OPTIONS.map(opt => (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setVehicleType(opt.value);
                    Haptics.selectionAsync();
                  }}
                  style={[styles.typePill, vehicleType === opt.value && styles.typePillActive]}
                >
                  <Text style={[styles.typePillText, vehicleType === opt.value && styles.typePillTextActive]}>{opt.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Nickname <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={nickname}
              onChangeText={setNickname}
              placeholder="e.g. Big Bertha"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          {tracksMileage && (
            <View style={styles.field}>
              <Text style={styles.label}>Mileage</Text>
              <TextInput
                style={styles.input}
                value={mileage}
                onChangeText={(t) => {
                  setMileage(t);
                  setMileageWarning(null);
                }}
                keyboardType="number-pad"
                inputAccessoryViewID="mileageToolbar"
                placeholder={vehicle?.mileage != null ? String(vehicle.mileage) : "e.g. 67331"}
                placeholderTextColor={Colors.textTertiary}
              />
              {mileageWarning && (
                mileageWarning === "Enter a valid mileage." ? (
                  <Text style={styles.warning}>{mileageWarning}</Text>
                ) : (
                  <View>
                    <Text style={styles.warning}>
                      Mileage can only go up. Current: {(vehicle?.mileage ?? 0).toLocaleString()} mi. If you made a typo, email{" "}
                      <Text
                        style={{ textDecorationLine: "underline", fontFamily: "Inter_600SemiBold" }}
                        onPress={() => Linking.openURL("mailto:support@lifemaintained.com?subject=Mileage%20Correction%20Request")}
                      >
                        support@lifemaintained.com
                      </Text>
                    </Text>
                  </View>
                )
              )}
              <Text style={styles.hint}>Mileage can be increased but cannot be lowered.</Text>
              {correctingReading ? (
                <View>
                  <Text style={[styles.hint, { color: Colors.accent }]}>
                    Correction on — only change this if the shown number is wrong; it should match your real odometer.
                  </Text>
                  <Pressable
                    onPress={() => { setCorrectingReading(false); setMileageWarning(null); }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel correction"
                  >
                    <Text style={[styles.hint, { color: Colors.textSecondary, textDecorationLine: "underline" }]}>
                      Cancel correction
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => { setCorrectingReading(true); setMileageWarning(null); }}
                  accessibilityRole="button"
                  accessibilityLabel="Correct reading"
                >
                  <Text style={[styles.hint, { color: Colors.accent, textDecorationLine: "underline" }]}>
                    Correct reading
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {tracksHours && (
            <View style={styles.field}>
              <Text style={styles.label}>Hours</Text>
              <TextInput style={styles.input} value={hours} onChangeText={setHours} keyboardType="number-pad" placeholder="e.g. 1250" placeholderTextColor={Colors.textTertiary} />
              <Text style={styles.hint}>Hours can be increased but cannot be lowered.</Text>
              {correctingReading ? (
                <View>
                  <Text style={[styles.hint, { color: Colors.accent }]}>
                    Correction on — only change this if the shown number is wrong; it should match your real hour meter.
                  </Text>
                  <Pressable
                    onPress={() => { setCorrectingReading(false); setMileageWarning(null); }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel correction"
                  >
                    <Text style={[styles.hint, { color: Colors.textSecondary, textDecorationLine: "underline" }]}>
                      Cancel correction
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => { setCorrectingReading(true); setMileageWarning(null); }}
                  accessibilityRole="button"
                  accessibilityLabel="Correct reading"
                >
                  <Text style={[styles.hint, { color: Colors.accent, textDecorationLine: "underline" }]}>
                    Correct reading
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {(tracksMileage || tracksHours) && (
            <View style={styles.field}>
              <Text style={styles.label}>{tracksHours ? "Estimated Monthly Hours" : "Estimated Monthly Miles"}</Text>
              <TextInput
                accessibilityLabel={tracksHours ? "Estimated monthly hours" : "Estimated monthly miles"}
                style={styles.input}
                value={avgMilesPerMonth}
                onChangeText={(t) => {
                  setAvgMilesPerMonth(t);
                  setMileageWarning(null);
                }}
                keyboardType="number-pad"
                inputAccessoryViewID="mileageToolbar"
                placeholder={tracksHours ? "e.g. 40" : "e.g. 800"}
                placeholderTextColor={Colors.textTertiary}
              />
              {avgMilesPerMonth.trim().length > 0 && (() => {
                const raw = avgMilesPerMonth.trim();
                const n = parseInt(raw, 10);
                const invalid = !/^[0-9]+$/.test(raw) || n < 1 || n > 10000;
                return invalid ? (
                  <Text style={styles.warning}>Must be a whole number from 1 to 10,000.</Text>
                ) : null;
              })()}
              <Text style={styles.hint}>
                {tracksHours
                  ? "Used to estimate when usage-based service is due."
                  : "We use this to estimate mileage between updates as your driving changes. Clear it to stop estimating."}
              </Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>
              Trim <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={trim}
              onChangeText={setTrim}
              placeholder="e.g. XLT, Touring, SR5"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Color <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={color}
              onChangeText={setColor}
              placeholder="e.g. White"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          {vehicle?.engine_size && (
            <View style={styles.field}>
              <Text style={styles.label}>Engine</Text>
              <Text style={styles.readonlyValue}>
                {vehicle.engine_size}
                {vehicle.engine_cylinders ? ` / ${vehicle.engine_cylinders} cylinder` : ""}
              </Text>
            </View>
          )}

          {vehicle?.vin && (
            <View style={styles.field}>
              <Text style={styles.label}>VIN</Text>
              <Text style={styles.readonlyValue}>{vehicle.vin}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed || saving ? 0.85 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <InputAccessoryView nativeID="mileageToolbar">
        <View style={{ flexDirection: "row", justifyContent: "flex-end", backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Pressable onPress={() => Keyboard.dismiss()} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, paddingHorizontal: 12, paddingVertical: 6 }]}>
            <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#E8943A" }}>Done</Text>
          </Pressable>
        </View>
      </InputAccessoryView>
      <SaveToast visible={showSaveErrorToast} message="Couldn't save" subtitle={saveErrorSubtitle} isError />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 20 },
  field: { gap: 6 },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  optional: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textTransform: "none",
    letterSpacing: 0,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#5A6480", marginTop: 2 },
  warning: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#E8943A", marginTop: 2, lineHeight: 18 },
  readonlyValue: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, paddingVertical: 4 },
  typePill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  typePillActive: { borderColor: "#E8943A", backgroundColor: "rgba(232,147,58,0.15)" },
  typePillText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  typePillTextActive: { color: "#E8943A", fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    backgroundColor: "#E8943A",
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.textInverse },
});
