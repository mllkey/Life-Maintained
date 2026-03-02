import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseISO, differenceInDays, format } from "date-fns";

const FREE_FEATURES = [
  "Up to 2 vehicles",
  "Up to 2 properties",
  "Basic health appointment tracking",
  "Maintenance reminders",
  "Service history (last 10 records)",
];

const PREMIUM_FEATURES = [
  "Unlimited vehicles & properties",
  "Unlimited family members",
  "Receipt scanning & OCR",
  "Export to PDF & CSV",
  "Budget alerts",
  "Advanced notification controls",
  "Full service history",
  "Priority support",
];

const PROMO_CODES: Record<string, string> = {
  LAUNCH50: "50% off first 3 months",
  WELCOME: "30-day free trial extension",
  ANNUAL20: "20% off annual plan",
};

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "annual">("annual");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  const isPremium = profile?.subscription_tier === "premium";
  const trialDaysLeft = profile?.trial_end_date
    ? differenceInDays(parseISO(profile.trial_end_date), new Date())
    : null;
  const isInTrial = trialDaysLeft !== null && trialDaysLeft > 0;

  function applyPromoCode() {
    const upper = promoCode.toUpperCase().trim();
    if (PROMO_CODES[upper]) {
      setPromoApplied(PROMO_CODES[upper]);
      setPromoError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setPromoError("Invalid promo code");
      setPromoApplied(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleUpgrade() {
    if (!user) return;
    setIsUpgrading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const { error } = await supabase
      .from("profiles")
      .update({
        subscription_tier: "premium",
        trial_end_date: trialEnd.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    setIsUpgrading(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      Alert.alert(
        "Welcome to Premium!",
        "Your 14-day free trial has started. Enjoy unlimited access to all features.",
        [{ text: "Get Started", onPress: () => router.back() }]
      );
    }
  }

  async function handleManageSubscription() {
    Alert.alert(
      "Manage Subscription",
      "To cancel or modify your subscription, please contact support@lifemaintained.app",
      [{ text: "OK" }]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
      >
        {isInTrial && (
          <View style={styles.trialBanner}>
            <Ionicons name="time-outline" size={18} color={Colors.dueSoon} />
            <View style={styles.trialBannerText}>
              <Text style={styles.trialBannerTitle}>Trial Active</Text>
              <Text style={styles.trialBannerSub}>
                {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining — expires{" "}
                {format(parseISO(profile!.trial_end_date), "MMM d, yyyy")}
              </Text>
            </View>
          </View>
        )}

        {isPremium && !isInTrial ? (
          <View style={styles.premiumActiveCard}>
            <View style={styles.premiumActiveIcon}>
              <Ionicons name="star" size={28} color={Colors.vehicle} />
            </View>
            <Text style={styles.premiumActiveTitle}>You're on Premium</Text>
            <Text style={styles.premiumActiveSub}>
              Enjoy unlimited access to all LifeMaintained features.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.manageBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={handleManageSubscription}
            >
              <Text style={styles.manageBtnText}>Manage Subscription</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.heroSection}>
              <View style={styles.heroIcon}>
                <Ionicons name="star" size={32} color={Colors.vehicle} />
              </View>
              <Text style={styles.heroTitle}>Upgrade to Premium</Text>
              <Text style={styles.heroSub}>
                Start your 14-day free trial today. No credit card required.
              </Text>
            </View>

            <View style={styles.planToggle}>
              <Pressable
                style={[styles.planOption, selectedPlan === "monthly" && styles.planOptionActive]}
                onPress={() => { Haptics.selectionAsync(); setSelectedPlan("monthly"); }}
              >
                <Text style={[styles.planOptionText, selectedPlan === "monthly" && styles.planOptionTextActive]}>Monthly</Text>
                <Text style={[styles.planOptionPrice, selectedPlan === "monthly" && styles.planOptionTextActive]}>$4.99/mo</Text>
              </Pressable>
              <Pressable
                style={[styles.planOption, selectedPlan === "annual" && styles.planOptionActive]}
                onPress={() => { Haptics.selectionAsync(); setSelectedPlan("annual"); }}
              >
                <View style={styles.planOptionBadge}>
                  <Text style={styles.planOptionBadgeText}>Save 33%</Text>
                </View>
                <Text style={[styles.planOptionText, selectedPlan === "annual" && styles.planOptionTextActive]}>Annual</Text>
                <Text style={[styles.planOptionPrice, selectedPlan === "annual" && styles.planOptionTextActive]}>$39.99/yr</Text>
              </Pressable>
            </View>

            <View style={styles.comparisonRow}>
              <TierCard
                title="Free"
                price="$0"
                features={FREE_FEATURES}
                isActive={!isPremium && !isInTrial}
                color={Colors.textTertiary}
              />
              <TierCard
                title="Premium"
                price={selectedPlan === "monthly" ? "$4.99/mo" : "$39.99/yr"}
                features={PREMIUM_FEATURES}
                isActive={isPremium || isInTrial}
                color={Colors.vehicle}
                highlighted
              />
            </View>

            <View style={styles.promoSection}>
              <Text style={styles.promoLabel}>Promo Code</Text>
              <View style={styles.promoRow}>
                <TextInput
                  style={styles.promoInput}
                  value={promoCode}
                  onChangeText={text => { setPromoCode(text); setPromoError(null); setPromoApplied(null); }}
                  placeholder="Enter code"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="characters"
                  returnKeyType="done"
                  onSubmitEditing={applyPromoCode}
                />
                <Pressable
                  style={({ pressed }) => [styles.promoBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={applyPromoCode}
                >
                  <Text style={styles.promoBtnText}>Apply</Text>
                </Pressable>
              </View>
              {promoApplied && (
                <View style={styles.promoSuccess}>
                  <Ionicons name="checkmark-circle" size={14} color={Colors.good} />
                  <Text style={styles.promoSuccessText}>{promoApplied}</Text>
                </View>
              )}
              {promoError && (
                <Text style={styles.promoError}>{promoError}</Text>
              )}
            </View>

            <Pressable
              style={({ pressed }) => [styles.upgradeBtn, { opacity: pressed ? 0.9 : 1 }]}
              onPress={handleUpgrade}
              disabled={isUpgrading}
            >
              {isUpgrading ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="star" size={18} color={Colors.textInverse} />
                  <Text style={styles.upgradeBtnText}>Start Free Trial</Text>
                </>
              )}
            </Pressable>

            <Text style={styles.upgradeNote}>
              14-day free trial. Cancel anytime. {selectedPlan === "annual" ? "$39.99/year" : "$4.99/month"} after trial ends.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TierCard({ title, price, features, isActive, color, highlighted }: {
  title: string;
  price: string;
  features: string[];
  isActive: boolean;
  color: string;
  highlighted?: boolean;
}) {
  return (
    <View style={[styles.tierCard, highlighted && styles.tierCardHighlighted, isActive && { borderColor: color }]}>
      {highlighted && (
        <View style={[styles.tierBadge, { backgroundColor: color }]}>
          <Text style={styles.tierBadgeText}>Popular</Text>
        </View>
      )}
      <Text style={[styles.tierTitle, { color }]}>{title}</Text>
      <Text style={styles.tierPrice}>{price}</Text>
      {features.map((f, i) => (
        <View key={i} style={styles.featureRow}>
          <Ionicons name="checkmark-circle" size={14} color={color} />
          <Text style={styles.featureText}>{f}</Text>
        </View>
      ))}
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
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 20 },
  trialBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.dueSoonMuted,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dueSoon + "44",
  },
  trialBannerText: { flex: 1 },
  trialBannerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.dueSoon },
  trialBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  premiumActiveCard: { alignItems: "center", gap: 12, padding: 24 },
  premiumActiveIcon: { width: 72, height: 72, borderRadius: 22, backgroundColor: Colors.vehicleMuted, alignItems: "center", justifyContent: "center" },
  premiumActiveTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text },
  premiumActiveSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  manageBtn: { marginTop: 8, backgroundColor: Colors.card, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  manageBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  heroSection: { alignItems: "center", gap: 8 },
  heroIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: Colors.vehicleMuted, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  heroSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  planToggle: { flexDirection: "row", gap: 10 },
  planOption: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
  },
  planOptionActive: { borderColor: Colors.vehicle, backgroundColor: Colors.vehicleMuted },
  planOptionBadge: { position: "absolute", top: -8, backgroundColor: Colors.vehicle, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  planOptionBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  planOptionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  planOptionTextActive: { color: Colors.vehicle },
  planOptionPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.text },
  comparisonRow: { flexDirection: "row", gap: 10 },
  tierCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
  },
  tierCardHighlighted: { borderColor: Colors.vehicle + "44" },
  tierBadge: { position: "absolute", top: -9, right: 12, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  tierBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  tierTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  tierPrice: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 4 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  featureText: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1, lineHeight: 16 },
  promoSection: { gap: 8 },
  promoLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  promoRow: { flexDirection: "row", gap: 8 },
  promoInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  promoBtn: { backgroundColor: Colors.accent, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  promoBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  promoSuccess: { flexDirection: "row", alignItems: "center", gap: 6 },
  promoSuccessText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good },
  promoError: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.overdue },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.vehicle,
    borderRadius: 16,
    paddingVertical: 16,
  },
  upgradeBtnText: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.textInverse },
  upgradeNote: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center" },
});
