import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

const SECTIONS = [
  {
    title: "1. Acceptance of Terms",
    body: "By downloading, installing, or using LifeMaintained (\"the App\"), you agree to be bound by these Terms of Service. If you do not agree, do not use the App.",
  },
  {
    title: "2. Description of Service",
    body: "LifeMaintained provides tools to track vehicle maintenance, home property maintenance, and health appointments. The App is provided for informational and organizational purposes only and does not constitute professional automotive, home inspection, or medical advice.",
  },
  {
    title: "3. User Accounts",
    body: "You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use of your account. We reserve the right to terminate accounts that violate these terms.",
  },
  {
    title: "4. Subscription & Billing",
    body: "LifeMaintained offers Free and Premium subscription tiers. Premium subscriptions begin with a 14-day free trial. After the trial period, your chosen plan will be billed automatically. You may cancel at any time through account settings. Refunds are not provided for partial billing periods.",
  },
  {
    title: "5. Data & Privacy",
    body: "We collect and store the data you provide within the App. We do not sell your personal data to third parties. Please review our Privacy Policy for full details on data collection, storage, and usage.",
  },
  {
    title: "6. Intellectual Property",
    body: "All content, features, and functionality of the App are owned by LifeMaintained and protected by intellectual property laws. You may not copy, modify, or distribute any part of the App without express written consent.",
  },
  {
    title: "7. Disclaimers",
    body: "The App is provided \"as is\" without warranties of any kind. Maintenance schedules and health screening recommendations are general guidelines only. Always consult qualified professionals for vehicle, home, and medical decisions.",
  },
  {
    title: "8. Limitation of Liability",
    body: "LifeMaintained shall not be liable for any indirect, incidental, or consequential damages arising from your use of the App. Our total liability shall not exceed the amount you paid for the App in the preceding 12 months.",
  },
  {
    title: "9. Changes to Terms",
    body: "We may update these Terms of Service at any time. Continued use of the App after changes constitutes acceptance of the new terms. We will notify you of material changes via the App or email.",
  },
  {
    title: "10. Contact",
    body: "For questions about these Terms of Service, contact us at legal@lifemaintained.app",
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
        <Text style={styles.lastUpdated}>Last updated: January 1, 2026</Text>
        <Text style={styles.intro}>
          Welcome to LifeMaintained. These Terms of Service govern your use of our mobile application and related services.
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
    paddingHorizontal: 16,
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
