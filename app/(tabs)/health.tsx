import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, format } from "date-fns";

type Tab = "appointments" | "medications" | "family";

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
  const [activeTab, setActiveTab] = useState<Tab>("appointments");
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: appointments, isLoading: loadingAppts, refetch: refetchAppts } = useQuery({
    queryKey: ["health_appointments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("health_appointments").select("*, family_members(name, relationship)").eq("user_id", user.id).order("next_due_date", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: medications, isLoading: loadingMeds, refetch: refetchMeds } = useQuery({
    queryKey: ["medications", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("medications").select("*, family_members(name)").eq("user_id", user.id).order("name");
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: familyMembers, isLoading: loadingFamily, refetch: refetchFamily } = useQuery({
    queryKey: ["family_members", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("family_members").select("*").eq("user_id", user.id).order("name");
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

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "appointments", label: "Appointments", icon: "calendar-outline" },
    { key: "medications", label: "Medications", icon: "medical-outline" },
    { key: "family", label: "Family", icon: "people-outline" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Health</Text>
        <Pressable
          style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (activeTab === "appointments") router.push("/add-appointment");
            else if (activeTab === "medications") router.push("/add-medication");
            else router.push("/add-family-member");
          }}
        >
          <Ionicons name="add" size={22} color={Colors.textInverse} />
        </Pressable>
      </View>

      <View style={styles.tabBar}>
        {tabs.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(t.key);
            }}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}
      >
        {isLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : activeTab === "appointments" ? (
          appointments?.length === 0 ? <EmptyState icon="calendar-outline" title="No appointments yet" text="Add your health appointments to track when they're due." onAdd={() => router.push("/add-appointment")} addLabel="Add Appointment" /> :
          appointments?.map(a => {
            const status = getStatus(a.next_due_date);
            const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
            const member = (a as any).family_members;
            return (
              <Pressable
                key={a.id}
                style={({ pressed }) => [styles.card, { borderLeftColor: statusColor, opacity: pressed ? 0.88 : 1 }]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.cardIcon, { backgroundColor: Colors.healthMuted }]}>
                    <Ionicons name="heart-outline" size={20} color={Colors.health} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{a.appointment_type}</Text>
                    {member && <Text style={styles.cardMeta}>{member.name}</Text>}
                    {a.provider_name && <Text style={styles.cardMeta}>{a.provider_name}</Text>}
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: statusColor + "22" }]}>
                    <Text style={[styles.statusPillText, { color: statusColor }]}>
                      {a.next_due_date ? format(parseISO(a.next_due_date), "MMM d, yyyy") : "No date"}
                    </Text>
                  </View>
                </View>
                {a.interval_months && (
                  <Text style={styles.cardDetail}>Every {a.interval_months} months</Text>
                )}
              </Pressable>
            );
          })
        ) : activeTab === "medications" ? (
          medications?.length === 0 ? <EmptyState icon="medical-outline" title="No medications" text="Add medications to track daily reminders." onAdd={() => router.push("/add-medication")} addLabel="Add Medication" /> :
          medications?.map(m => (
            <View key={m.id} style={styles.medCard}>
              <View style={[styles.medIcon, { backgroundColor: Colors.healthMuted }]}>
                <Ionicons name="medical-outline" size={20} color={Colors.health} />
              </View>
              <View style={styles.medInfo}>
                <Text style={styles.medName}>{m.name}</Text>
                {(m as any).family_members && <Text style={styles.medMeta}>For {(m as any).family_members.name}</Text>}
                {m.reminder_time && <Text style={styles.medMeta}>Daily at {m.reminder_time}</Text>}
              </View>
              <View style={[styles.reminderDot, { backgroundColor: m.reminders_enabled ? Colors.good : Colors.textTertiary }]} />
            </View>
          ))
        ) : (
          familyMembers?.length === 0 ? <EmptyState icon="people-outline" title="No family members" text="Add family members and pets to track their health separately." onAdd={() => router.push("/add-family-member")} addLabel="Add Member" /> :
          familyMembers?.map(fm => (
            <View key={fm.id} style={styles.familyCard}>
              <View style={[styles.familyIcon, { backgroundColor: Colors.healthMuted }]}>
                <Ionicons name={fm.member_type === "pet" ? "paw-outline" : "person-outline"} size={20} color={Colors.health} />
              </View>
              <View style={styles.familyInfo}>
                <Text style={styles.familyName}>{fm.name}</Text>
                <Text style={styles.familyMeta}>
                  {fm.relationship ?? fm.pet_type ?? fm.member_type ?? ""}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.addApptBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push("/add-appointment")}
              >
                <Ionicons name="calendar-outline" size={16} color={Colors.health} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EmptyState({ icon, title, text, onAdd, addLabel }: { icon: any; title: string; text: string; onAdd: () => void; addLabel: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={40} color={Colors.health} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
      <Pressable style={({ pressed }) => [styles.emptyButton, { opacity: pressed ? 0.85 : 1 }]} onPress={onAdd}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.emptyButtonText}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  addButton: { width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.health, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", marginHorizontal: 16, gap: 8, marginBottom: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card },
  tabActive: { backgroundColor: Colors.healthMuted },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.health, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  card: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  cardMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusPillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  cardDetail: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, paddingLeft: 50 },
  medCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  medIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  medInfo: { flex: 1 },
  medName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  medMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  reminderDot: { width: 10, height: 10, borderRadius: 5 },
  familyCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  familyIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  familyInfo: { flex: 1 },
  familyName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  familyMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textTransform: "capitalize" },
  addApptBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.healthMuted, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 32, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: Colors.healthMuted, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  emptyButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.health, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyButtonText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
