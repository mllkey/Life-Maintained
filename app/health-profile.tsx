import React, { useState, useEffect } from "react";
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
import { useQueryClient, useQuery } from "@tanstack/react-query";

const SEX_OPTIONS = ["male", "female", "other", "prefer_not_to_say"];
const SEX_LABELS: Record<string, string> = { male: "Male", female: "Female", other: "Other", prefer_not_to_say: "Prefer not to say" };

export default function HealthProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dob, setDob] = useState("");
  const [sex, setSex] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["health_profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("health_profiles").select("*").eq("user_id", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (profile) {
      if (profile.date_of_birth) {
        const [year, month, day] = profile.date_of_birth.split("-");
        setDob(`${month}/${day}/${year}`);
      }
      setSex(profile.sex_at_birth);
    }
  }, [profile]);

  function formatDob(text: string) {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }

  async function handleSave() {
    if (isLoading) return;
    if (!user) return;
    setIsLoading(true);

    let dateOfBirth: string | null = null;
    if (dob && dob.length === 10) {
      const [month, day, year] = dob.split("/");
      if (month && day && year) dateOfBirth = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    await supabase.from("health_profiles").upsert({
      user_id: user.id,
      date_of_birth: dateOfBirth,
      sex_at_birth: sex,
      updated_at: new Date().toISOString(),
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ["health_profile"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    router.back();
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Health Profile</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.infoBox}>
            <Ionicons name="heart-outline" size={18} color={Colors.health} />
            <Text style={styles.infoText}>Used to surface personalized health screening recommendations on your dashboard.</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date of Birth</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="calendar-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput style={styles.inputInner} value={dob} onChangeText={t => setDob(formatDob(t))} placeholder="MM/DD/YYYY" placeholderTextColor={Colors.textTertiary} keyboardType="numeric" maxLength={10} />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sex at Birth</Text>
            <View style={styles.grid}>
              {SEX_OPTIONS.map(opt => (
                <Pressable key={opt} style={[styles.chip, sex === opt && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setSex(opt === sex ? null : opt); }}>
                  <Text style={[styles.chipText, sex === opt && styles.chipTextSelected]}>{SEX_LABELS[opt]}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 24 },
  infoBox: { flexDirection: "row", gap: 10, backgroundColor: Colors.healthMuted, borderRadius: 12, padding: 14, alignItems: "flex-start" },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 20 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  inputWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, height: 52 },
  inputIcon: { marginRight: 10 },
  inputInner: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.health },
});
