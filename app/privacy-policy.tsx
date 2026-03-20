import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

const SECTIONS = [
  {
    title: "Information We Collect",
    body: "We collect information you provide directly to LifeMaintained, including account details, vehicle information, property information, health appointments, maintenance logs, receipt photos, and voice recordings submitted for transcription. We may also process location-related data when you use property lookup or address assistance features.",
  },
  {
    title: "Storage and Security",
    body: "Your data is stored in our cloud infrastructure through Supabase. Data is encrypted in transit and encrypted at rest. We implement reasonable administrative, technical, and organizational safeguards designed to protect your information.",
  },
  {
    title: "Third-Party Services",
    body: "To operate core features, we use third-party service providers including Supabase (data platform), RevenueCat (subscription management), OpenAI Whisper (voice transcription), Anthropic Claude (receipt scanning and AI-assisted features), and Expo (push notifications and mobile infrastructure). These providers process data only as needed to provide services to us.",
  },
  {
    title: "How We Use Data",
    body: "We use your data to provide maintenance tracking, reminders, receipt and voice processing, account administration, support, analytics, and product improvements. We do not use your data for sale to data brokers or third-party advertising networks.",
  },
  {
    title: "Data Retention",
    body: "We retain your data until you delete your account, unless a longer retention period is required by law, regulation, or a valid legal process.",
  },
  {
    title: "Data Sharing and Sale",
    body: "We do not sell your personal data to third parties. We may share data with service providers that support the operation of the app, subject to contractual confidentiality and data protection obligations.",
  },
  {
    title: "Your Rights",
    body: "You may request access to your data, request correction of inaccurate data, delete your account and associated data, and export your data where available. You can delete your account from in-app settings.",
  },
  {
    title: "Children's Privacy",
    body: "LifeMaintained is not directed to children under the age of 13, and we do not knowingly collect personal information from children under 13.",
  },
  {
    title: "Changes to This Policy",
    body: "We may update this Privacy Policy from time to time. We will post updates in the app or by other reasonable means. Your continued use of the service after an update becomes effective constitutes acceptance of the revised policy.",
  },
  {
    title: "Contact Us",
    body: "For privacy questions, requests, or complaints, contact us at support@lifemaintained.com.",
  },
];

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
      >
        <Text style={styles.lastUpdated}>Effective date: March 2026</Text>
        <Text style={styles.intro}>
          This Privacy Policy describes how LifeMaintained ("LifeMaintained," "we," "us," or "our") collects, uses, stores, and discloses personal information when you use our mobile application and related services.
        </Text>

        {SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 20 },
  lastUpdated: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  intro: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 24 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  sectionBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
});
