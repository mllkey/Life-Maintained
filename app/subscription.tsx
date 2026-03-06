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
import {
  hasActivePremium,
  hasProOrAbove,
  hasBusiness,
  isInTrial,
  trialDaysRemaining,
} from "@/lib/subscription";

type BillingPeriod = "monthly" | "annual";
type TierKey = "personal" | "pro" | "business";

const TIER_CONFIG: Record<TierKey, {
  label: string;
  icon: string;
  color: string;
  monthlyPrice: string;
  annualPrice: string;
  annualMonthly: string;
  savePct: string;
  rcOffering: string;
  features: string[];
}> = {
  personal: {
    label: "Personal",
    icon: "person",
    color: Colors.accent,
    monthlyPrice: "$4.99",
    annualPrice: "$39.99",
    annualMonthly: "$3.33",
    savePct: "33%",
    rcOffering: "default",
    features: [
      "Up to 3 vehicles",
      "Up to 2 properties",
      "15 receipt scans/month",
      "Full service history",
      "Maintenance reminders",
      "Budget alerts",
    ],
  },
  pro: {
    label: "Pro",
    icon: "briefcase",
    color: Colors.vehicle,
    monthlyPrice: "$9.99",
    annualPrice: "$79.99",
    annualMonthly: "$6.67",
    savePct: "33%",
    rcOffering: "pro",
    features: [
      "Up to 6 vehicles",
      "Up to 5 properties",
      "30 receipt scans/month",
      "Export to PDF & CSV",
      "Advanced notifications",
      "Priority support",
    ],
  },
  business: {
    label: "Business",
    icon: "business",
    color: Colors.health,
    monthlyPrice: "$19.99",
    annualPrice: "$159.99",
    annualMonthly: "$13.33",
    savePct: "33%",
    rcOffering: "business",
    features: [
      "Unlimited vehicles",
      "Unlimited properties",
      "100 receipt scans/month",
      "Multi-user management",
      "Bulk export",
      "Dedicated support",
    ],
  },
};

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();

  const [billing, setBilling] = useState<BillingPeriod>("annual");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [purchasingTier, setPurchasingTier] = useState<TierKey | null>(null);

  const activeTier = profile?.subscription_tier ?? "free";
  const isPaid = hasActivePremium(profile) && !isInTrial(profile);
  const inTrialNow = isInTrial(profile);
  const daysLeft = trialDaysRemaining(profile);
  const isCurrentlyBusiness = hasBusiness(profile) && !inTrialNow;
  const isCurrentlyPro = hasProOrAbove(profile) && !hasBusiness(profile) && !inTrialNow;
  const isCurrentlyPersonal = hasActivePremium(profile) && !hasProOrAbove(profile) && !inTrialNow;

  async function applyPromoCode() {
    const upper = promoCode.toUpperCase().trim();
    if (!upper) return;
    try {
      const { data } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", upper)
        .maybeSingle();
      if (!data) {
        setPromoError("Invalid or expired code");
        setPromoApplied(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const expired = data.expires_at && new Date(data.expires_at) < new Date();
      const maxed = data.max_uses && data.use_count >= data.max_uses;
      if (expired || maxed) {
        setPromoError("This code is no longer valid");
        setPromoApplied(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      setPromoApplied(`${data.discount_percent}% off applied!`);
      setPromoError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setPromoError("Could not validate code");
    }
  }

  async function handlePurchase(tier: TierKey) {
    if (!user) return;
    if (Platform.OS === "web") {
      Alert.alert("Subscriptions", "Please use the iOS or Android app to subscribe.");
      return;
    }
    setPurchasingTier(tier);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const Purchases = (await import("react-native-purchases")).default;
      const offeringId = TIER_CONFIG[tier].rcOffering;
      const offerings = await Purchases.getOfferings();
      const offering = offeringId === "default"
        ? offerings.current
        : offerings.all[offeringId] ?? null;

      if (!offering) {
        Alert.alert("Error", "This plan is not available right now. Please try again later.");
        return;
      }

      const pkg = billing === "annual"
        ? (offering.annual ?? offering.availablePackages[0])
        : (offering.monthly ?? offering.availablePackages[0]);

      if (!pkg) {
        Alert.alert("Error", "No packages available for this plan.");
        return;
      }

      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = customerInfo?.entitlements?.active ?? {};
      const tierKey =
        active["business_access"] ? "business" :
        active["pro_access"] ? "pro" :
        active["personal_access"] ? "personal" : null;

      if (tierKey) {
        const expKey =
          tierKey === "business" ? "business_access" :
          tierKey === "pro" ? "pro_access" : "personal_access";
        await supabase.from("profiles").update({
          subscription_tier: tierKey,
          subscription_expires_at: active[expKey]?.expirationDate ?? null,
          revenuecat_customer_id: customerInfo.originalAppUserId ?? null,
        }).eq("user_id", user.id);
        await refreshProfile();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          `${TIER_CONFIG[tier].label} Activated!`,
          "Your subscription is now active. Enjoy all the features.",
          [{ text: "Let's Go", onPress: () => router.dismiss() }]
        );
      }
    } catch (err: any) {
      if (err?.userCancelled) return;
      Alert.alert("Purchase Failed", err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setPurchasingTier(null);
    }
  }

  async function handleManageSubscription() {
    if (Platform.OS === "web") return;
    try {
      const Purchases = (await import("react-native-purchases")).default;
      await Purchases.showManageSubscriptions();
    } catch {
      Alert.alert(
        "Manage Subscription",
        "Visit Settings → Apple ID → Subscriptions on your device to manage your plan.",
        [{ text: "OK" }]
      );
    }
  }

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.dismiss()} style={styles.closeBtn} testID="close-btn">
          <Ionicons name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Plans</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 40 },
        ]}
      >
        {inTrialNow && (
          <View style={styles.trialBanner}>
            <Ionicons name="time-outline" size={18} color={Colors.dueSoon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.trialTitle}>Free Trial Active</Text>
              <Text style={styles.trialSub}>
                {daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining — access all features until your trial ends
              </Text>
            </View>
          </View>
        )}

        {!inTrialNow && isPaid && (
          <View style={styles.activeCard}>
            <View style={[styles.activeIcon, { backgroundColor: (TIER_CONFIG[activeTier as TierKey]?.color ?? Colors.accent) + "22" }]}>
              <Ionicons
                name={(TIER_CONFIG[activeTier as TierKey]?.icon ?? "star") as any}
                size={26}
                color={TIER_CONFIG[activeTier as TierKey]?.color ?? Colors.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activeTitle}>
                {TIER_CONFIG[activeTier as TierKey]?.label ?? activeTier} Plan Active
              </Text>
              <Text style={styles.activeSub}>Your subscription is active</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.manageBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={handleManageSubscription}
            >
              <Text style={styles.manageBtnText}>Manage</Text>
            </Pressable>
          </View>
        )}

        {!isPaid && !inTrialNow && (
          <View style={styles.heroSection}>
            <Text style={styles.heroTitle}>Choose Your Plan</Text>
            <Text style={styles.heroSub}>
              Track everything with no limits. Start a 14-day free trial on any plan.
            </Text>
          </View>
        )}

        <View style={styles.billingToggle}>
          {(["monthly", "annual"] as BillingPeriod[]).map((p) => (
            <Pressable
              key={p}
              style={[styles.billingOption, billing === p && styles.billingOptionActive]}
              onPress={() => { Haptics.selectionAsync(); setBilling(p); }}
            >
              {p === "annual" && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>Save 33%</Text>
                </View>
              )}
              <Text style={[styles.billingLabel, billing === p && styles.billingLabelActive]}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {(["personal", "pro", "business"] as TierKey[]).map((tier) => {
          const cfg = TIER_CONFIG[tier];
          const isCurrentTier =
            tier === "business" ? isCurrentlyBusiness :
            tier === "pro" ? isCurrentlyPro :
            isCurrentlyPersonal;
          const isPurchasing = purchasingTier === tier;

          return (
            <View key={tier} style={[styles.tierCard, isCurrentTier && { borderColor: cfg.color }]}>
              <View style={styles.tierHeader}>
                <View style={[styles.tierIcon, { backgroundColor: cfg.color + "22" }]}>
                  <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tierName, { color: cfg.color }]}>{cfg.label}</Text>
                  <Text style={styles.tierPrice}>
                    {billing === "annual"
                      ? `${cfg.annualMonthly}/mo · ${cfg.annualPrice}/yr`
                      : `${cfg.monthlyPrice}/mo`}
                  </Text>
                </View>
                {isCurrentTier && (
                  <View style={[styles.currentBadge, { backgroundColor: cfg.color }]}>
                    <Text style={styles.currentBadgeText}>Current</Text>
                  </View>
                )}
              </View>

              <View style={styles.featureList}>
                {cfg.features.map((f, i) => (
                  <View key={i} style={styles.featureRow}>
                    <Ionicons name="checkmark-circle" size={14} color={cfg.color} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>

              {!isCurrentTier && (
                <Pressable
                  style={({ pressed }) => [
                    styles.selectBtn,
                    { backgroundColor: cfg.color, opacity: pressed || isPurchasing ? 0.8 : 1 },
                  ]}
                  onPress={() => handlePurchase(tier)}
                  disabled={isPurchasing || purchasingTier !== null}
                  testID={`select-${tier}`}
                >
                  {isPurchasing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.selectBtnText}>
                      {inTrialNow || activeTier === "free" ? "Start Free Trial" : "Switch to " + cfg.label}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}

        <View style={styles.promoSection}>
          <Text style={styles.promoLabel}>Promo Code</Text>
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              value={promoCode}
              onChangeText={(t) => {
                setPromoCode(t);
                setPromoError(null);
                setPromoApplied(null);
              }}
              placeholder="Enter code"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={applyPromoCode}
            />
            <Pressable
              style={({ pressed }) => [styles.promoBtn, { opacity: pressed ? 0.7 : 1 }]}
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
          {promoError && <Text style={styles.promoError}>{promoError}</Text>}
        </View>

        <Text style={styles.disclaimer}>
          Subscriptions auto-renew unless cancelled at least 24 hours before the renewal date.
          Manage or cancel anytime in your App Store settings.
        </Text>
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
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 16 },
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
  trialTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.dueSoon },
  trialSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  activeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  activeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  activeSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  manageBtn: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manageBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  heroSection: { alignItems: "center", gap: 6, paddingVertical: 8 },
  heroTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  heroSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  billingToggle: { flexDirection: "row", gap: 10 },
  billingOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    position: "relative",
  },
  billingOptionActive: { borderColor: Colors.accent, backgroundColor: Colors.accentMuted },
  billingLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  billingLabelActive: { color: Colors.accent, fontFamily: "Inter_600SemiBold" },
  saveBadge: {
    position: "absolute",
    top: -8,
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  saveBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  tierCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tierHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  tierIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tierName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tierPrice: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 1 },
  currentBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  currentBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  featureList: { gap: 6 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 },
  selectBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  selectBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
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
  promoBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  promoBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  promoSuccess: { flexDirection: "row", alignItems: "center", gap: 6 },
  promoSuccessText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good },
  promoError: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.overdue },
  disclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    lineHeight: 16,
  },
});
