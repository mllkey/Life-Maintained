import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

const SECTIONS = [
  {
    title: "1. Information We Collect",
    body: "We collect the following types of information:\n\nAccount Information: Email address and login details.\n\nUser-Provided Data: Vehicle, property, and maintenance data. Health-related scheduling information. Maintenance logs and records. Uploaded files (receipts, photos, documents). Audio recordings (for transcription features).\n\nDevice & Usage Data: App usage data, device type, and operating system.\n\nDerived Data: AI-generated schedules, insights, and estimates based on your inputs.",
  },
  {
    title: "2. How We Use Information",
    body: "We use your data to provide maintenance tracking and reminders, generate schedules, insights, and estimates, process receipts, images, and voice input, operate subscriptions and billing, improve product performance and reliability, and provide customer support. We do not sell your personal data.",
  },
  {
    title: "3. AI Processing",
    body: "Some features use third-party AI providers to process your data. This may include receipt scanning, voice transcription, and maintenance recommendations. Your data may be transmitted to these providers solely to perform these functions.",
  },
  {
    title: "4. Third-Party Services",
    body: "We use trusted service providers:\n\nSupabase — data storage and infrastructure\nRevenueCat — subscription management\nAnthropic (Claude) — AI processing\nOpenAI (Whisper) — transcription\nGoogle Places API — location and address services\nNHTSA API — vehicle data\n\nThese providers process only the data necessary to provide their services.",
  },
  {
    title: "5. Data Storage and Security",
    body: "Data is stored using Supabase infrastructure, encrypted in transit and at rest. We implement reasonable safeguards to protect your data.",
  },
  {
    title: "6. Data Retention",
    body: "We retain your data until you delete your account. Some data may be retained temporarily in backups or logs for security, fraud prevention, or legal compliance.",
  },
  {
    title: "7. Your Rights",
    body: "You may access your data, update or correct certain information within the app (subject to system constraints designed to maintain data integrity — for example, mileage values may not be reduced once recorded), delete your account and associated data, and request data export where available.",
  },
  {
    title: "8. International Data Transfers",
    body: "Your data may be processed in countries outside your own.",
  },
  {
    title: "9. Children's Privacy",
    body: "The Service is not intended for children under 13.",
  },
  {
    title: "10. Changes to This Policy",
    body: "We may update this policy. Continued use after updates constitutes acceptance.",
  },
  {
    title: "11. Contact",
    body: "support@lifemaintained.com",
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
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginBottom: 16 }}>
            Effective Date: March 22, 2026
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
      >
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
  intro: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 24 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  sectionBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
});
