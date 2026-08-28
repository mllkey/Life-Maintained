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
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
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

    if (err) { setIsLoading(false); setError("Couldn't save that just now. Please try again."); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
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
            <Icon name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Medication</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Add Medication</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBox}><Icon name="alert-circle" size={16} color={Colors.overdue} /><Text style={styles.errorText}>{error}</Text></View>}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Medication Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Lisinopril, Vitamin D, etc." placeholderTextColor={Colors.textTertiary} autoCapitalize="words" returnKeyType="next" />
          </View>

          {familyMembers && familyMembers.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Who takes this?</Text>
              <View style={styles.memberGrid}>
                <Pressable style={[styles.chip, familyMemberId === null && styles.chipSelected]} onPress={() => { setFamilyMemberId(null); Haptics.selectionAsync(); }}>
                  <Icon name="person-outline" size={14} color={familyMemberId === null ? Colors.health : Colors.textSecondary} />
                  <Text style={[styles.chipText, familyMemberId === null && styles.chipTextSelected]}>Me</Text>
                </Pressable>
                {familyMembers.map(fm => (
                  <Pressable key={fm.id} style={[styles.chip, familyMemberId === fm.id && styles.chipSelected]} onPress={() => { setFamilyMemberId(fm.id); Haptics.selectionAsync(); }}>
                    <Icon name={fm.member_type === "pet" ? "paw-outline" : "person-outline"} size={14} color={familyMemberId === fm.id ? Colors.health : Colors.textSecondary} />
                    <Text style={[styles.chipText, familyMemberId === fm.id && styles.chipTextSelected]}>{fm.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Pressable style={styles.toggleRow} onPress={() => { setRemindersEnabled(!remindersEnabled); Haptics.selectionAsync(); }}>
              <View>
                <Text style={styles.toggleLabel}>Daily Reminders</Text>
                <Text style={styles.toggleSub}>Get notified when it&apos;s time to take this</Text>
              </View>
              <View style={[styles.toggle, remindersEnabled && styles.toggleOn]}>
                <View style={[styles.toggleThumb, remindersEnabled && styles.toggleThumbOn]} />
              </View>
            </Pressable>
          </View>

          {remindersEnabled && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reminder Time</Text>
              <View style={{ backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", height: 180 }}>
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
              <Text style={{ ...Typography.footnote, color: Colors.textSecondary, marginTop: 8, textAlign: "center" }}>Scroll to set your reminder time</Text>
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
  title: { ...Typography.headline, color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { ...Typography.footnote, fontWeight: "600", color: Colors.textInverse },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: Radius.md, padding: 12 },
  errorText: { ...Typography.footnote, flex: 1, color: Colors.overdue },
  section: { gap: 8 },
  sectionTitle: { ...Typography.caption, fontWeight: "600", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  input: { ...Typography.subheadline, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, color: Colors.text },
  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  chipText: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.health },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 16, borderWidth: 1, borderColor: Colors.border },
  toggleLabel: { ...Typography.subheadline, fontWeight: "500", color: Colors.text },
  toggleSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  toggle: { width: 48, height: 28, borderRadius: Radius.lg, backgroundColor: Colors.border, justifyContent: "center", paddingHorizontal: 2 },
  toggleOn: { backgroundColor: Colors.health },
  toggleThumb: { width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },
});
