import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseISO, isBefore, addDays, addMonths, format } from "date-fns";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { personLimit, petLimit } from "@/lib/subscription";
import { SaveToast } from "@/components/SaveToast";
import DatePicker from "@/components/DatePicker";
import { usePulse, S, Row, Col } from "@/components/Skeleton";

async function scheduleMedicationNotification(medId: string, medName: string, reminderTime: string): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return false;
  const [hourStr, minuteStr] = reminderTime.split(":");
  const hour = parseInt(hourStr ?? "8");
  const minute = parseInt(minuteStr ?? "0");
  if (isNaN(hour) || isNaN(minute)) return false;

  const storageKey = `@med_notif_${medId}`;
  try {
    const prevId = await AsyncStorage.getItem(storageKey);
    if (prevId) {
      await Notifications.cancelScheduledNotificationAsync(prevId);
    }
  } catch {}

  const newId = await Notifications.scheduleNotificationAsync({
    content: { title: "Medication Reminder", body: `Time to take your ${medName}`, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });

  await AsyncStorage.setItem(storageKey, newId).catch(() => {});
  return true;
}

function getStatus(nextDueDate: string | null, lastCompletedAt?: string | null): "overdue" | "due_soon" | "good" {
  if (nextDueDate) {
    const d = parseISO(nextDueDate);
    if (isBefore(d, new Date())) return "overdue";
    if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  }
  if (!lastCompletedAt && !nextDueDate) return "due_soon";
  return "good";
}

