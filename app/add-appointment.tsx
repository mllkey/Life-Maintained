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
import { useQueryClient, useQuery } from "@tanstack/react-query";

const APPOINTMENT_TYPES = [
  "Annual Physical",
  "Dental Cleaning",
  "Eye Exam",
  "Dermatologist",
  "Colonoscopy",
  "Mammogram",
  "Prostate Screening",
  "Cardiologist",
  "Gynecologist",
  "Therapist / Psychiatrist",
  "Orthopedist",
  "Veterinary Checkup",
  "Vaccination",
  "Blood Work",
  "Other",
];

const INTERVALS = [
  { value: 1, label: "Monthly" },
  { value: 3, label: "Quarterly" },
  { value: 6, label: "Every 6 months" },
  { value: 12, label: "Annually" },
  { value: 24, label: "Every 2 years" },
  { value: 60, label: "Every 5 years" },
  { value: 120, label: "Every 10 years" },
];

export default function AddAppointmentScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [appointmentType, setAppointmentType] = useState("");
  const [providerName, setProviderName] = useState("");
  const [intervalMonths, setIntervalMonths] = useState(12);
  const [nextDueDate, setNextDueDate] = useState("");
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
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
    if (!user) return;
    if (!appointmentType.trim()) { setError("Appointment type is required"); return; }
    setIsLoading(true);
    setError(null);

    let nextDate: string | null = null;
    if (nextDueDate && nextDueDate.length === 10) {
      nextDate = nextDueDate;
    } else {
      const next = new Date();
      next.setMonth(next.getMonth() + intervalMonths);
      nextDate = next.toISOString().split("T")[0];
    }

    const { error: err } = await supabase.from("health_appointments").insert({
      user_id: user.id,
      family_member_id: familyMemberId,
      appointment_type: appointmentType.trim(),
      provider_name: providerName.trim() || null,
      interval_months: intervalMonths,
      next_due_date: nextDate,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (err) { setIsLoading(false); setError(err.message); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["health_appointments"] });
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
          <Text style={styles.title}>Add Appointment</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={16} color={Colors.overdue} /><Text style={styles.errorText}>{error}</Text></View>}

          <Section title="Appointment Type">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {APPOINTMENT_TYPES.map(t => (
                <Pressable key={t} style={[styles.chip, appointmentType === t && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setAppointmentType(t); }}>
                  <Text style={[styles.chipText, appointmentType === t && styles.chipTextSelected]}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput style={styles.input} value={appointmentType} onChangeText={setAppointmentType} placeholder="Or enter custom type..." placeholderTextColor={Colors.textTertiary} returnKeyType="next" />
          </Section>

          <Section title="Provider">
            <TextInput style={styles.input} value={providerName} onChangeText={setProviderName} placeholder="Dr. Smith, HealthFirst Clinic..." placeholderTextColor={Colors.textTertiary} autoCapitalize="words" returnKeyType="next" />
          </Section>

          {familyMembers && familyMembers.length > 0 && (
            <Section title="Who is this for?">
              <View style={styles.memberGrid}>
                <Pressable style={[styles.memberChip, familyMemberId === null && styles.memberChipSelected]} onPress={() => { Haptics.selectionAsync(); setFamilyMemberId(null); }}>
                  <Ionicons name="person-outline" size={14} color={familyMemberId === null ? Colors.health : Colors.textSecondary} />
                  <Text style={[styles.memberChipText, familyMemberId === null && styles.memberChipTextSelected]}>Me</Text>
                </Pressable>
                {familyMembers.map(fm => (
                  <Pressable key={fm.id} style={[styles.memberChip, familyMemberId === fm.id && styles.memberChipSelected]} onPress={() => { Haptics.selectionAsync(); setFamilyMemberId(fm.id); }}>
                    <Ionicons name={fm.member_type === "pet" ? "paw-outline" : "person-outline"} size={14} color={familyMemberId === fm.id ? Colors.health : Colors.textSecondary} />
                    <Text style={[styles.memberChipText, familyMemberId === fm.id && styles.memberChipTextSelected]}>{fm.name}</Text>
                  </Pressable>
                ))}
              </View>
            </Section>
          )}

          <Section title="Reminder Interval">
            <View style={styles.intervalGrid}>
              {INTERVALS.map(iv => (
                <Pressable key={iv.value} style={[styles.intervalChip, intervalMonths === iv.value && styles.intervalChipSelected]} onPress={() => { Haptics.selectionAsync(); setIntervalMonths(iv.value); }}>
                  <Text style={[styles.intervalChipText, intervalMonths === iv.value && styles.intervalChipTextSelected]}>{iv.label}</Text>
                </Pressable>
              ))}
            </View>
          </Section>

          <Section title="Next Due Date (optional)">
            <TextInput style={styles.input} value={nextDueDate} onChangeText={setNextDueDate} placeholder="YYYY-MM-DD (auto-calculated if blank)" placeholderTextColor={Colors.textTertiary} keyboardType="numeric" maxLength={10} />
          </Section>

          <Section title="Notes">
            <TextInput style={[styles.input, styles.textArea]} value={notes} onChangeText={setNotes} placeholder="Location, instructions, notes..." placeholderTextColor={Colors.textTertiary} multiline numberOfLines={3} textAlignVertical="top" />
          </Section>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.health, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8 },
  chips: { gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.health },
  input: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  textArea: { height: 80, paddingTop: 12 },
  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  memberChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  memberChipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  memberChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  memberChipTextSelected: { color: Colors.health },
  intervalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  intervalChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  intervalChipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  intervalChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  intervalChipTextSelected: { color: Colors.health },
});
