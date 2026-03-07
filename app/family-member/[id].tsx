import React, { useMemo, useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, format, differenceInYears } from "date-fns";

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
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const [activeTab, setActiveTab] = useState<"appointments" | "medications">("appointments");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isDeletingMemberRef = useRef(false);

  const { data: member, isLoading: loadingMember } = useQuery({
    queryKey: ["family_member", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("family_members")
        .select("*")
        .eq("id", id!)
        .single();
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
        <Text style={styles.headerTitle} numberOfLines={1}>{memberName}</Text>
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
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-appointment"); }}
          >
            <Ionicons name="add" size={20} color={Colors.textInverse} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 40 },
          ]}
        >
          <View style={styles.memberCard}>
            <View style={[styles.memberAvatar, { backgroundColor: Colors.healthMuted }]}>
              <Ionicons name={isPet ? "paw" : "person"} size={28} color={Colors.health} />
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{memberName}</Text>
              <Text style={styles.memberMeta}>
                {memberLabel}
                {memberAge != null ? ` · ${memberAge} yrs` : ""}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: statusColor + "22" }]}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>
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

          {activeTab === "appointments" ? (
            <View style={styles.apptSection}>
              {apptGroups.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="calendar-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyTitle}>No appointments yet</Text>
                  <Text style={styles.emptyText}>Tap + to add an appointment type to track.</Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-appointment"); }}
                  >
                    <Ionicons name="add" size={16} color={Colors.textInverse} />
                    <Text style={styles.emptyBtnText}>Add Appointment</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.apptList}>
                  {apptGroups.map((appt, idx) => {
                    const isExpanded = expandedId === appt.id;
                    const isLast = idx === apptGroups.length - 1;
                    const status = getApptStatus(appt.next_due_date, appt.last_completed_at);
                    const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
                    const lastDoneText = appt.last_completed_at
                      ? `Last done: ${format(parseISO(appt.last_completed_at), "MMM d, yyyy")}`
                      : "Not yet completed";
                    const nextDueText = appt.next_due_date
                      ? `Due: ${format(parseISO(appt.next_due_date), "MMM d, yyyy")}`
                      : null;

                    return (
                      <View key={appt.id} style={styles.apptCard}>
                        <Pressable
                          style={({ pressed }) => [styles.apptCardMain, { opacity: pressed ? 0.85 : 1 }]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setExpandedId(isExpanded ? null : appt.id);
                          }}
                          accessibilityRole="button"
                        >
                          <View style={[styles.apptStatusBar, { backgroundColor: statusColor }]} />
                          <View style={styles.apptCardLeft}>
                            <Text style={styles.apptType}>{appt.appointment_type}</Text>
                            <Text style={styles.apptLastDone}>{lastDoneText}</Text>
                            {appt.provider_name && (
                              <Text style={styles.apptProvider} numberOfLines={1}>{appt.provider_name}</Text>
                            )}
                            {nextDueText && (
                              <Text style={[styles.apptNextDue, { color: statusColor }]}>{nextDueText}</Text>
                            )}
                          </View>
                          <View style={styles.apptCardRight}>
                            <View style={[styles.apptStatusPill, { backgroundColor: statusColor + "22" }]}>
                              <Text style={[styles.apptStatusText, { color: statusColor }]}>
                                {status === "overdue" ? "Overdue" : status === "due_soon" ? "Due soon" : "Current"}
                              </Text>
                            </View>
                            <Ionicons
                              name={isExpanded ? "chevron-up" : "chevron-down"}
                              size={15}
                              color={Colors.textTertiary}
                            />
                          </View>
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

                        {!isLast && <View style={styles.apptDivider} />}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.medSection}>
              {!medications || medications.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="medical-outline" size={36} color={Colors.textTertiary} />
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
                <View style={styles.medList}>
                  {medications.map((med, idx) => (
                    <View key={med.id} style={styles.medCard}>
                      <View style={[styles.medIcon, { backgroundColor: Colors.healthMuted }]}>
                        <Ionicons name="medical-outline" size={18} color={Colors.health} />
                      </View>
                      <View style={styles.medInfo}>
                        <Text style={styles.medName}>{med.name}</Text>
                        {med.reminder_time && (
                          <Text style={styles.medMeta}>Daily · {med.reminder_time}</Text>
                        )}
                      </View>
                      <View style={[styles.reminderDot, { backgroundColor: med.reminders_enabled ? Colors.good : Colors.border }]} />
                    </View>
                  ))}
                </View>
              )}
            </View>
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
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  backBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    textAlign: "center",
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  deleteMemberBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.overdueMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  addApptBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.health,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14,
  },
  memberAvatar: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  memberInfo: { flex: 1, gap: 4 },
  memberName: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
  memberMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textTransform: "capitalize" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  summaryBar: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 16,
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
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: Colors.healthMuted },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.health, fontFamily: "Inter_600SemiBold" },

  apptSection: { gap: 0 },
  apptList: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  apptCard: { backgroundColor: Colors.card },
  apptCardMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingRight: 16,
    minHeight: 64,
    gap: 12,
  },
  apptStatusBar: { width: 3, alignSelf: "stretch", borderRadius: 2, minHeight: 44, flexShrink: 0 },
  apptCardLeft: { flex: 1, gap: 3 },
  apptType: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 21 },
  apptLastDone: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  apptProvider: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  apptNextDue: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  apptCardRight: { alignItems: "flex-end", gap: 6, flexShrink: 0, paddingTop: 2 },
  apptStatusPill: {
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  apptStatusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  apptDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },

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
    borderRadius: 9,
    backgroundColor: Colors.overdueMuted,
    minHeight: 44,
    justifyContent: "center",
  },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue },

  emptyState: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.health,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 4,
  },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  medSection: { gap: 0 },
  medList: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  medCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  medIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  medInfo: { flex: 1, gap: 3 },
  medName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  medMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  reminderDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
});
