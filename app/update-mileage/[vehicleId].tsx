import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";

export default function UpdateMileageScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [mileage, setMileage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", vehicleId!).single();
      return data;
    },
    enabled: !!vehicleId,
  });

  async function handleSave() {
    if (!vehicleId || !mileage) return;
    const m = parseInt(mileage);
    if (isNaN(m)) return;
    setIsLoading(true);

    await supabase.from("vehicles").update({
      mileage: m,
      updated_at: new Date().toISOString(),
    }).eq("id", vehicleId);

    await supabase.from("vehicle_mileage_history").insert({
      vehicle_id: vehicleId,
      mileage: m,
      recorded_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    setIsLoading(false);
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
          <Text style={styles.title}>Update Mileage</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          <View style={styles.vehicleInfo}>
            <View style={styles.vehicleIcon}>
              <Ionicons name="car-outline" size={28} color={Colors.vehicle} />
            </View>
            <Text style={styles.vehicleName}>{vehicleName}</Text>
            {vehicle?.mileage != null && (
              <Text style={styles.currentMileage}>Current: {vehicle.mileage.toLocaleString()} miles</Text>
            )}
          </View>

          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>New Mileage</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="speedometer-outline" size={22} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={mileage}
                onChangeText={setMileage}
                placeholder={vehicle?.mileage != null ? `More than ${vehicle.mileage.toLocaleString()}` : "Enter mileage"}
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
              <Text style={styles.inputUnit}>mi</Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={handleSave}
            disabled={isLoading || !mileage}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.saveBtnText}>Update Mileage</Text>
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 40, gap: 32 },
  vehicleInfo: { alignItems: "center", gap: 8 },
  vehicleIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.vehicleMuted, alignItems: "center", justifyContent: "center" },
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
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
