import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

const SECTIONS = [
  {
    title: "1. Use of Service",
    body: "LifeMaintained provides tools for tracking and managing maintenance across vehicles, property, and personal health-related activities. Features may include reminders, recordkeeping, cost estimates, and AI-assisted insights.",
  },
  {
    title: "2. No Professional Advice",
    body: "The Service is for informational purposes only. It does not provide professional automotive, mechanical, construction, financial, or medical advice. You are solely responsible for verifying any recommendations and for all maintenance decisions.",
  },
  {
    title: "3. AI-Generated Content",
    body: "Some features use artificial intelligence to generate schedules, recommendations, and cost estimates. AI outputs may be incomplete, inaccurate, or outdated. Outputs may not reflect manufacturer specifications or real-world conditions. You must independently verify all information before relying on it. You assume all risk associated with reliance on AI-generated outputs.",
  },
  {
    title: "4. User Responsibilities",
    body: "You agree to provide accurate information, maintain your assets responsibly, and use the Service in compliance with applicable laws. You remain fully responsible for maintenance outcomes, safety, and costs.",
  },
  {
    title: "5. Accounts",
    body: "You are responsible for safeguarding your account credentials and all activity under your account.",
  },
  {
    title: "6. Subscriptions and Billing",
    body: "Subscriptions are billed through the Apple App Store. Pricing is presented before purchase. Subscriptions renew automatically unless canceled. You can manage or cancel subscriptions through your Apple account. Refunds are handled by Apple, not LifeMaintained.",
  },
  {
    title: "7. User Content",
    body: "You retain ownership of content you submit. You grant LifeMaintained a limited license to use it solely to operate, maintain, and improve the Service.",
  },
  {
    title: "8. Prohibited Use",
    body: "You may not use the Service for unlawful activity, attempt to reverse engineer or disrupt the Service, or access or scrape data without authorization.",
  },
  {
    title: "9. Limitation of Liability",
    body: "To the maximum extent permitted by law, LifeMaintained is not liable for indirect, incidental, or consequential damages. This includes damages resulting from missed maintenance, incorrect schedules, or inaccurate estimates. Total liability is limited to the amount you paid for the Service in the past 12 months.",
  },
  {
    title: "10. Indemnification",
    body: "You agree to indemnify and hold harmless LifeMaintained from any claims arising from your use of the Service, violation of these Terms, or reliance on Service outputs.",
  },
  {
    title: "11. Dispute Resolution",
    body: "Any dispute arising from or relating to these Terms or the Service shall be resolved through binding individual arbitration administered under the rules of the American Arbitration Association, except where prohibited by law. You agree to waive any right to participate in a class action lawsuit or class-wide arbitration. Either party may bring claims in small claims court as an alternative to arbitration. This section does not prevent you from bringing issues to the attention of government agencies.",
  },
  {
    title: "12. Termination",
    body: "We may suspend or terminate access for violations, abuse, or legal reasons. You may stop using the Service at any time.",
  },
  {
    title: "13. Changes to Terms",
    body: "We may update these Terms. Continued use after updates constitutes acceptance.",
  },
  {
    title: "14. Governing Law",
    body: "These Terms are governed by the laws of the State of Illinois.",
  },
  {
    title: "15. Contact",
    body: "support@lifemaintained.com",
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
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Terms of Service</Text>
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
  intro: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 24 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  sectionBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
});
