import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";

function formatTimeForDB(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, "0");
  return `${h}:${m} ${ampm}`;
}

export default function AddMedicationScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [reminderTime, setReminderTime] = useState<Date>(new Date(new Date().setHours(8, 0, 0, 0)));
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: familyMembers } = useQuery({
    queryKey: ["family_members", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("family_members").select("*").eq("user_id", user.id).order("name");
      return data ?? [];
    },
    enabled: !!user,
  });

  async function handleSave() {
    if (isLoading) return;
    if (!user) {
      setError("Session unavailable. Please close and reopen this screen.");
      return;
    }
    if (!name.trim()) { setError("Medication name is required"); return; }
    setIsLoading(true);
    setError(null);

    const { error: err } = await supabase.from("medications").insert({
      user_id: user.id,
      family_member_id: familyMemberId,
      name: name.trim(),
      reminder_time: remindersEnabled ? formatTimeForDB(reminderTime) : null,
      reminders_enabled: remindersEnabled,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (err) { setIsLoading(false); setError(err.message); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["medications"] });
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
          <Text style={styles.title}>Add Medication</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={16} color={Colors.overdue} /><Text style={styles.errorText}>{error}</Text></View>}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Medication Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Lisinopril, Vitamin D, etc." placeholderTextColor={Colors.textTertiary} autoCapitalize="words" returnKeyType="next" />
          </View>

          {familyMembers && familyMembers.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Who takes this?</Text>
              <View style={styles.memberGrid}>
                <Pressable style={[styles.chip, familyMemberId === null && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setFamilyMemberId(null); }}>
                  <Ionicons name="person-outline" size={14} color={familyMemberId === null ? Colors.health : Colors.textSecondary} />
                  <Text style={[styles.chipText, familyMemberId === null && styles.chipTextSelected]}>Me</Text>
                </Pressable>
                {familyMembers.map(fm => (
                  <Pressable key={fm.id} style={[styles.chip, familyMemberId === fm.id && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setFamilyMemberId(fm.id); }}>
                    <Ionicons name={fm.member_type === "pet" ? "paw-outline" : "person-outline"} size={14} color={familyMemberId === fm.id ? Colors.health : Colors.textSecondary} />
                    <Text style={[styles.chipText, familyMemberId === fm.id && styles.chipTextSelected]}>{fm.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Pressable style={styles.toggleRow} onPress={() => { Haptics.selectionAsync(); setRemindersEnabled(!remindersEnabled); }}>
              <View>
                <Text style={styles.toggleLabel}>Daily Reminders</Text>
                <Text style={styles.toggleSub}>Get notified when it's time to take this</Text>
              </View>
              <View style={[styles.toggle, remindersEnabled && styles.toggleOn]}>
                <View style={[styles.toggleThumb, remindersEnabled && styles.toggleThumbOn]} />
              </View>
            </Pressable>
          </View>

          {remindersEnabled && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reminder Time</Text>
              <View style={{ backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", height: 180 }}>
                <DateTimePicker
                  mode="time"
                  display="spinner"
                  value={reminderTime}
                  onChange={(_, selectedDate) => { if (selectedDate) { setReminderTime(selectedDate); Haptics.selectionAsync(); } }}
                  textColor={Colors.text}
                  themeVariant="dark"
                  style={{ height: 180 }}
                />
              </View>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 6, textAlign: "center" }}>Scroll to set your reminder time</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  input: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.health },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: Colors.border, justifyContent: "center", paddingHorizontal: 2 },
  toggleOn: { backgroundColor: Colors.health },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },
});
