import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import DatePicker from "@/components/DatePicker";

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
  const params = useLocalSearchParams<{ familyMemberId?: string | string[] }>();
  const paramFamilyMemberId = Array.isArray(params.familyMemberId) ? params.familyMemberId[0] : params.familyMemberId;

  const [appointmentType, setAppointmentType] = useState("");
  const [providerName, setProviderName] = useState("");
  const [intervalMonths, setIntervalMonths] = useState(12);
  const [nextDueDate, setNextDueDate] = useState("");
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<any>(null);
  const scrollOffset = useRef(0);

  const { data: familyMembers } = useQuery({
    queryKey: ["family_members", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("family_members").select("*").eq("user_id", user.id).order("name");
      return data ?? [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (paramFamilyMemberId) setFamilyMemberId(paramFamilyMemberId);
  }, [paramFamilyMemberId]);

  const { data: memberData } = useQuery({
    queryKey: ["member_type", familyMemberId],
    queryFn: async () => {
      if (!familyMemberId) return null;
      const { data } = await supabase
        .from("family_members")
        .select("member_type")
        .eq("id", familyMemberId)
        .maybeSingle();
      return data;
    },
    enabled: !!familyMemberId,
  });

  const isPet = useMemo(() => {
    if (!familyMemberId) return false;
    const fromList = familyMembers?.find(fm => fm.id === familyMemberId)?.member_type;
    if (fromList === "pet") return true;
    if (fromList === "person") return false;
    return memberData?.member_type === "pet";
  }, [familyMemberId, familyMembers, memberData?.member_type]);

  const { data: previousProviders } = useQuery({
    queryKey: ["previous_providers", user?.id, isPet ? "pet" : "person"],
    queryFn: async () => {
      if (!user) return [];
      const { data: members } = await supabase
        .from("family_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("member_type", isPet ? "pet" : "person");
      const memberIds = (members ?? []).map((m: { id: string }) => m.id);

      let query = supabase
        .from("health_appointments")
        .select("provider_name")
        .eq("user_id", user.id)
        .not("provider_name", "is", null);

      if (isPet) {
        if (memberIds.length === 0) return [];
        query = query.in("family_member_id", memberIds);
      } else if (memberIds.length > 0) {
        query = query.or(`family_member_id.is.null,family_member_id.in.(${memberIds.join(",")})`);
      } else {
        query = query.is("family_member_id", null);
      }

      const { data } = await query;
      const seen = new Map<string, string>();
      for (const d of data ?? []) {
        const raw = (d.provider_name ?? "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!seen.has(key)) seen.set(key, raw);
      }
      return [...seen.values()].sort();
    },
    enabled: !!user,
  });

  async function handleSave() {
    if (isLoading) return;
    if (!user) {
      setError("Session unavailable. Please close and reopen this screen.");
      return;
    }
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

        <ScrollView ref={scrollRef} onScroll={e => { scrollOffset.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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

          <Section title={isPet ? "Vet / Clinic" : "Doctor / Clinic"}>
            <TextInput
              style={styles.input}
              value={providerName}
              onChangeText={setProviderName}
              placeholder={isPet ? "Banfield, VCA Animal Hospital..." : "Dr. Smith, HealthFirst Clinic..."}
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="next"
            />
            {providerName.length > 0 && previousProviders && previousProviders.length > 0 && (() => {
              const matches = previousProviders
                .filter(p => p.toLowerCase().includes(providerName.toLowerCase()) && p.toLowerCase() !== providerName.toLowerCase())
                .slice(0, 3);
              if (matches.length === 0) return null;
              return (
                <View style={{ marginTop: 4, gap: 2 }}>
                  {matches.map(suggestion => (
                    <Pressable
                      key={suggestion}
                      onPress={() => { Keyboard.dismiss(); Haptics.selectionAsync(); setProviderName(suggestion); }}
                      style={({ pressed }) => ({
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        backgroundColor: Colors.surface,
                        borderRadius: 8,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.text }}>
                        {suggestion}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })()}
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
            <DatePicker
              value={nextDueDate}
              onChange={setNextDueDate}
              maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() + 5))}
              minimumDate={new Date()}
              onClose={() => { const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
            />
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
  chips: { gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.health },
  input: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  textArea: { height: 80, paddingTop: 12 },
  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  memberChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  memberChipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  memberChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  memberChipTextSelected: { color: Colors.health },
  intervalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  intervalChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  intervalChipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  intervalChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  intervalChipTextSelected: { color: Colors.health },
});
