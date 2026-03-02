import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await signOut();
          router.replace("/(auth)");
        },
      },
    ]);
  }

  async function handleDeleteAccount() {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all data including vehicles, properties, health records, and service history. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Forever",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Are you absolutely sure?",
              "Type DELETE in the next step to confirm.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, Delete My Account",
                  style: "destructive",
                  onPress: async () => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                    if (!user) return;
                    const { error } = await supabase.rpc("delete_user_account", { user_id: user.id }).maybeSingle();
                    if (error) {
                      await supabase.auth.signOut();
                      queryClient.clear();
                      router.replace("/(auth)");
                    } else {
                      await supabase.auth.signOut();
                      queryClient.clear();
                      router.replace("/(auth)");
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  const isPremium = profile?.subscription_tier === "premium";

  const sections = [
    {
      title: "Account",
      items: [
        {
          icon: "person-circle-outline",
          label: "Health Profile",
          sublabel: "Date of birth, sex at birth",
          color: Colors.health,
          onPress: () => router.push("/health-profile" as any),
        },
        {
          icon: "notifications-outline",
          label: "Notifications",
          sublabel: "Push, quiet hours, advance warnings",
          color: Colors.blue,
          onPress: () => router.push("/notifications-settings" as any),
        },
      ],
    },
    {
      title: "Subscription",
      items: [
        {
          icon: "star-outline",
          label: isPremium ? "Premium Plan" : "Upgrade to Premium",
          sublabel: isPremium ? "Unlimited tracking — manage subscription" : "Unlimited vehicles, properties & health items",
          color: Colors.vehicle,
          onPress: () => router.push("/subscription" as any),
        },
      ],
    },
    {
      title: "Legal",
      items: [
        {
          icon: "document-text-outline",
          label: "Terms of Service",
          sublabel: null,
          color: Colors.textTertiary,
          onPress: () => router.push("/terms-of-service" as any),
        },
        {
          icon: "shield-outline",
          label: "Privacy Policy",
          sublabel: null,
          color: Colors.textTertiary,
          onPress: () => router.push("/privacy-policy" as any),
        },
      ],
    },
    {
      title: "Account Actions",
      items: [
        {
          icon: "log-out-outline",
          label: "Sign Out",
          sublabel: null,
          color: Colors.overdue,
          onPress: handleSignOut,
          destructive: true,
        },
        {
          icon: "trash-outline",
          label: "Delete Account",
          sublabel: "Permanently delete all data",
          color: Colors.overdue,
          onPress: handleDeleteAccount,
          destructive: true,
        },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}
      >
        <View style={styles.userCard}>
          <View style={styles.userAvatar}>
            <Ionicons name="person" size={28} color={Colors.accent} />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userEmail}>{user?.email}</Text>
            <Text style={styles.userTier}>{isPremium ? "Premium Plan" : "Free Plan"}</Text>
          </View>
          <View style={[styles.tierBadge, isPremium ? styles.tierBadgePremium : styles.tierBadgeFree]}>
            {isPremium && <Ionicons name="star" size={12} color={Colors.vehicle} />}
            <Text style={[styles.tierBadgeText, isPremium ? { color: Colors.vehicle } : { color: Colors.textTertiary }]}>
              {isPremium ? "Premium" : "Free"}
            </Text>
          </View>
        </View>

        <View style={styles.emailNote}>
          <Ionicons name="mail-outline" size={16} color={Colors.blue} />
          <Text style={styles.emailNoteText}>
            Maintenance reminders and account emails are sent from{" "}
            <Text style={styles.emailNoteEmail}>noreply@lifemaintained.app</Text>
            {". "}Add it to your contacts so they don't go to spam.
          </Text>
        </View>

        {sections.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionItems}>
              {section.items.map((item, i) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [
                    styles.settingItem,
                    i === 0 && styles.settingItemFirst,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => { Haptics.selectionAsync(); item.onPress(); }}
                >
                  <View style={[styles.settingIcon, { backgroundColor: item.color + "18" }]}>
                    <Ionicons name={item.icon as any} size={18} color={item.color} />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={[styles.settingLabel, (item as any).destructive && { color: Colors.overdue }]}>
                      {item.label}
                    </Text>
                    {item.sublabel && <Text style={styles.settingSubLabel}>{item.sublabel}</Text>}
                  </View>
                  {!(item as any).destructive && (
                    <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.version}>LifeMaintained v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 20 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  userAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.accentMuted,
  },
  userInfo: { flex: 1 },
  userEmail: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  userTier: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 4 },
  tierBadgePremium: { backgroundColor: Colors.vehicleMuted },
  tierBadgeFree: { backgroundColor: Colors.surface },
  tierBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  emailNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.blueMuted,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.blue + "33",
  },
  emailNoteText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 20 },
  emailNoteEmail: { fontFamily: "Inter_500Medium", color: Colors.blue },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 4 },
  sectionItems: { backgroundColor: Colors.card, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: Colors.border },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  settingItemFirst: { borderTopWidth: 0 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  settingContent: { flex: 1 },
  settingLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  settingSubLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  version: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", paddingVertical: 8 },
});