function getAgeScreenings(dob: string | null, sex: string | null): { title: string; description: string; interval: number }[] {
  if (!dob) return [];
  const birthDate = parseISO(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  const screenings: { title: string; description: string; interval: number }[] = [];
  if (age >= 45) screenings.push({ title: "Colonoscopy", description: "Recommended every 10 years from age 45", interval: 120 });
  if (age >= 18) screenings.push({ title: "Annual Physical", description: "Yearly checkup with your primary care provider", interval: 12 });
  if (sex === "female" && age >= 40) screenings.push({ title: "Mammogram", description: "Recommended annually from age 40", interval: 12 });
  if (sex === "male" && age >= 50) screenings.push({ title: "Prostate Screening", description: "PSA test recommended from age 50", interval: 12 });
  if (age >= 20) screenings.push({ title: "Skin Check", description: "Annual full-body skin exam", interval: 12 });
  if (age >= 18) screenings.push({ title: "Eye Exam", description: "Comprehensive exam every 1–2 years", interval: 24 });
  if (age >= 18) screenings.push({ title: "Dental Cleaning", description: "Professional cleaning every 6 months", interval: 6 });
  return screenings;
}

export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const skeletonAnim = usePulse();
  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const [schedulingMed, setSchedulingMed] = useState<string | null>(null);

  const [markCompleteAppt, setMarkCompleteAppt] = useState<any | null>(null);
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeCost, setCompleteCost] = useState("");
  const [completeProvider, setCompleteProvider] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [isSavingComplete, setIsSavingComplete] = useState(false);
  const [addingScreening, setAddingScreening] = useState<string | null>(null);

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastIsError, setToastIsError] = useState(false);

  function showToast(msg: string, isError = false) {
    setToastMsg(msg);
    setToastIsError(isError);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  const { data: appointments, isLoading: loadingAppts, refetch: refetchAppts } = useQuery({
    queryKey: ["health_appointments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("health_appointments")
        .select("*, family_members(name, relationship, member_type)")
        .eq("user_id", user.id)
        .order("next_due_date", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: medications, isLoading: loadingMeds, refetch: refetchMeds } = useQuery({
    queryKey: ["medications", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("medications")
        .select("*, family_members(name)")
        .eq("user_id", user.id)
        .order("name");
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: familyMembers, isLoading: loadingFamily, refetch: refetchFamily } = useQuery({
    queryKey: ["family_members", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("family_members")
        .select("*")
        .eq("user_id", user.id)
        .order("name");
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: healthProfile } = useQuery({
    queryKey: ["health_profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("health_profiles").select("*").eq("user_id", user.id).maybeSingle();
      return data ?? null;
    },
    enabled: !!user,
  });

  const isLoading = loadingAppts || loadingMeds || loadingFamily;

  function refetch() {
    refetchAppts();
    refetchMeds();
    refetchFamily();
  }

  async function handleScheduleNotification(med: any) {
    if (!med.reminder_time) {
      Alert.alert("No Reminder Time", "This medication doesn't have a reminder time set. Edit it to add one.");
      return;
    }
    setSchedulingMed(med.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      // If already enabled, toggle off — cancel the notification and update DB
      if (med.reminders_enabled) {
        const storageKey = `@med_notif_${med.id}`;
        try {
          const prevId = await AsyncStorage.getItem(storageKey);
          if (prevId) {
            await Notifications.cancelScheduledNotificationAsync(prevId);
            await AsyncStorage.removeItem(storageKey);
          }
        } catch {}
        await supabase.from("medications").update({ reminders_enabled: false, updated_at: new Date().toISOString() }).eq("id", med.id);
        queryClient.setQueryData(["medications", user?.id], (old: any[] | undefined) =>
          old?.map((m: any) => m.id === med.id ? { ...m, reminders_enabled: false } : m),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Reminder Off", `Daily reminder for ${med.name} has been turned off.`);
      } else {
        const success = await scheduleMedicationNotification(med.id, med.name, med.reminder_time);
        if (success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Update DB and local cache so the status dot turns green immediately
          await supabase.from("medications").update({ reminders_enabled: true, updated_at: new Date().toISOString() }).eq("id", med.id);
          queryClient.setQueryData(["medications", user?.id], (old: any[] | undefined) =>
            old?.map((m: any) => m.id === med.id ? { ...m, reminders_enabled: true } : m),
          );
          Alert.alert("Reminder Set", `You'll be reminded to take ${med.name} daily at ${med.reminder_time}.`);
        } else {
          Alert.alert("Permission Required", "Please enable notifications in Settings to receive medication reminders.");
        }
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSchedulingMed(null);
    }
  }

  function handleOpenMarkComplete(appt: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMarkCompleteAppt(appt);
    setCompleteDate(format(new Date(), "yyyy-MM-dd"));
    setCompleteCost("");
    setCompleteProvider(appt.provider_name ?? "");
    setCompleteNotes("");
    setIsSavingComplete(false);
  }

  function handleCloseMarkComplete() {
    setMarkCompleteAppt(null);
  }

  async function handleSaveMarkComplete() {
    if (!markCompleteAppt || !user) return;
    const appt = markCompleteAppt;
    setIsSavingComplete(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const intervalMonths = appt.interval_months ?? 12;
    const nextDate = format(addMonths(parseISO(completeDate), intervalMonths), "yyyy-MM-dd");
    const now = new Date().toISOString();
    const completedAt = new Date(completeDate + "T12:00:00").toISOString();

    queryClient.setQueryData(["health_appointments", user.id], (old: any[] | undefined) => {
      if (!old) return old;
      return old.map(a =>
        a.id === appt.id
          ? { ...a, last_completed_at: completedAt, next_due_date: nextDate, updated_at: now }
          : a,
      );
    });

    handleCloseMarkComplete();

    try {
      const costNum = completeCost.trim() ? parseFloat(completeCost.replace(/[^0-9.]/g, "")) : null;

      const [apptRes, logRes] = await Promise.all([
        supabase
          .from("health_appointments")
          .update({ last_completed_at: completedAt, next_due_date: nextDate, updated_at: now })
          .eq("id", appt.id),
        supabase.from("maintenance_logs").insert({
          user_id: user.id,
          vehicle_id: null,
          property_id: null,
          service_name: appt.appointment_type,
          service_date: completeDate,
          cost: costNum,
          mileage: null,
          provider_name: completeProvider.trim() || null,
          provider_contact: null,
          receipt_url: null,
          notes: completeNotes.trim() || null,
          did_it_myself: false,
        }),
      ]);

      if (apptRes.error || logRes.error) throw apptRes.error ?? logRes.error;

      queryClient.invalidateQueries({ queryKey: ["health_appointments", user.id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      showToast(`${appt.appointment_type} marked complete!`);
    } catch {
      queryClient.invalidateQueries({ queryKey: ["health_appointments", user.id] });
      showToast("Failed to save. Please try again.", true);
    } finally {
      setIsSavingComplete(false);
    }
  }

  async function handleAddScreening(title: string, interval: number) {
    if (!user || addingScreening === title) return;
    setAddingScreening(title);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nextDate = format(addMonths(new Date(), interval), "yyyy-MM-dd");
    const { error } = await supabase.from("health_appointments").insert({
      user_id: user.id,
      family_member_id: null,
      appointment_type: title,
      provider_name: null,
      interval_months: interval,
      next_due_date: nextDate,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      showToast("Failed to add appointment", true);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${title} added!`);
      refetchAppts();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
    setAddingScreening(null);
  }

  const people = useMemo(() => familyMembers?.filter(fm => fm.member_type !== "pet") ?? [], [familyMembers]);
  const pets = useMemo(() => familyMembers?.filter(fm => fm.member_type === "pet") ?? [], [familyMembers]);

  const overdueAppts = useMemo(
    () => appointments?.filter(a => getStatus(a.next_due_date, a.last_completed_at) === "overdue") ?? [],
    [appointments],
  );
  const dueSoonAppts = useMemo(
    () => appointments?.filter(a => getStatus(a.next_due_date, a.last_completed_at) === "due_soon") ?? [],
    [appointments],
  );
  const actionNeededAppts = useMemo(() => [...overdueAppts, ...dueSoonAppts], [overdueAppts, dueSoonAppts]);

  const apptStatusByMember = useMemo(() => {
    const map: Record<string, { overdue: number; upcoming: number }> = {};
    for (const a of appointments ?? []) {
      if (a.family_member_id) {
        if (!map[a.family_member_id]) map[a.family_member_id] = { overdue: 0, upcoming: 0 };
        const s = getStatus(a.next_due_date, a.last_completed_at);
        if (s === "overdue") map[a.family_member_id].overdue++;
        else if (s === "due_soon") map[a.family_member_id].upcoming++;
      }
    }
    return map;
  }, [appointments]);

  const insightText = useMemo(() => {
    if (!appointments || appointments.length === 0) return null;
    const overdue = overdueAppts[0];
    if (overdue) {
      const memberName = (overdue as any).family_members?.name;
      const prefix = memberName ? `${memberName}'s ` : "";
      return `${prefix}${overdue.appointment_type} is overdue — schedule it soon.`;
    }
    const dueSoon = dueSoonAppts[0];
    if (dueSoon) {
      const memberName = (dueSoon as any).family_members?.name;
      const prefix = memberName ? `${memberName}'s ` : "";
      return `${prefix}${dueSoon.appointment_type} is coming up. Stay on top of it.`;
    }
    return null;
  }, [appointments, overdueAppts, dueSoonAppts]);

  const screeningSuggestions = useMemo(() => {
    if (!healthProfile) return [];
    const screenings = getAgeScreenings(healthProfile.date_of_birth, healthProfile.sex_at_birth);
    const existingTypes = new Set((appointments ?? []).map(a => a.appointment_type.toLowerCase().trim()));
    return screenings.filter(s => !existingTypes.has(s.title.toLowerCase().trim()));
  }, [healthProfile, appointments]);

  const hasNoMembers = !familyMembers?.length;

  function openAddPerson() {
    const currentPeople = familyMembers?.filter(fm => fm.member_type !== "pet").length ?? 0;
    const maxPeople = personLimit(profile);
    if (currentPeople >= maxPeople) {
      Alert.alert(
        "Person Limit Reached",
        `Your plan allows ${maxPeople === 0 ? "no people" : `${maxPeople} ${maxPeople === 1 ? "person" : "people"}`}. Upgrade to add more.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/subscription" as any) },
        ],
      );
      return;
    }
    router.push("/add-family-member");
  }

  function openAddPet() {
    const currentPets = familyMembers?.filter(fm => fm.member_type === "pet").length ?? 0;
    const maxPets = petLimit(profile);
    if (currentPets >= maxPets) {
      Alert.alert(
        "Pet Limit Reached",
        `Your plan allows ${maxPets === 0 ? "no pets" : `${maxPets} ${maxPets === 1 ? "pet" : "pets"}`}. Upgrade to add more.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/subscription" as any) },
        ],
      );
      return;
    }
    router.push("/add-family-member?type=pet" as any);
  }

  async function handleExportHealth() {
    if (!appointments?.length && !medications?.length) {
      Alert.alert("Nothing to Export", "Add some appointments or medications first.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const peopleForExport = familyMembers?.filter(fm => fm.member_type !== "pet") ?? [];
    const petsForExport = familyMembers?.filter(fm => fm.member_type === "pet") ?? [];

    function formatExportDate(d: string | null) {
      if (!d) return "\u2014";
      try {
        return format(parseISO(d), "MMM d, yyyy");
      } catch {
        return d;
      }
    }

    function statusLabel(nextDue: string | null) {
      if (!nextDue) return "No date set";
      const due = new Date(nextDue + "T12:00:00");
      const now = new Date();
      const diff = Math.floor((due.getTime() - now.getTime()) / 86400000);
      if (diff < 0) return "Overdue";
      if (diff <= 30) return "Due soon";
      return "Upcoming";
    }

    let apptRows = "";
    for (const a of (appointments ?? []).sort((x, y) => (x.next_due_date ?? "9999").localeCompare(y.next_due_date ?? "9999"))) {
      const memberName = (a as any).family_members?.name ?? "You";
      const status = statusLabel(a.next_due_date);
      const statusColor = status === "Overdue" ? "#EF4444" : status === "Due soon" ? "#F59E0B" : "#22C55E";
      apptRows += `<tr>
      <td>${a.appointment_type}</td>
      <td>${memberName}</td>
      <td>${a.provider_name ?? ""}</td>
      <td>${formatExportDate(a.next_due_date)}</td>
      <td>${formatExportDate(a.last_completed_at)}</td>
      <td style="color:${statusColor};font-weight:600">${status}</td>
    </tr>`;
    }

    let medRows = "";
    for (const m of medications ?? []) {
      const memberName = (m as any).family_members?.name ?? "You";
      medRows += `<tr>
      <td>${m.name}</td>
      <td>${memberName}</td>
      <td>${m.dosage ?? ""}</td>
      <td>${m.frequency ?? ""}</td>
      <td>${m.reminder_time ?? ""}</td>
    </tr>`;
    }

    const html = `<!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, sans-serif; padding: 40px; color: #1a1f2e; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin-top: 24px; color: #5a6480; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #e5e7eb; color: #5a6480; font-weight: 600; }
    td { padding: 8px; border-bottom: 1px solid #f3f4f6; }
    .footer { margin-top: 32px; font-size: 11px; color: #9ca3af; }
  </style></head><body>
    <h1>Health Summary</h1>
    <p style="color:#5a6480;font-size:13px">${peopleForExport.length} ${peopleForExport.length === 1 ? "person" : "people"} · ${petsForExport.length} ${petsForExport.length === 1 ? "pet" : "pets"} · ${(appointments ?? []).length} ${(appointments ?? []).length === 1 ? "appointment" : "appointments"} · ${(medications ?? []).length} ${(medications ?? []).length === 1 ? "medication" : "medications"}</p>

    ${apptRows ? `<h2>Appointments</h2>
    <table>
      <thead><tr><th>Type</th><th>For</th><th>Provider</th><th>Next Due</th><th>Last Done</th><th>Status</th></tr></thead>
      <tbody>${apptRows}</tbody>
    </table>` : ""}

    ${medRows ? `<h2>Medications</h2>
    <table>
      <thead><tr><th>Medication</th><th>For</th><th>Dosage</th><th>Frequency</th><th>Reminder</th></tr></thead>
      <tbody>${medRows}</tbody>
    </table>` : ""}

    <div class="footer">Generated by LifeMaintained · lifemaintained.app</div>
  </body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
    } catch (e) {
      console.warn("[EXPORT] Health PDF failed:", e);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Health</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleExportHealth}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, padding: 8 })}
            hitSlop={8}
            accessibilityLabel="Export health summary"
            accessibilityRole="button"
          >
            <Ionicons name="share-outline" size={22} color={Colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.addHeaderBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert("Add to Health", "What would you like to add?", [
                { text: "Family Member", onPress: openAddPerson },
                { text: "Appointment", onPress: () => router.push("/add-appointment") },
                { text: "Medication", onPress: () => router.push("/add-medication") },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            accessibilityLabel="Add health item"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={18} color="#0C111B" />
            <Text style={styles.addHeaderBtnText}>Add</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0), flexGrow: 1 }]}
      >
        {isLoading ? (
          <View style={{ padding: 20, gap: 16 }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={{ backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10 }}>
                <Row>
                  <S anim={skeletonAnim} w={36} h={36} r={18} />
                  <Col flex={1} gap={6}>
                    <S anim={skeletonAnim} w="60%" h={14} r={5} />
                    <S anim={skeletonAnim} w="40%" h={11} r={4} />
                  </Col>
                  <S anim={skeletonAnim} w={60} h={24} r={12} />
                </Row>
                <S anim={skeletonAnim} w="80%" h={11} r={4} />
              </View>
            ))}
          </View>
        ) : (
          <>
            {hasNoMembers && (!appointments || appointments.length === 0) && (!medications || medications.length === 0) ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="heart-outline" size={48} color={Colors.healthMuted} />
                <Text style={styles.emptyTitle}>Your health, organized</Text>
                <Text style={styles.emptyText}>
                  Track appointments, medications, and preventive care for yourself and your family.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openAddPerson(); }}
                >
                  <Ionicons name="person-add-outline" size={18} color={Colors.textInverse} />
                  <Text style={styles.emptyBtnText}>Add Yourself</Text>
                </Pressable>
                {profile?.subscription_tier === "free" && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", marginTop: 8 }}>
                    Free plan includes limited tracking. Upgrade for more.
                  </Text>
                )}
              </View>
            ) : (
              <>
                {insightText && (
                  <View style={styles.insightCard}>
                    <Ionicons name="heart-outline" size={16} color={Colors.health} />
                    <Text style={styles.insightText}>{insightText}</Text>
                  </View>
                )}

                {actionNeededAppts.length > 0 && (
                  <SectionBlock title={`Action Needed (${actionNeededAppts.length})`} titleColor={Colors.overdue}>
                    <View style={styles.apptList}>
                      {actionNeededAppts.map(a => (
                        <AppointmentCard key={a.id} appointment={a} onMarkComplete={handleOpenMarkComplete} />
                      ))}
                    </View>
                  </SectionBlock>
                )}

                {screeningSuggestions.length > 0 && (
                  <SectionBlock title="Recommended Screenings">
                    <View style={styles.screeningList}>
                      {screeningSuggestions.map(s => (
                        <View key={s.title} style={styles.screeningCard}>
                          <View style={styles.screeningInfo}>
                            <Text style={styles.screeningTitle}>{s.title}</Text>
                            <Text style={styles.screeningDesc}>{s.description}</Text>
                          </View>
                          <Pressable
                            style={({ pressed }) => [styles.screeningAddBtn, { opacity: pressed || addingScreening === s.title ? 0.5 : 1 }]}
                            onPress={() => handleAddScreening(s.title, s.interval)}
                            disabled={addingScreening != null}
                            hitSlop={8}
                          >
                            {addingScreening === s.title ? (
                              <ActivityIndicator size="small" color={Colors.health} />
                            ) : (
                              <Ionicons name="add-circle-outline" size={22} color={Colors.health} />
                            )}
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </SectionBlock>
                )}

                {people.length > 0 && (
                  <SectionBlock
                    title="Family Members"
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openAddPerson(); }}
                  >
                    <View style={styles.memberGrid}>
                      {people.map((person, personIdx) => {
                        const maxPeople = personLimit(profile);
                        const isLocked = Number.isFinite(maxPeople) && personIdx >= maxPeople;
                        const status = apptStatusByMember[person.id] ?? { overdue: 0, upcoming: 0 };
                        return (
                          <View key={person.id} style={{ position: "relative" }}>
                            <View style={{ opacity: isLocked ? 0.5 : 1 }}>
                              <MemberCard
                                member={person}
                                overdue={status.overdue}
                                upcoming={status.upcoming}
                                onPress={() => { Haptics.selectionAsync(); router.push(`/family-member/${person.id}` as any); }}
                              />
                            </View>
                            {isLocked && (
                              <Pressable
                                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                                onPress={() => Alert.alert(
                                  "Family Member Locked",
                                  "This family member is locked on your current plan. Upgrade to access all your family members.",
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    { text: "Upgrade Now", onPress: () => router.push("/subscription" as any) },
                                  ]
                                )}
                              />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </SectionBlock>
                )}

                {pets.length > 0 && (
                  <SectionBlock
                    title="Pets"
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openAddPet(); }}
                  >
                    <View style={styles.memberGrid}>
                      {pets.map((pet, petIdx) => {
                        const maxPets = petLimit(profile);
                        const isLocked = Number.isFinite(maxPets) && petIdx >= maxPets;
                        const status = apptStatusByMember[pet.id] ?? { overdue: 0, upcoming: 0 };
                        return (
                          <View key={pet.id} style={{ position: "relative" }}>
                            <View style={{ opacity: isLocked ? 0.5 : 1 }}>
                              <MemberCard
                                member={pet}
                                overdue={status.overdue}
                                upcoming={status.upcoming}
                                onPress={() => { Haptics.selectionAsync(); router.push(`/family-member/${pet.id}` as any); }}
                              />
                            </View>
                            {isLocked && (
                              <Pressable
                                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                                onPress={() => Alert.alert(
                                  "Family Member Locked",
                                  "This family member is locked on your current plan. Upgrade to access all your family members.",
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    { text: "Upgrade Now", onPress: () => router.push("/subscription" as any) },
                                  ]
                                )}
                              />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </SectionBlock>
                )}

                {medications && medications.length > 0 && (
                  <SectionBlock
                    title="Medication Tracker"
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-medication"); }}
                  >
                    <View style={styles.medList}>
                      {medications.map(m => {
                        const metaParts: string[] = [];
                        if ((m as any).family_members?.name) metaParts.push((m as any).family_members.name);
                        if (m.reminder_time) metaParts.push(`Daily · ${m.reminder_time}`);
                        return (
                          <View key={m.id} style={styles.medCard}>
                            <View style={styles.medInfo}>
                              <Text style={styles.medName}>{m.name}</Text>
                              {metaParts.length > 0 && (
                                <Text style={styles.medMetaText} numberOfLines={1}>{metaParts.join(" · ")}</Text>
                              )}
                            </View>
                            <View style={styles.medRight}>
                              <View style={[styles.reminderDot, { backgroundColor: m.reminders_enabled ? Colors.good : Colors.border }]} />
                              {m.reminder_time && (
                                <Pressable
                                  style={({ pressed }) => [styles.notifBtn, { opacity: pressed ? 0.7 : 1 }]}
                                  onPress={() => handleScheduleNotification(m)}
                                  disabled={schedulingMed === m.id}
                                >
                                  {schedulingMed === m.id ? (
                                    <ActivityIndicator size="small" color={Colors.health} />
                                  ) : (
                                    <Ionicons name="notifications-outline" size={16} color={Colors.health} />
                                  )}
                                </Pressable>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </SectionBlock>
                )}

                <Text style={styles.disclaimer}>
                  Reminders only — not medical advice. Always consult your healthcare provider.
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      <SaveToast visible={toastVisible} message={toastMsg} isError={toastIsError} />

      <Modal
        visible={markCompleteAppt != null}
        transparent
        animationType="slide"
        onRequestClose={handleCloseMarkComplete}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.sheetBackdrop} onPress={handleCloseMarkComplete} />
          <View style={[styles.sheetContainer, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {markCompleteAppt?.appointment_type ?? "Mark Complete"}
            </Text>

            <ScrollView
              style={styles.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sheetFields}>
                <View style={styles.sheetField}>
                  <DatePicker
                    label="Date Completed"
                    value={completeDate}
                    onChange={setCompleteDate}
                    maximumDate={new Date()}
                  />
                </View>

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Cost  <Text style={styles.sheetFieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={completeCost}
                    onChangeText={setCompleteCost}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 75.00"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Provider  <Text style={styles.sheetFieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={completeProvider}
                    onChangeText={setCompleteProvider}
                    placeholder="e.g. Dr. Smith"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Notes  <Text style={styles.sheetFieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={[styles.sheetInput, styles.sheetInputMultiline]}
                    value={completeNotes}
                    onChangeText={setCompleteNotes}
                    placeholder="e.g. All clear, follow up in 1 year"
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    numberOfLines={2}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.sheetActions}>
              <Pressable
                style={({ pressed }) => [styles.sheetCancelBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={handleCloseMarkComplete}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.sheetSaveBtn, { opacity: pressed || isSavingComplete ? 0.8 : 1 }]}
                onPress={handleSaveMarkComplete}
                disabled={isSavingComplete}
              >
                {isSavingComplete ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color={Colors.textInverse} />
                    <Text style={styles.sheetSaveText}>Mark Complete</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function AppointmentCard({ appointment, onMarkComplete }: { appointment: any; onMarkComplete: (a: any) => void }) {
  const status = getStatus(appointment.next_due_date, appointment.last_completed_at);
  const barColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
  const member = (appointment as any).family_members;
  const subParts: string[] = [];
  if (member?.name) subParts.push(member.name);
  if (appointment.provider_name) subParts.push(appointment.provider_name);
  if (appointment.next_due_date) subParts.push(format(parseISO(appointment.next_due_date), "MMM d, yyyy"));

  return (
    <Pressable
      style={({ pressed }) => [styles.apptCard, pressed && { opacity: 0.7 }]}
      onPress={() => onMarkComplete(appointment)}
    >
      <View style={[styles.apptBar, { backgroundColor: barColor }]} />
      <View style={styles.apptInfo}>
        <Text style={styles.apptType}>{appointment.appointment_type}</Text>
        {subParts.length > 0 && (
          <Text style={styles.apptMeta} numberOfLines={1}>{subParts.join(" · ")}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

function SectionBlock({ title, titleColor, onAdd, children }: { title: string; titleColor?: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, titleColor ? { color: titleColor } : {}]}>{title.toUpperCase()}</Text>
        {onAdd && (
          <Pressable
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            onPress={onAdd}
            hitSlop={8}
          >
            <Ionicons name="add" size={18} color={Colors.textTertiary} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function MemberCard({ member, overdue, upcoming, onPress }: { member: any; overdue: number; upcoming: number; onPress: () => void }) {
  const isPet = member.member_type === "pet";
  const label = isPet
    ? (member.pet_type ?? "Pet")
    : (member.relationship ?? member.member_type ?? "Person");
  const statusDotColor = overdue > 0 ? Colors.overdue : upcoming > 0 ? Colors.dueSoon : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.memberCard, { opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      <Ionicons name={isPet ? "paw-outline" : "person-outline"} size={18} color={Colors.health} />
      <View style={styles.memberInfo}>
        <View style={styles.memberTitleRow}>
          {statusDotColor && <View style={[styles.memberStatusDot, { backgroundColor: statusDotColor }]} />}
          <Text style={styles.memberName}>{member.name}</Text>
        </View>
        <Text style={styles.memberMeta} numberOfLines={1}>{label}</Text>
      </View>
      <View style={styles.memberRight}>
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.background,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  addHeaderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.health,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addHeaderBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#0C111B" },

  content: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },

  insightCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: Colors.healthMuted, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: Colors.health + "30",
  },
  insightText: {
    flex: 1, fontSize: 14, fontFamily: "Inter_500Medium",
    color: Colors.text, lineHeight: 20,
  },

  sectionBlock: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },

  memberGrid: { gap: 10 },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  memberInfo: { flex: 1, gap: 3 },
  memberTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  memberName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  memberMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textTransform: "capitalize" },
  memberRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  memberStatusDot: { width: 8, height: 8, borderRadius: 4 },

  apptList: { gap: 8 },
  apptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  apptBar: { width: 4, height: 28, borderRadius: 2, flexShrink: 0 },
  apptInfo: { flex: 1, gap: 3 },
  apptType: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  apptMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  screeningList: { gap: 8 },
  screeningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  screeningInfo: { flex: 1, gap: 3 },
  screeningTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  screeningDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  screeningAddBtn: { flexShrink: 0 },

  medList: { gap: 8 },
  medCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  medInfo: { flex: 1, gap: 3 },
  medName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  medMetaText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  medRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  reminderDot: { width: 8, height: 8, borderRadius: 4 },
  notifBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.healthMuted,
    alignItems: "center",
    justifyContent: "center",
  },

  disclaimer: {
    fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    textAlign: "center", paddingTop: 8,
  },

  emptyWrap: { paddingTop: 60, alignItems: "center", gap: 12, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.health, borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 13, marginTop: 8,
  },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  sheetOverlay: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheetContainer: {
    backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 20, textAlign: "center",
  },
  sheetScroll: { maxHeight: 400 },
  sheetFields: { gap: 16 },
  sheetField: { gap: 6 },
  sheetFieldLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 1.5,
  },
  sheetFieldOptional: {
    fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    textTransform: "none", letterSpacing: 0,
  },
  sheetInput: {
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text,
    borderWidth: 1, borderColor: Colors.border,
  },
  sheetInputMultiline: { minHeight: 64, textAlignVertical: "top" },
  dateStepper: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, overflow: "hidden",
  },
  dateStepBtn: { width: 44, height: 46, alignItems: "center", justifyContent: "center" },
  dateStepValue: {
    flex: 1, textAlign: "center", fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text,
  },
  dateQuickRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  dateQuickBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center",
  },
  dateQuickBtnActive: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  dateQuickText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  dateQuickTextActive: { color: Colors.health, fontFamily: "Inter_600SemiBold" },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 24 },
  sheetCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 13, alignItems: "center",
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  sheetSaveBtn: {
    flex: 2, paddingVertical: 13, borderRadius: 13,
    backgroundColor: Colors.health, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 6,
  },
  sheetSaveText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
