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
import { MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";

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
  const [color, setColor] = useState("");
  const [trim, setTrim] = useState("");
  const [mileageWarning, setMileageWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .single()
      .then(({ data }) => {
        if (data) {
          setVehicle(data);
          setNickname(data.nickname ?? "");
          setMileage(data.mileage != null ? String(data.mileage) : "");
          setColor(data.color ?? "");
          setTrim(data.trim ?? "");
        }
        setLoading(false);
      });
  }, [vehicleId]);

  const tracksMileage = MILEAGE_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "");
  const vehicleTitle = vehicle
    ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
    : "Vehicle";

  async function handleSave() {
    if (!vehicle || !user) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updates: Record<string, any> = {
      nickname: nickname.trim() || null,
      color: color.trim() || null,
      trim: trim.trim() || null,
    };

    if (tracksMileage && mileage.trim()) {
      const newMileage = parseInt(mileage, 10);
      if (isNaN(newMileage) || newMileage < 0) {
        setMileageWarning("Enter a valid mileage.");
        setSaving(false);
        return;
      }
      const currentMileage = vehicle.mileage ?? 0;
      if (currentMileage > 0 && newMileage < currentMileage) {
        setMileageWarning(
          `Mileage can only go up. Current: ${currentMileage.toLocaleString()} mi. If you made a typo, contact support@lifemaintained.com.`,
        );
        setSaving(false);
        return;
      }
      updates.mileage = newMileage;
    }

    try {
      const { error } = await supabase.from("vehicles").update(updates).eq("id", vehicleId!);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setTimeout(() => router.back(), 150);
    } catch (err: any) {
      Alert.alert("Couldn't save", err?.message ?? "Give it another shot.");
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
                placeholder="e.g. 67331"
                placeholderTextColor={Colors.textTertiary}
              />
              {mileageWarning && <Text style={styles.warning}>{mileageWarning}</Text>}
              <Text style={styles.hint}>Mileage can be increased but cannot be lowered.</Text>
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

          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed || saving ? 0.85 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#0C111B" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
  saveBtn: {
    backgroundColor: "#E8943A",
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0C111B" },
});
