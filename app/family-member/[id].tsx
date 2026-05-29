import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  Image,
  ActivityIndicator,
  TextInput,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";
import { parseISO, isBefore, addDays, addMonths, addWeeks, format, differenceInYears } from "date-fns";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import DatePicker from "@/components/DatePicker";
import { completeHealthAppointment } from "@/lib/rpc";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import { capture } from "@/lib/analytics";
import { logMedicationDose, undoLastMedicationDose } from "@/lib/rpc";
import { useDeepLinkHighlight } from "@/lib/useDeepLinkHighlight";
import { HighlightBackdrop } from "@/components/HighlightBackdrop";

function getApptStatus(nextDue: string | null, lastCompleted: string | null) {
  if (!lastCompleted) return "due_soon";
  if (!nextDue) return "good";
  const d = parseISO(nextDue);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function FamilyMemberDetailScreen() {
  const { id, appointmentId, medicationId } = useLocalSearchParams<{ id: string; appointmentId?: string; medicationId?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const skeletonAnim = usePulse();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const [activeTab, setActiveTab] = useState<"appointments" | "medications">("appointments");
  const deepLinkTarget = appointmentId ?? medicationId;
  const { highlightedId: highlightedItemId, scrollProps: highlightScrollProps, registerRow: registerItemRow, dismissImmediately: dismissHighlight } = useDeepLinkHighlight(deepLinkTarget);

  // Deep-link: switch tab + expand target. Highlight + scroll handled by hook.
  useEffect(() => {
    if (!deepLinkTarget) return;
    setActiveTab(appointmentId ? "appointments" : "medications");
    setExpandedId(deepLinkTarget);
  }, [appointmentId, medicationId, deepLinkTarget]);

  // Blur cleanup — dismiss the highlight when the screen loses focus.
  useFocusEffect(
    useCallback(() => {
      return () => { dismissHighlight(); };
    }, [dismissHighlight]),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const isDeletingMemberRef = useRef(false);

  const { data: member, isLoading: loadingMember } = useQuery({
    queryKey: ["family_member", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("family_members")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  const { data: appointments, isLoading: loadingAppts, refetch } = useQuery({
    queryKey: ["member_appointments", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("health_appointments")
        .select("*")
        .eq("family_member_id", id!)
        .order("next_due_date", { ascending: true });
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: medications, isLoading: loadingMeds } = useQuery({
    queryKey: ["member_medications", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("medications")
        .select("*")
        .eq("family_member_id", id!)
        .order("name");
      return data ?? [];
    },
    enabled: !!id,
  });

  // Seed dose state for all medications: pull 30 days of dose dates +
  // today's count + streak. Single query, deterministic order, client-side
  // aggregation. Runs whenever the medication list changes.
  useEffect(() => {
    if (!user || !medications || medications.length === 0) return;
    const medIds = medications.map((m: any) => m.id);
    const today = format(new Date(), "yyyy-MM-dd");
    const cutoff = format(addDays(new Date(), -30), "yyyy-MM-dd");

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("medication_dose_logs")
        .select("medication_id, dose_date")
        .in("medication_id", medIds)
        .gte("dose_date", cutoff)
        .order("dose_date", { ascending: false });
      if (cancelled) return;
      const byMed: Record<string, Set<string>> = {};
      const todayByMed: Record<string, number> = {};
      for (const m of medIds) { byMed[m] = new Set(); todayByMed[m] = 0; }
      for (const row of data ?? []) {
        const mid = row.medication_id;
        const d = row.dose_date;
        byMed[mid]?.add(d);
        if (d === today) todayByMed[mid] = (todayByMed[mid] ?? 0) + 1;
      }
      const next: Record<string, { today: number; streak: number; dates: string[] }> = {};
      const todayDate = new Date();
      for (const mid of medIds) {
        const dates = Array.from(byMed[mid] ?? []).sort((a, b) => b.localeCompare(a));
        // Streak: consecutive days ending today
        let streak = 0;
        for (let i = 0; i < dates.length; i++) {
          const expected = format(addDays(todayDate, -i), "yyyy-MM-dd");
          if (dates[i] === expected) streak++; else break;
        }
        next[mid] = { today: todayByMed[mid] ?? 0, streak, dates };
      }
      setDoseState(next);
    })();

    return () => { cancelled = true; };
  }, [medications, user]);

  const isLoading = loadingMember || loadingAppts || loadingMeds;

  const summaryStats = useMemo(() => {
    if (!appointments) return { total: 0, overdue: 0, dueSoon: 0, upcoming90: 0 };
    let overdue = 0, dueSoon = 0, upcoming90 = 0;
    const cutoff90 = addDays(new Date(), 90);
    for (const a of appointments) {
      const st = getApptStatus(a.next_due_date, a.last_completed_at);
      if (st === "overdue") overdue++;
      else if (st === "due_soon") dueSoon++;
      if (a.next_due_date) {
        const d = parseISO(a.next_due_date);
        if (d <= cutoff90) upcoming90++;
      }
    }
    return { total: appointments.length, overdue, dueSoon, upcoming90 };
  }, [appointments]);

  const apptGroups = useMemo(() => {
    if (!appointments || appointments.length === 0) return [];
    return [...appointments].sort((a, b) => {
      const sa = getApptStatus(a.next_due_date, a.last_completed_at);
      const sb = getApptStatus(b.next_due_date, b.last_completed_at);
      const order = { overdue: 0, due_soon: 1, good: 2 };
      return (order[sa] ?? 2) - (order[sb] ?? 2);
    });
  }, [appointments]);

  const [saveErrorToastVisible, setSaveErrorToastVisible] = useState(false);
  const [saveErrorToastTitle, setSaveErrorToastTitle] = useState("");
  const [saveErrorToastSubtitle, setSaveErrorToastSubtitle] = useState<string | undefined>(undefined);

  function fireSaveErrorToast(title: string, subtitle?: string) {
    setSaveErrorToastTitle(title);
    setSaveErrorToastSubtitle(subtitle);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setSaveErrorToastVisible(true);
    setTimeout(() => setSaveErrorToastVisible(false), 3000);
  }

  const [markCompleteAppt, setMarkCompleteAppt] = useState<any | null>(null);
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeCost, setCompleteCost] = useState("");
  const [completeProvider, setCompleteProvider] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeDiy, setCompleteDiy] = useState(false);
  const [isSavingComplete, setIsSavingComplete] = useState(false);

  const [successToastVisible, setSuccessToastVisible] = useState(false);
  const [successToastTitle, setSuccessToastTitle] = useState("");
  const [successToastSubtitle, setSuccessToastSubtitle] = useState<string | undefined>(undefined);

  function fireSuccessToast(title: string, subtitle?: string) {
    setSuccessToastTitle(title);
    setSuccessToastSubtitle(subtitle);
    setSuccessToastVisible(true);
    setTimeout(() => setSuccessToastVisible(false), 2800);
  }

  function handleOpenMarkComplete(appt: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMarkCompleteAppt(appt);
    setCompleteDate(format(new Date(), "yyyy-MM-dd"));
    setCompleteCost("");
    setCompleteProvider(appt.provider_name ?? "");
    setCompleteNotes("");
    setCompleteDiy(false);
    setIsSavingComplete(false);
  }

  function handleCloseMarkComplete() {
    setMarkCompleteAppt(null);
  }

  function computeNextDue(appt: any, completedDateStr: string): string {
    const completed = parseISO(completedDateStr);
    if (appt.interval_type === "weekly") return format(addWeeks(completed, 1), "yyyy-MM-dd");
    if (appt.interval_type === "biweekly") return format(addWeeks(completed, 2), "yyyy-MM-dd");
    const months = typeof appt.interval_months === "number" && appt.interval_months > 0 ? appt.interval_months : 12;
    return format(addMonths(completed, months), "yyyy-MM-dd");
  }

  // Per-medication dose state: today_count + streak_days + 30-day filled dates.
  // Indexed by medication id. Initial state empty; first render seeds from a
  // separate query, taps update optimistically + on RPC return.
  const [doseState, setDoseState] = useState<Record<string, { today: number; streak: number; dates: string[] }>>({});
  const [pendingDoseId, setPendingDoseId] = useState<string | null>(null);

  function dotsFor(medId: string): string[] {
    return doseState[medId]?.dates ?? [];
  }
  function todayCountFor(medId: string): number {
    return doseState[medId]?.today ?? 0;
  }
  function streakFor(medId: string): number {
    return doseState[medId]?.streak ?? 0;
  }

  async function handleLogDose(med: any) {
    if (!user || pendingDoseId === med.id) return;
    setPendingDoseId(med.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // Optimistic increment
    const prev = doseState[med.id] ?? { today: 0, streak: 0, dates: [] };
    const today = format(new Date(), "yyyy-MM-dd");
    const optimisticDates = prev.dates.includes(today) ? prev.dates : [today, ...prev.dates];
    setDoseState(s => ({ ...s, [med.id]: { today: prev.today + 1, streak: Math.max(prev.streak, 1), dates: optimisticDates } }));

    try {
      const { data, error } = await logMedicationDose({
        p_medication_id: med.id,
        p_taken_at: new Date().toISOString(),
        p_dose_date: today,
      });
      if (error || !data) throw error ?? new Error("no data");

      setDoseState(s => ({ ...s, [med.id]: { today: data.today_count, streak: data.streak_days, dates: data.dose_dates_30d } }));

      capture("medication_dose_logged", {
        medication_id: med.id,
        family_member_id: med.family_member_id ?? null,
        today_count: data.today_count,
        streak_days: data.streak_days,
      });

      const streakLine = data.streak_days >= 3 ? ` · 🔥 ${data.streak_days} day streak` : "";
      fireSuccessToast(
        "Dose logged",
        `${data.today_count} taken today${streakLine}`,
      );
    } catch {
      // Revert optimistic update on failure
      setDoseState(s => ({ ...s, [med.id]: prev }));
      fireSaveErrorToast("Failed to log dose", "Please try again");
    } finally {
      setPendingDoseId(null);
    }
  }

  async function handleUndoDose(med: any) {
    if (!user || pendingDoseId === med.id) return;
    if ((doseState[med.id]?.today ?? 0) === 0) return;
    setPendingDoseId(med.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    const prev = doseState[med.id] ?? { today: 0, streak: 0, dates: [] };

    try {
      const { data, error } = await undoLastMedicationDose({
        p_medication_id: med.id,
        p_today: format(new Date(), "yyyy-MM-dd"),
      });
      if (error || !data) throw error ?? new Error("no data");

      setDoseState(s => ({ ...s, [med.id]: { today: data.today_count, streak: data.streak_days, dates: data.dose_dates_30d } }));

      capture("medication_dose_undone", {
        medication_id: med.id,
        family_member_id: med.family_member_id ?? null,
        today_count: data.today_count,
      });

      fireSuccessToast("Dose undone", `${data.today_count} taken today`);
    } catch {
      setDoseState(s => ({ ...s, [med.id]: prev }));
      fireSaveErrorToast("Failed to undo", "Please try again");
    } finally {
      setPendingDoseId(null);
    }
  }

  async function handleSaveMarkComplete() {
    if (!markCompleteAppt || !user) return;
    const appt = markCompleteAppt;
    setIsSavingComplete(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const nextDate = computeNextDue(appt, completeDate);
    const completedAt = new Date(completeDate + "T12:00:00").toISOString();
    const now = new Date().toISOString();

    queryClient.setQueryData(["member_appointments", id], (old: any[] | undefined) => {
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

      const { error: rpcError } = await completeHealthAppointment({
        p_appointment_id: appt.id,
        p_completed_date: completedAt,
        p_notes: completeNotes.trim() || undefined,
        p_cost: costNum != null && !isNaN(costNum) ? costNum : undefined,
        p_provider_name: completeProvider.trim() || undefined,
        p_did_it_myself: completeDiy,
      });

      if (rpcError) throw rpcError;

      capture("health_appointment_completed", {
        appointment_id: appt.id,
        family_member_id: appt.family_member_id ?? (id ?? ""),
        appointment_type: appt.appointment_type,
      });

      queryClient.invalidateQueries({ queryKey: ["member_appointments", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      fireSuccessToast(
        `${appt.appointment_type} marked complete`,
        `Next due ${format(parseISO(nextDate), "MMM d, yyyy")}`,
      );

      if (user?.id) {
        try { scheduleMaintenanceNotifications(user.id).catch(() => {}); } catch {}
      }
    } catch {
      queryClient.invalidateQueries({ queryKey: ["member_appointments", id] });
      fireSaveErrorToast("Failed to save", "Please try again");
    } finally {
      setIsSavingComplete(false);
    }
  }

  function handleMemberPhoto() {
    if (!user || !id) return;
    if (member?.photo_url) {
      Alert.alert("Profile Photo", "Choose an option", [
        { text: "Take Photo", onPress: () => pickMemberPhoto("camera") },
        { text: "Choose from Library", onPress: () => pickMemberPhoto("library") },
        { text: "Remove Photo", style: "destructive", onPress: removeMemberPhoto },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      Alert.alert("Add Photo", "Choose an option", [
        { text: "Take Photo", onPress: () => pickMemberPhoto("camera") },
        { text: "Choose from Library", onPress: () => pickMemberPhoto("library") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  async function pickMemberPhoto(source: "camera" | "library") {
    try {
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
      if (result.canceled) return;
      const uri = result.assets[0].uri;
      setUploadingPhoto(true);
      try {
        const response = await fetch(uri);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const storagePath = `${user!.id}/${id}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("profile-photos")
          .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("profile-photos").getPublicUrl(storagePath);
        const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        await supabase.from("family_members").update({ photo_url: publicUrl }).eq("id", id!);
        queryClient.invalidateQueries({ queryKey: ["family_member", id] });
      } finally {
        setUploadingPhoto(false);
      }
    } catch {
      setUploadingPhoto(false);
    }
  }

  async function removeMemberPhoto() {
    if (!user || !id) return;
    setUploadingPhoto(true);
    try {
      await supabase.from("family_members").update({ photo_url: null }).eq("id", id!);
      const storagePath = `${user.id}/${id}.jpg`;
      await supabase.storage.from("profile-photos").remove([storagePath]);
      queryClient.invalidateQueries({ queryKey: ["family_member", id] });
    } catch {
      // silent
    } finally {
      setUploadingPhoto(false);
    }
  }

  function handleDeleteMember() {
    if (!member || isDeletingMemberRef.current) return;
    Alert.alert(
      `Remove ${member.name}?`,
      `This will delete all their appointments and medications.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (isDeletingMemberRef.current) return;
            isDeletingMemberRef.current = true;
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await supabase.from("health_appointments").delete().eq("family_member_id", id!);
              await supabase.from("medications").delete().eq("family_member_id", id!);
              await supabase.from("family_members").delete().eq("id", id!);
              queryClient.invalidateQueries({ queryKey: ["family_members"] });
              queryClient.invalidateQueries({ queryKey: ["health_appointments"] });
              queryClient.invalidateQueries({ queryKey: ["medications"] });
              queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any);
            } catch (err: any) {
              isDeletingMemberRef.current = false;
              fireSaveErrorToast("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
            }
          },
        },
      ]
    );
  }

  function handleDeleteAppointment(apptId: string) {
    Alert.alert(
      "Delete Appointment",
      "This appointment type will be removed from the tracker.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await supabase.from("health_appointments").delete().eq("id", apptId);
              queryClient.invalidateQueries({ queryKey: ["member_appointments", id] });
              queryClient.invalidateQueries({ queryKey: ["health_appointments"] });
            } catch (err: any) {
              fireSaveErrorToast("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
            }
          },
        },
      ]
    );
  }

  const isPet = member?.member_type === "pet";
  const memberName = member?.name ?? "Member";
  const memberLabel = isPet
    ? (member?.pet_type ?? "Pet")
    : (member?.relationship ?? member?.member_type ?? "Person");
  const memberAge = member?.date_of_birth
    ? differenceInYears(new Date(), parseISO(member.date_of_birth))
    : null;

  const statusLabel = summaryStats.overdue > 0
    ? `${summaryStats.overdue} overdue`
    : summaryStats.dueSoon > 0
    ? `${summaryStats.dueSoon} due soon`
    : "All caught up";
  const statusColor = summaryStats.overdue > 0
    ? Colors.overdue
    : summaryStats.dueSoon > 0
    ? Colors.dueSoon
    : Colors.good;

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTextBlock}>
          <Text style={styles.headerTitle} numberOfLines={1}>{memberName}</Text>
          <Text style={styles.headerMeta} numberOfLines={1}>
            {memberLabel}{memberAge != null ? ` · ${memberAge} yrs` : ""}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.deleteMemberBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDeleteMember}
            hitSlop={4}
          >
            <Ionicons name="trash-outline" size={16} color={Colors.overdue} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.addApptBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/add-appointment?familyMemberId=${encodeURIComponent(id!)}` as any); }}
          >
            <Ionicons name="add" size={20} color={Colors.textInverse} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: 20, gap: 16 }}>
          <View style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
            <S anim={skeletonAnim} w={60} h={60} r={30} />
            <S anim={skeletonAnim} w={120} h={18} r={5} />
            <S anim={skeletonAnim} w={80} h={13} r={4} />
          </View>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10 }}>
              <Row>
                <Col flex={1} gap={6}>
                  <S anim={skeletonAnim} w="70%" h={14} r={5} />
                  <S anim={skeletonAnim} w="50%" h={11} r={4} />
                </Col>
                <S anim={skeletonAnim} w={50} h={22} r={11} />
              </Row>
            </View>
          ))}
        </View>
      ) : (
        <ScrollView
          {...highlightScrollProps}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 40 },
          ]}
        >
          <View style={styles.avatarSection}>
            <Pressable onPress={handleMemberPhoto} style={styles.avatarWrap}>
              {member?.photo_url ? (
                <>
                  <Image source={{ uri: member.photo_url }} style={styles.avatar} />
                  {uploadingPhoto && (
                    <View style={styles.avatarOverlay}>
                      <ActivityIndicator color="#fff" size="small" />
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.avatarPlaceholder}>
                  {uploadingPhoto ? (
                    <ActivityIndicator color={Colors.textTertiary} size="small" />
                  ) : (
                    <Ionicons name={isPet ? "paw-outline" : "person-outline"} size={28} color={Colors.textTertiary} />
                  )}
                </View>
              )}
              <View style={styles.avatarCameraBtn}>
                <Ionicons name="camera-outline" size={10} color="#fff" />
              </View>
            </Pressable>
          </View>

          <View style={styles.summaryBar}>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryValue}>{summaryStats.total}</Text>
              <Text style={styles.summaryLabel}>appointment{summaryStats.total !== 1 ? "s" : ""}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryStat}>
              <Text style={[styles.summaryValue, summaryStats.overdue > 0 && { color: Colors.overdue }]}>
                {summaryStats.upcoming90}
              </Text>
              <Text style={styles.summaryLabel}>upcoming (90d)</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryStat}>
              <Text style={styles.summaryValue}>{medications?.length ?? 0}</Text>
              <Text style={styles.summaryLabel}>medication{(medications?.length ?? 0) !== 1 ? "s" : ""}</Text>
            </View>
          </View>

          <View style={styles.tabs}>
            {(["appointments", "medications"] as const).map(tab => (
              <Pressable
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === "appointments" ? "Appointments" : "Medications"}
                </Text>
              </Pressable>
            ))}
          </View>

          <Tooltip
            id={TOOLTIP_IDS.FAMILY_MEMBER_DETAIL}
            message="Track appointments and medications for each family member or pet individually."
            icon="people-outline"
          />

          {activeTab === "appointments" ? (
            <>
              <Text style={styles.sectionLabel}>APPOINTMENTS</Text>
              {apptGroups.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No appointments yet</Text>
                  <Text style={styles.emptyText}>Tap + to add an appointment type to track.</Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/add-appointment?familyMemberId=${encodeURIComponent(id!)}` as any); }}
                  >
                    <Ionicons name="add" size={16} color={Colors.textInverse} />
                    <Text style={styles.emptyBtnText}>Add Appointment</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.listCard}>
                  {apptGroups.map((appt, idx) => {
                    const isExpanded = expandedId === appt.id;
                    const isLast = idx === apptGroups.length - 1;
                    const status = getApptStatus(appt.next_due_date, appt.last_completed_at);
                    const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
                    const subtitleParts = [
                      appt.last_completed_at
                        ? `Last: ${format(parseISO(appt.last_completed_at), "MMM d, yyyy")}`
                        : "Not yet completed",
                    ].filter(Boolean);
                    const nextDueText = appt.next_due_date
                      ? format(parseISO(appt.next_due_date), "MMM d")
                      : null;

                    return (
                      <View
                        key={appt.id}
                        ref={(node) => { registerItemRow(appt.id, node); }}
                        collapsable={false}
                        pointerEvents="box-none"
                        style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}
                      >
                        <Pressable
                          style={({ pressed }) => [styles.taskRow, { opacity: pressed ? 0.85 : 1 }]}
                          onPress={() => { setExpandedId(isExpanded ? null : appt.id); Haptics.selectionAsync(); }}
                          accessibilityRole="button"
                        >
                          <View style={[styles.taskBar, { backgroundColor: statusColor }]} />
                          <View style={styles.taskInfo}>
                            <Text style={styles.taskTitle} numberOfLines={1}>{appt.appointment_type}</Text>
                            {appt.provider_name && (
                              <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 }}>
                                {appt.provider_name}
                              </Text>
                            )}
                            <Text style={styles.taskSub} numberOfLines={1}>{subtitleParts.join(" · ")}</Text>
                          </View>
                          {nextDueText && (
                            <Text style={[styles.taskDue, { color: statusColor }]}>{nextDueText}</Text>
                          )}
                        </Pressable>

                        {isExpanded && (
                          <View style={styles.apptExpanded}>
                            {appt.notes ? (
                              <View style={styles.expandedRow}>
                                <Ionicons name="document-text-outline" size={14} color={Colors.textSecondary} />
                                <Text style={styles.expandedNotes}>{appt.notes}</Text>
                              </View>
                            ) : null}
                            {(appt.interval_type || appt.interval_months) ? (
                              <View style={styles.expandedRow}>
                                <Ionicons name="repeat-outline" size={14} color={Colors.textSecondary} />
                                <Text style={styles.expandedText}>
                                  {appt.interval_type === "weekly" ? "Every week"
                                    : appt.interval_type === "biweekly" ? "Every 2 weeks"
                                    : appt.interval_months === 1 ? "Every month"
                                    : appt.interval_months === 12 ? "Every year"
                                    : `Every ${appt.interval_months} months`}
                                </Text>
                              </View>
                            ) : null}
                            {!appt.notes && !appt.interval_type && !appt.interval_months && (
                              <Text style={styles.expandedEmpty}>No additional details.</Text>
                            )}
                            <View style={styles.expandedActions}>
                              <Pressable
                                style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
                                onPress={() => handleDeleteAppointment(appt.id)}
                              >
                                <Ionicons name="trash-outline" size={13} color={Colors.overdue} />
                                <Text style={styles.deleteBtnText}>Delete</Text>
                              </Pressable>
                              <Pressable
                                style={({ pressed }) => [styles.markCompleteBtn, { opacity: pressed ? 0.85 : 1 }]}
                                onPress={() => handleOpenMarkComplete(appt)}
                              >
                                <Ionicons name="checkmark-circle" size={14} color={Colors.textInverse} />
                                <Text style={styles.markCompleteBtnText}>Mark Complete</Text>
                              </Pressable>
                            </View>
                          </View>
                        )}

                        <HighlightBackdrop color={Colors.healthMuted} visible={appt.id === highlightedItemId} />
                        {!isLast && <View style={styles.rowDivider} />}
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>MEDICATIONS</Text>
              {!medications || medications.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No medications</Text>
                  <Text style={styles.emptyText}>No medications tracked for {memberName}.</Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-medication"); }}
                  >
                    <Ionicons name="add" size={16} color={Colors.textInverse} />
                    <Text style={styles.emptyBtnText}>Add Medication</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.listCard}>
                  {medications.map((med, idx) => (
                    <View
                      key={med.id}
                      ref={(node) => { registerItemRow(med.id, node); }}
                      collapsable={false}
                      pointerEvents="box-none"
                      style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}
                    >
                      <Pressable
                        style={({ pressed }) => [styles.taskRow, { opacity: pressed ? 0.85 : 1 }]}
                        onPress={() => { setExpandedId(expandedId === med.id ? null : med.id); Haptics.selectionAsync(); }}
                        accessibilityRole="button"
                      >
                        <View style={[styles.taskBar, { backgroundColor: Colors.health }]} />
                        <View style={styles.taskInfo}>
                          <Text style={styles.taskTitle}>{med.name}</Text>
                          <Text style={styles.taskSub} numberOfLines={1}>
                            {med.reminder_time ? `Daily · ${med.reminder_time}` : "No reminder"}
                            {todayCountFor(med.id) > 0 && ` · ${todayCountFor(med.id)} taken today`}
                            {streakFor(med.id) >= 3 && ` · 🔥 ${streakFor(med.id)}`}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => handleLogDose(med)}
                          onLongPress={() => handleUndoDose(med)}
                          delayLongPress={500}
                          disabled={pendingDoseId === med.id}
                          style={({ pressed }) => [
                            styles.takenBtn,
                            todayCountFor(med.id) > 0 && styles.takenBtnActive,
                            { opacity: pressed || pendingDoseId === med.id ? 0.7 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={todayCountFor(med.id) > 0 ? `${todayCountFor(med.id)} taken today. Tap to log another, long-press to undo.` : "Log dose"}
                        >
                          {todayCountFor(med.id) > 0 ? (
                            <>
                              <Ionicons name="checkmark" size={14} color={Colors.textInverse} />
                              <Text style={styles.takenBtnTextActive}>{todayCountFor(med.id)}</Text>
                            </>
                          ) : (
                            <Text style={styles.takenBtnText}>Taken</Text>
                          )}
                        </Pressable>
                      </Pressable>
                      {expandedId === med.id && (
                        <View style={styles.medExpanded}>
                          <Text style={styles.medExpandedLabel}>LAST 7 DAYS</Text>
                          <View style={styles.medDotRow}>
                            {Array.from({ length: 7 }).map((_, i) => {
                              const d = format(addDays(new Date(), -(6 - i)), "yyyy-MM-dd");
                              const hit = dotsFor(med.id).includes(d);
                              return (
                                <View
                                  key={d}
                                  style={[
                                    styles.medDot,
                                    { backgroundColor: hit ? Colors.health : Colors.border },
                                  ]}
                                />
                              );
                            })}
                          </View>
                          {streakFor(med.id) >= 3 && (
                            <Text style={styles.medStreakText}>🔥 {streakFor(med.id)} day streak</Text>
                          )}
                        </View>
                      )}
                      <HighlightBackdrop color={Colors.healthMuted} visible={med.id === highlightedItemId} />
                      {idx < medications.length - 1 && <View style={styles.rowDivider} />}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
      <SaveToast visible={successToastVisible} message={successToastTitle} subtitle={successToastSubtitle} />
      <SaveToast visible={saveErrorToastVisible} message={saveErrorToastTitle} subtitle={saveErrorToastSubtitle} isError />

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
                    placeholder="e.g. 150.00"
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
                    placeholder="e.g. Family Health Clinic"
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
                    placeholder="e.g. Annual checkup, all clear"
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                <Pressable
                  onPress={() => setCompleteDiy(!completeDiy)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
                >
                  <View style={{
                    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
                    borderColor: completeDiy ? Colors.health : Colors.border,
                    backgroundColor: completeDiy ? Colors.health : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {completeDiy && <Ionicons name="checkmark" size={16} color={Colors.textInverse} />}
                  </View>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text }}>
                    At-home / no provider
                  </Text>
                </Pressable>
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

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  backBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerTextBlock: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text },
  headerMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textTransform: "capitalize" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  deleteMemberBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.overdueMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  addApptBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.health,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },

  summaryBar: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  summaryStat: { alignItems: "center", gap: 3 },
  summaryValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  summaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },

  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabActive: { borderBottomColor: Colors.accent },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.text, fontFamily: "Inter_600SemiBold" },

  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },

  listCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },

  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingRight: 16,
  },
  taskBar: { width: 4, height: 28, borderRadius: 2, flexShrink: 0 },
  taskInfo: { flex: 1, gap: 2 },
  taskTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 19 },
  taskSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 17 },
  taskDue: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 0 },
  rowDivider: { height: 1, backgroundColor: Colors.borderSubtle },

  apptExpanded: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 10,
  },
  expandedRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  expandedText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 },
  expandedNotes: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1, lineHeight: 20, fontStyle: "italic" },
  expandedEmpty: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontStyle: "italic" },
  expandedActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 4 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.overdueMuted,
    minHeight: 44,
    justifyContent: "center",
  },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue },

  reminderDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },

  avatarSection: { alignItems: "center", paddingTop: 4, paddingBottom: 8 },
  avatarWrap: { position: "relative" },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.card },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCameraBtn: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.background,
  },

  emptyState: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.health,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 4,
  },
  markCompleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.health,
    minHeight: 44,
    justifyContent: "center",
  },
  markCompleteBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textInverse,
  },
  sheetOverlay: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheetContainer: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.border,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 20,
    textAlign: "center",
  },
  sheetScroll: { maxHeight: 400 },
  sheetFields: { gap: 16 },
  sheetField: { gap: 6 },
  sheetFieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  sheetFieldOptional: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textTransform: "none",
    letterSpacing: 0,
  },
  sheetInput: {
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
  sheetInputMultiline: { minHeight: 64, textAlignVertical: "top" },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 24 },
  sheetCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 13,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  sheetSaveBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.health,
  },
  sheetSaveText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  takenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 60,
    minHeight: 44,
    justifyContent: "center",
  },
  takenBtnActive: {
    backgroundColor: Colors.health,
    borderColor: Colors.health,
  },
  takenBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  takenBtnTextActive: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textInverse,
  },
  medExpanded: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 8,
  },
  medExpandedLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  medDotRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  medDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  medStreakText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    marginTop: 4,
  },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
