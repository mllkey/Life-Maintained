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
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
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

  const sections = [
    {
      title: "Account",
      items: [
        {
          icon: "person-circle-outline",
          label: "Health Profile",
          sublabel: "Date of birth, sex at birth",
          color: Colors.health,
          onPress: () => router.push("/health-profile"),
        },
        {
          icon: "notifications-outline",
          label: "Notifications",
          sublabel: "Push, quiet hours, advance warnings",
          color: Colors.blue,
          onPress: () => {},
        },
      ],
    },
    {
      title: "Subscription",
      items: [
        {
          icon: "star-outline",
          label: profile?.subscription_tier === "premium" ? "Premium Plan" : "Upgrade to Premium",
          sublabel: profile?.subscription_tier === "premium" ? "Unlimited tracking" : "Unlimited vehicles, properties & health items",
          color: Colors.vehicle,
          onPress: () => {},
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
          onPress: () => {},
        },
        {
          icon: "shield-outline",
          label: "Privacy Policy",
          sublabel: null,
          color: Colors.textTertiary,
          onPress: () => {},
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
            <Text style={styles.userTier}>{profile?.subscription_tier === "premium" ? "Premium" : "Free Plan"}</Text>
          </View>
          <View style={[styles.tierBadge, profile?.subscription_tier === "premium" ? styles.tierBadgePremium : styles.tierBadgeFree]}>
            {profile?.subscription_tier === "premium" ? (
              <Ionicons name="star" size={12} color={Colors.vehicle} />
            ) : null}
            <Text style={[styles.tierBadgeText, profile?.subscription_tier === "premium" ? { color: Colors.vehicle } : { color: Colors.textTertiary }]}>
              {profile?.subscription_tier === "premium" ? "Premium" : "Free"}
            </Text>
          </View>
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
                    i === section.items.length - 1 && styles.settingItemLast,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={item.onPress}
                >
                  <View style={[styles.settingIcon, { backgroundColor: item.color + "18" }]}>
                    <Ionicons name={item.icon as any} size={18} color={item.color} />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={[styles.settingLabel, (item as any).destructive && { color: Colors.overdue }]}>{item.label}</Text>
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
  tierBadgeFree: { backgroundColor: Colors.card },
  tierBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
  settingItemLast: {},
  settingIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  settingContent: { flex: 1 },
  settingLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  settingSubLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  version: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", paddingVertical: 8 },
});
