import React, { useMemo, useState, useRef } from "react";
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
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, format, differenceInYears } from "date-fns";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";

function getApptStatus(nextDue: string | null, lastCompleted: string | null) {
  if (!lastCompleted) return "due_soon";
  if (!nextDue) return "good";
  const d = parseISO(nextDue);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function FamilyMemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const skeletonAnim = usePulse();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const [activeTab, setActiveTab] = useState<"appointments" | "medications">("appointments");
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
              router.back();
            } catch (err: any) {
              isDeletingMemberRef.current = false;
              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
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
              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
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
                onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
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
                      <View key={appt.id}>
                        <Pressable
                          style={({ pressed }) => [styles.taskRow, { opacity: pressed ? 0.85 : 1 }]}
                          onPress={() => { Haptics.selectionAsync(); setExpandedId(isExpanded ? null : appt.id); }}
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
                            {appt.interval_months ? (
                              <View style={styles.expandedRow}>
                                <Ionicons name="repeat-outline" size={14} color={Colors.textSecondary} />
                                <Text style={styles.expandedText}>
                                  Every {appt.interval_months === 1 ? "month" : appt.interval_months === 12 ? "year" : `${appt.interval_months} months`}
                                </Text>
                              </View>
                            ) : null}
                            {!appt.notes && !appt.interval_months && (
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
                            </View>
                          </View>
                        )}

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
                    <View key={med.id}>
                      <View style={styles.taskRow}>
                        <View style={[styles.taskBar, { backgroundColor: Colors.health }]} />
                        <View style={styles.taskInfo}>
                          <Text style={styles.taskTitle}>{med.name}</Text>
                          {med.reminder_time && (
                            <Text style={styles.taskSub}>Daily · {med.reminder_time}</Text>
                          )}
                        </View>
                        <View style={[styles.reminderDot, { backgroundColor: med.reminders_enabled ? Colors.good : Colors.border }]} />
                      </View>
                      {idx < medications.length - 1 && <View style={styles.rowDivider} />}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
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
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
