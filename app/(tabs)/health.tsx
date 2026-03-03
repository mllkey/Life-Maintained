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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowList: true,
  }),
});

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
  const { user } = useAuth();
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

  const apptCountByMember = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of appointments ?? []) {
      if (a.family_member_id) {
        map[a.family_member_id] = (map[a.family_member_id] ?? 0) + 1;
      }
    }
    return map;
  }, [appointments]);

  const upcomingCount = useMemo(() => {
    if (!appointments) return 0;
    const cutoff = addDays(new Date(), 90);
    return appointments.filter(a => {
      if (!a.next_due_date) return false;
      const d = parseISO(a.next_due_date);
      return d <= cutoff;
    }).length;
  }, [appointments]);

  const estimatedAnnualCost = useMemo(() => {
    if (!appointments?.length) return null;
    let total = 0;
    let hasData = false;
    for (const appt of appointments) {
      if (appt.interval_months && appt.interval_months > 0) {
        const timesPerYear = 12 / appt.interval_months;
        total += timesPerYear * 150;
        hasData = true;
      }
    }
    return hasData ? Math.round(total) : null;
  }, [appointments]);

  const hasNoMembers = !familyMembers?.length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Health</Text>
          <Text style={styles.subtitle}>Family health tracker</Text>
        </View>
        <View style={styles.headerRight}>
          {people.length > 0 && (
            <View style={styles.countBadge}>
              <Ionicons name="person-outline" size={12} color={Colors.health} />
              <Text style={styles.countBadgeText}>{people.length}</Text>
            </View>
          )}
          {pets.length > 0 && (
            <View style={styles.countBadge}>
              <Ionicons name="paw-outline" size={12} color={Colors.health} />
              <Text style={styles.countBadgeText}>{pets.length}</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-appointment"); }}
          >
            <Ionicons name="add" size={20} color={Colors.textInverse} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}
      >
        {isLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.overviewRow}>
              <View style={[styles.overviewCard, styles.overviewCardTall]}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="calendar-outline" size={18} color={Colors.health} />
                </View>
                <Text style={styles.overviewNumber}>{upcomingCount}</Text>
                <Text style={styles.overviewLabel}>Upcoming</Text>
              </View>

              <View style={[styles.overviewCard, styles.overviewCardTall]}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="wallet-outline" size={18} color={Colors.health} />
                </View>
                {estimatedAnnualCost != null ? (
                  <>
                    <Text style={styles.overviewNumber}>${estimatedAnnualCost >= 1000 ? `${Math.round(estimatedAnnualCost / 100) / 10}k` : estimatedAnnualCost}</Text>
                    <Text style={styles.overviewLabel}>Est./year</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.overviewNumber}>$0</Text>
                    <Text style={styles.overviewLabel}>Est./year</Text>
                  </>
                )}
              </View>

              <View style={[styles.overviewCard, styles.overviewCardTall, styles.quickActionsCard]}>
                <Pressable
                  style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
                >
                  <Ionicons name="person-add-outline" size={14} color={Colors.health} />
                  <Text style={styles.quickActionText}>Add Person</Text>
                </Pressable>
                <View style={styles.quickDivider} />
                <Pressable
                  style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
                >
                  <Ionicons name="paw-outline" size={14} color={Colors.health} />
                  <Text style={styles.quickActionText}>Add Pet</Text>
                </Pressable>
              </View>
            </View>

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
                      {people.map(person => (
                        <MemberCard
                          key={person.id}
                          member={person}
                          apptCount={apptCountByMember[person.id] ?? 0}
                          onAddAppt={() => router.push("/add-appointment")}
                        />
                      ))}
                    </View>
                  </SectionBlock>
                )}

                {pets.length > 0 && (
                  <SectionBlock
                    title="Pets"
                    onAdd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
                  >
                    <View style={styles.memberGrid}>
                      {pets.map(pet => (
                        <MemberCard
                          key={pet.id}
                          member={pet}
                          apptCount={apptCountByMember[pet.id] ?? 0}
                          onAddAppt={() => router.push("/add-appointment")}
                        />
                      ))}
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
                        const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
                        const member = (a as any).family_members;
                        return (
                          <View key={a.id} style={[styles.apptCard, { borderLeftColor: statusColor }]}>
                            <View style={styles.apptTop}>
                              <View style={[styles.apptIcon, { backgroundColor: Colors.healthMuted }]}>
                                <Ionicons name="heart-outline" size={16} color={Colors.health} />
                              </View>
                              <View style={styles.apptInfo}>
                                <Text style={styles.apptType}>{a.appointment_type}</Text>
                                {member && <Text style={styles.apptMeta}>{member.name}</Text>}
                                {a.provider_name && <Text style={styles.apptMeta}>{a.provider_name}</Text>}
                              </View>
                              <View style={[styles.apptDatePill, { backgroundColor: statusColor + "22" }]}>
                                <Text style={[styles.apptDateText, { color: statusColor }]}>
                                  {a.next_due_date ? format(parseISO(a.next_due_date), "MMM d") : "No date"}
                                </Text>
                              </View>
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
                      {medications.map(m => (
                        <View key={m.id} style={styles.medCard}>
                          <View style={[styles.medIconWrap, { backgroundColor: Colors.healthMuted }]}>
                            <Ionicons name="medical-outline" size={18} color={Colors.health} />
                          </View>
                          <View style={styles.medInfo}>
                            <Text style={styles.medName}>{m.name}</Text>
                            <View style={styles.medMeta}>
                              {(m as any).family_members && (
                                <Text style={styles.medMetaText}>{(m as any).family_members.name}</Text>
                              )}
                              {m.reminder_time && (
                                <Text style={styles.medMetaText}>Daily · {m.reminder_time}</Text>
                              )}
                            </View>
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
                      ))}
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
        <Text style={styles.sectionTitle}>{title}</Text>
        <Pressable
          style={({ pressed }) => [styles.sectionAddBtn, { opacity: pressed ? 0.7 : 1 }]}
          onPress={onAdd}
        >
          <Ionicons name="add" size={16} color={Colors.health} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function MemberCard({ member, apptCount, onAddAppt }: { member: any; apptCount: number; onAddAppt: () => void }) {
  const isPet = member.member_type === "pet";
  const label = isPet
    ? (member.pet_type ?? "Pet")
    : (member.relationship ?? member.member_type ?? "Person");

  return (
    <Pressable
      style={({ pressed }) => [styles.memberCard, { opacity: pressed ? 0.88 : 1 }]}
      onPress={onAddAppt}
    >
      <View style={styles.memberCardTop}>
        <View style={[styles.memberIconWrap, { backgroundColor: Colors.healthMuted }]}>
          <Ionicons name={isPet ? "paw-outline" : "person-outline"} size={22} color={Colors.health} />
        </View>
        <Pressable
          style={({ pressed }) => [styles.memberApptBtn, { opacity: pressed ? 0.7 : 1 }]}
          onPress={onAddAppt}
          hitSlop={4}
        >
          <Ionicons name="add" size={14} color={Colors.health} />
        </Pressable>
      </View>
      <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
      <Text style={styles.memberType} numberOfLines={1}>{label}</Text>
      <Text style={styles.memberApptCount}>
        {apptCount === 0 ? "No appointments" : `${apptCount} appointment${apptCount !== 1 ? "s" : ""}`}
      </Text>
    </Pressable>
  );
}

function EmptyMembers() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="people-outline" size={36} color={Colors.health} />
        </View>
        <Text style={styles.emptyTitle}>Track family health</Text>
        <Text style={styles.emptyText}>Add family members and pets to track appointments, medications, and more.</Text>
        <View style={styles.emptyActions}>
          <Pressable
            style={({ pressed }) => [styles.emptyBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
          >
            <Ionicons name="person-add-outline" size={18} color={Colors.textInverse} />
            <Text style={styles.emptyBtnText}>Add Person</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.emptyBtnSecondary, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-family-member"); }}
          >
            <Ionicons name="paw-outline" size={18} color={Colors.health} />
            <Text style={styles.emptyBtnSecondaryText}>Add Pet</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: Colors.background,
  },
  headerLeft: { gap: 2 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.healthMuted,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  countBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.health },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.health,
    alignItems: "center",
    justifyContent: "center",
  },

  content: { paddingHorizontal: 16, paddingTop: 8, gap: 20 },

  overviewRow: { flexDirection: "row", gap: 8 },
  overviewCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  overviewCardTall: { minHeight: 120, justifyContent: "center" },
  overviewIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.healthMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  overviewNumber: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  overviewDash: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.textTertiary },
  overviewLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  quickActionsCard: { gap: 0, justifyContent: "space-between" },
  quickActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  quickActionText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.health },
  quickDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: -12 },

  sectionBlock: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  sectionAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.healthMuted,
    alignItems: "center",
    justifyContent: "center",
  },

  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  memberCard: {
    width: "48%",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
    minHeight: 130,
  },
  memberCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  memberIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  memberApptBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: Colors.healthMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  memberName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  memberType: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textTransform: "capitalize" },
  memberApptCount: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 },

  apptList: { gap: 8 },
  apptCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
  },
  apptTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  apptIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  apptInfo: { flex: 1 },
  apptType: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  apptMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  apptDatePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  apptDateText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

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
  medIconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  medInfo: { flex: 1, gap: 3 },
  medName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  medMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  medMetaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  medRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  reminderDot: { width: 8, height: 8, borderRadius: 4 },
  notifBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.healthMuted,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyWrap: { paddingTop: 8 },
  emptyCard: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.health + "55",
    borderRadius: 20,
    backgroundColor: Colors.card,
    marginHorizontal: 4,
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.healthMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 21 },
  emptyActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.health,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
    minHeight: 44,
  },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  emptyBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.healthMuted,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
    minHeight: 44,
  },
  emptyBtnSecondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.health },
});
