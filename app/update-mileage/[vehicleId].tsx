import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { resolveTrackingMode, isHoursTrackedMode } from "@/lib/usageHelpers";

export default function UpdateMileageScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [mileage, setMileage] = useState("");
  const [mileageWarning, setMileageWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", vehicleId!).single();
      return data;
    },
    enabled: !!vehicleId,
  });

  const tracksHours = vehicle ? isHoursTrackedMode(resolveTrackingMode(vehicle)) : false;

  async function handleSave() {
    if (isLoading) return;
    if (!vehicleId || !mileage) return;
    const mileageValue = mileage;
    const m = parseInt(mileageValue);
    if (isNaN(m)) return;
    const currentMileage = tracksHours ? vehicle?.hours ?? 0 : vehicle?.mileage ?? 0;
    const newMileage = parseInt(mileageValue, 10);
    if (currentMileage > 0 && newMileage < currentMileage) {
      setMileageWarning(
        tracksHours
          ? `Hours can only go up. Current: ${currentMileage.toLocaleString()} hrs. If you made a typo, contact support@lifemaintained.com.`
          : `Mileage can only go up. Current: ${currentMileage.toLocaleString()} mi. If you made a typo, contact support@lifemaintained.com.`,
      );
      return;
    }
    setIsLoading(true);

    if (tracksHours) {
      await supabase.from("vehicles").update({ hours: newMileage, updated_at: new Date().toISOString() }).eq("id", vehicleId);
    } else {
      await supabase.from("vehicles").update({ mileage: newMileage, updated_at: new Date().toISOString() }).eq("id", vehicleId);

      await supabase.from("vehicle_mileage_history").insert({
        vehicle_id: vehicleId,
        mileage: newMileage,
        recorded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    router.back();
  }

  const vehicleName = vehicle ? (vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`) : "Vehicle";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>{tracksHours ? "Update Hours" : "Update Mileage"}</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          <View style={styles.vehicleInfo}>
            <Text style={styles.vehicleName}>{vehicleName}</Text>
            {tracksHours ? (
              vehicle?.hours != null && (
                <Text style={styles.currentMileage}>Current: {vehicle.hours.toLocaleString()} hours</Text>
              )
            ) : (
              vehicle?.mileage != null && (
                <Text style={styles.currentMileage}>Current: {vehicle.mileage.toLocaleString()} miles</Text>
              )
            )}
          </View>

          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>{tracksHours ? "Current Hours" : "Current Mileage"}</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="speedometer-outline" size={22} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={mileage}
                onChangeText={(text) => {
                  setMileageWarning(null);
                  setMileage(text);
                }}
                placeholder={tracksHours ? "e.g. 1,250" : "e.g. 52,000"}
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
              <Text style={styles.inputUnit}>{tracksHours ? "hrs" : "mi"}</Text>
            </View>
            {mileageWarning && (
              <Pressable onPress={() => Linking.openURL("mailto:support@lifemaintained.com?subject=Mileage%20Correction%20Request")}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#E8943A", marginTop: 6, lineHeight: 18 }}>
                  {mileageWarning}
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#E8943A", marginTop: 4 }}>
                  Tap here to email us →
                </Text>
              </Pressable>
            )}
            <Text style={styles.hint}>
              {tracksHours ? "Hours can be increased but cannot be lowered." : "Mileage can be increased but cannot be lowered."}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={handleSave}
            disabled={isLoading || !mileage}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.saveBtnText}>{tracksHours ? "Update Hours" : "Update Mileage"}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

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
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 40, gap: 32 },
  vehicleInfo: { alignItems: "center", gap: 8 },
  vehicleName: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  currentMileage: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  inputSection: { gap: 8 },
  inputLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    height: 60,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 24, fontFamily: "Inter_600SemiBold", color: Colors.text },
  inputUnit: { fontSize: 16, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#5A6480", marginTop: 4 },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
