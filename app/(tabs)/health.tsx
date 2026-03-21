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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { parseISO, isBefore, addDays, format } from "date-fns";
import { isFreeTier } from "@/lib/subscription";


async function scheduleMedicationNotification(medName: string, reminderTime: string): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return false;
  const [hourStr, minuteStr] = reminderTime.split(":");
  const hour = parseInt(hourStr ?? "8");
  const minute = parseInt(minuteStr ?? "0");
  if (isNaN(hour) || isNaN(minute)) return false;
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: { title: "Medication Reminder", body: `Time to take your ${medName}`, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });
  return true;
}

function getStatus(date: string | null) {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const [schedulingMed, setSchedulingMed] = useState<string | null>(null);

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
      const success = await scheduleMedicationNotification(med.name, med.reminder_time);
      if (success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Reminder Set", `You'll be reminded to take ${med.name} daily at ${med.reminder_time}.`);
      } else {
        Alert.alert("Permission Required", "Please enable notifications in Settings to receive medication reminders.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSchedulingMed(null);
    }
  }

  const people = useMemo(() => familyMembers?.filter(fm => fm.member_type !== "pet") ?? [], [familyMembers]);
  const pets = useMemo(() => familyMembers?.filter(fm => fm.member_type === "pet") ?? [], [familyMembers]);

  const apptStatusByMember = useMemo(() => {
    const map: Record<string, { overdue: number; upcoming: number }> = {};
    for (const a of appointments ?? []) {
      if (a.family_member_id) {
        if (!map[a.family_member_id]) map[a.family_member_id] = { overdue: 0, upcoming: 0 };
        const s = getStatus(a.next_due_date);
        if (s === "overdue") map[a.family_member_id].overdue++;
        else if (s === "due_soon") map[a.family_member_id].upcoming++;
      }
    }
    return map;
  }, [appointments]);

  const hasNoMembers = !familyMembers?.length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Health</Text>
        <Pressable
          style={({ pressed }) => [{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            backgroundColor: "#E8943A",
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
            opacity: pressed ? 0.85 : 1,
          }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/add-appointment");
          }}
          accessibilityLabel="Add health item"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={18} color="#0C111B" />
          <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#0C111B" }}>Appointment</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0), flexGrow: 1 }]}
      >
        {isLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {hasNoMembers ? (
              <EmptyMembers />
            ) : (
              <>
                {people.length > 0 && (
                  <SectionBlock
                    title="Family Members"
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
                  >
                    <View style={styles.memberGrid}>
                      {people.map((person, personIdx) => {
                        const memberLimit = isFreeTier(profile) ? 1 : Infinity;
                        const isLocked = personIdx >= memberLimit;
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
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
                  >
                    <View style={styles.memberGrid}>
                      {pets.map((pet, petIdx) => {
                        const memberLimit = isFreeTier(profile) ? 1 : Infinity;
                        const combinedIdx = people.length + petIdx;
                        const isLocked = combinedIdx >= memberLimit;
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

                {appointments && appointments.length > 0 && (
                  <SectionBlock
                    title="Appointments"
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-appointment"); }}
                  >
                    <View style={styles.apptList}>
                      {appointments.map(a => {
                        const status = getStatus(a.next_due_date);
                        const barColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
                        const member = (a as any).family_members;
                        const subParts: string[] = [];
                        if (member?.name) subParts.push(member.name);
                        if (a.provider_name) subParts.push(a.provider_name);
                        if (a.next_due_date) subParts.push(format(parseISO(a.next_due_date), "MMM d, yyyy"));
                        return (
                          <View key={a.id} style={styles.apptCard}>
                            <View style={[styles.apptBar, { backgroundColor: barColor }]} />
                            <View style={styles.apptInfo}>
                              <Text style={styles.apptType}>{a.appointment_type}</Text>
                              {subParts.length > 0 && (
                                <Text style={styles.apptMeta} numberOfLines={1}>{subParts.join(" · ")}</Text>
                              )}
                            </View>
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
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionBlock({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{title}</Text>
        <Pressable
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          onPress={onAdd}
          hitSlop={8}
        >
          <Ionicons name="add" size={18} color={Colors.textTertiary} />
        </Pressable>
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

function EmptyMembers() {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>No family members yet</Text>
      <Text style={styles.emptyText}>Add a person or pet to start tracking health</Text>
    </View>
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
  addBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#fff" },

  content: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },

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

  emptyWrap: { paddingTop: 60, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.accent },
});
