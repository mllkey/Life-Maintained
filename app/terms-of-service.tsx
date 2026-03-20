import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

const SECTIONS = [
  {
    title: "1. Acceptance of Terms",
    body: "By downloading, accessing, or using LifeMaintained, you agree to be legally bound by these Terms of Service. If you do not agree to these terms, do not use the service.",
  },
  {
    title: "2. Description of Service",
    body: "LifeMaintained provides digital tools for tracking and managing maintenance across vehicles, property, and health-related appointments. Features may include reminders, recordkeeping, AI-assisted extraction, and reporting.",
  },
  {
    title: "3. User Accounts",
    body: "You are responsible for safeguarding your login credentials and for all activity under your account. One account is intended for one individual user. You must provide accurate account information and promptly update it when necessary.",
  },
  {
    title: "4. Subscription & Billing",
    body: "LifeMaintained offers a free tier and paid subscription tiers. Paid subscriptions are billed through the Apple App Store, may renew automatically unless canceled, and are governed by the billing terms of the relevant app marketplace. You are responsible for managing cancellation through your marketplace account settings.",
  },
  {
    title: "5. User Content and License",
    body: "You retain ownership of the content and data you submit. You grant LifeMaintained a limited, non-exclusive, worldwide license to host, store, reproduce, process, and display your content solely for operating, maintaining, and improving the service.",
  },
  {
    title: "6. Prohibited Uses",
    body: "You agree not to use the service for unlawful activity, abuse, fraud, scraping, automated extraction, unauthorized access, reverse engineering, decompilation, or attempts to interfere with service availability or security.",
  },
  {
    title: "7. Disclaimers",
    body: "The service is provided \"as is\" and \"as available\" without warranties of any kind. Reminders, schedules, and AI outputs are informational only and are not professional automotive, property, legal, or medical advice. You remain responsible for maintenance decisions and outcomes.",
  },
  {
    title: "8. Limitation of Liability",
    body: "To the maximum extent permitted by law, LifeMaintained and its affiliates will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, data, or goodwill arising from your use of the service.",
  },
  {
    title: "9. Termination",
    body: "You may stop using the service and terminate your account at any time. We may suspend or terminate access for violations of these terms, abuse, fraud, or legal or security reasons.",
  },
  {
    title: "10. Changes to Terms",
    body: "We may update these Terms of Service from time to time. Updated terms become effective when posted in the app or website unless otherwise stated. Continued use after the effective date constitutes acceptance.",
  },
  {
    title: "11. Governing Law",
    body: "These Terms of Service are governed by the laws of the State of Illinois, without regard to conflict-of-law principles.",
  },
  {
    title: "12. Contact",
    body: "For questions about these Terms of Service, contact support@lifemaintained.com.",
  },
];

export default function TermsOfServiceScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
      >
        <Text style={styles.lastUpdated}>Effective date: March 2026</Text>
        <Text style={styles.intro}>
          These Terms of Service govern your access to and use of the LifeMaintained application and related services.
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
