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
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { isHoursTracked, projectedMileage, projectedHours } from "@/lib/usageHelpers";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";

export default function UpdateMileageScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
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

  const tracksHours = isHoursTracked(vehicle);

  async function handleSave() {
    if (isLoading) return;
    if (!vehicleId || !mileage || !user) return;
    const mileageValue = mileage.replace(/,/g, "");
    const currentMileage = tracksHours ? vehicle?.hours ?? 0 : vehicle?.mileage ?? 0;
    const newMileage = tracksHours ? parseFloat(mileageValue) : parseInt(mileageValue, 10);
    if (isNaN(newMileage)) return;
    if (currentMileage > 0 && newMileage < currentMileage) {
      setMileageWarning(
        tracksHours
          ? `Hours can only go up. Last recorded: ${currentMileage.toLocaleString()} hrs. Open Edit Vehicle to correct this reading.`
          : `Mileage can only go up. Last recorded: ${currentMileage.toLocaleString()} mi. Open Edit Vehicle to correct this reading.`,
      );
      return;
    }
    setIsLoading(true);
    try {
      if (tracksHours) {
        const { error: updateErr } = await supabase.from("vehicles").update({ hours: newMileage, last_hours_update: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", vehicleId);
        if (updateErr) throw updateErr;
      } else {
        const { error: updateErr } = await supabase.from("vehicles").update({ mileage: newMileage, last_mileage_update: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", vehicleId);
        if (updateErr) throw updateErr;

        const { error: histErr } = await supabase.from("vehicle_mileage_history").insert({
          user_id: user.id,
          vehicle_id: vehicleId,
          mileage: newMileage,
          recorded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
        if (histErr) throw histErr;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setIsLoading(false);
      setMileageWarning("Save failed. Give it another shot.");
    }
  }

  const vehicleName = vehicle ? (vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`) : "Vehicle";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Icon name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>{tracksHours ? "Update Hours" : "Update Mileage"}</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          <View style={styles.vehicleInfo}>
            <Text style={styles.vehicleName}>{vehicleName}</Text>
            {tracksHours ? (
              vehicle?.hours != null && (
                <Text style={styles.currentMileage}>Estimated now: {(projectedHours(vehicle) ?? vehicle.hours).toLocaleString()} hours</Text>
              )
            ) : (
              vehicle?.mileage != null && (
                <Text style={styles.currentMileage}>Estimated now: {(projectedMileage(vehicle) ?? vehicle.mileage).toLocaleString()} miles</Text>
              )
            )}
          </View>

          <Tooltip
            id={TOOLTIP_IDS.UPDATE_MILEAGE_TIP}
            message="Keeping this current helps us predict when your next service is actually due."
            icon="speedometer-outline"
          />

          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>{tracksHours ? "Current Hours" : "Current Mileage"}</Text>
            <View style={styles.inputWrapper}>
              <Icon name="speedometer-outline" size={22} color={Colors.textTertiary} style={styles.inputIcon} />
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
                <Text style={{ ...Typography.footnote, color: Colors.accent, marginTop: 8 }}>
                  {mileageWarning}
                </Text>
                <Text style={{ ...Typography.footnote, fontWeight: "600", color: Colors.accent, marginTop: 4 }}>
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
  title: { ...Typography.headline, color: Colors.text },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 40, gap: 32 },
  vehicleInfo: { alignItems: "center", gap: 8 },
  vehicleName: { ...Typography.title3, color: Colors.text },
  currentMileage: { ...Typography.footnote, color: Colors.textSecondary },
  inputSection: { gap: 8 },
  inputLabel: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    height: 60,
  },
  inputIcon: { marginRight: 12 },
  input: { ...Typography.title2, fontWeight: "600", flex: 1, color: Colors.text },
  inputUnit: { ...Typography.subheadline, fontWeight: "500", color: Colors.textTertiary },
  hint: { ...Typography.caption, color: Colors.textTertiary, marginTop: 4 },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse },
});
