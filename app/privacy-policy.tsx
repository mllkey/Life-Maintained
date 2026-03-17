import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

const SECTIONS = [
  {
    title: "Information We Collect",
    body: "We collect information you provide directly: email address, health profile data (date of birth, sex at birth), vehicle details, property details, maintenance records, and appointment information. We also collect usage data to improve the App.",
  },
  {
    title: "How We Use Your Information",
    body: "We use your information to: provide and maintain the App, send maintenance reminders and notifications, generate personalized health screening recommendations based on your age and profile, and improve our services.",
  },
  {
    title: "Data Storage",
    body: "Your data is stored securely using Supabase, a trusted cloud database provider. Data is encrypted in transit and at rest. We retain your data for as long as your account is active, or as needed to provide services.",
  },
  {
    title: "Health Data",
    body: "Health information (date of birth, sex at birth, medications, appointments) is used solely to provide personalized recommendations within the App. We do not share health data with third parties, insurers, or advertisers.",
  },
  {
    title: "Notifications",
    body: "If you enable push notifications, we use Expo's notification service to deliver reminders. You may disable notifications at any time through your device settings or within the App.",
  },
  {
    title: "Third-Party Services",
    body: "We use the following third-party services: Supabase (database), Expo (mobile framework & notifications), Stripe (payment processing for Premium subscriptions). Each service has its own privacy policy governing data use.",
  },
  {
    title: "Data Sharing",
    body: "We do not sell, rent, or trade your personal information. We may share data with service providers who assist in App operations, subject to confidentiality agreements.",
  },
  {
    title: "Your Rights",
    body: "You have the right to access, correct, or delete your personal data. You can delete your account and all associated data from Settings → Account → Delete Account. For data requests, contact privacy@lifemaintained.app.",
  },
  {
    title: "Children's Privacy",
    body: "The App is not intended for children under 13. We do not knowingly collect data from children under 13. If you believe a child has provided personal information, contact us immediately.",
  },
  {
    title: "Changes to This Policy",
    body: "We may update this Privacy Policy periodically. We will notify you of significant changes via the App or email. Continued use after changes constitutes acceptance.",
  },
  {
    title: "Contact Us",
    body: "For privacy questions or data requests, contact us at privacy@lifemaintained.app",
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
        <Text style={styles.lastUpdated}>Last updated: January 1, 2026</Text>
        <Text style={styles.intro}>
          LifeMaintained ("we", "us", or "our") is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your information.
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
