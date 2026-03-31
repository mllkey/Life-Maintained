import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
  Animated,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";

type Billing = "monthly" | "annual";
type TierKey = "personal" | "pro" | "business";

const TIER_CONFIG: Record<TierKey, {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  rcOffering: string;
  annualPrice: string;
  annualMonthly: string;
  monthlyPrice: string;
  popular?: boolean;
  features: string[];
}> = {
  personal: {
    label: "Personal",
    icon: "person",
    color: Colors.accent,
    rcOffering: "default",
    annualPrice: "$49.99/year",
    annualMonthly: "$4.17/mo",
    monthlyPrice: "$6.99/month",
    features: [
      "3 vehicles + 2 properties",
      "1 person + 1 pet",
      "15 AI receipt scans/month",
      "Voice logging",
      "Push notifications",
    ],
  },
  pro: {
    label: "Pro",
    icon: "briefcase",
    color: Colors.vehicle,
    rcOffering: "pro",
    annualPrice: "$99.99/year",
    annualMonthly: "$8.33/mo",
    monthlyPrice: "$11.99/month",
    popular: true,
    features: [
      "6 vehicles + 5 properties",
      "5 people + 3 pets",
      "30 AI receipt scans/month",
      "Voice logging",
      "Export to PDF/CSV",
    ],
  },
  business: {
    label: "Business",
    icon: "business",
    color: Colors.health,
    rcOffering: "business",
    annualPrice: "$249.99/year",
    annualMonthly: "$20.83/mo",
    monthlyPrice: "$29.99/month",
    features: [
      "Unlimited vehicles & properties",
      "Unlimited people & pets",
      "100 AI receipt scans/month",
      "Voice logging",
      "Export to PDF/CSV",
      "Priority support",
    ],
  },
};

interface PaywallProps {
  canDismiss: boolean;
  showSkip?: boolean;
  onDismiss?: () => void;
  onSkip?: () => void;
  subtitle?: string;
}

export default function Paywall({
  canDismiss,
  showSkip = false,
  onDismiss,
  onSkip,
  subtitle = "Choose the plan that fits your life",
}: PaywallProps) {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();

  const [billing, setBilling] = useState<Billing>("annual");
  const [selectedTier, setSelectedTier] = useState<TierKey>("personal");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showPromo, setShowPromo] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [loadedOfferings, setLoadedOfferings] = useState<any | null>(null);
  const [offeringsError, setOfferingsError] = useState(false);
  const [loadingOfferings, setLoadingOfferings] = useState(Platform.OS !== "web");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("Welcome to LifeMaintained Premium!");
  const purchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    loadOfferings();
  }, []);

  async function loadOfferings() {
    setLoadingOfferings(true);
    setOfferingsError(false);
    try {
      const Purchases = (await import("react-native-purchases")).default;
      const offerings = await Purchases.getOfferings();
      setLoadedOfferings(offerings);
    } catch {
      setOfferingsError(true);
    } finally {
      setLoadingOfferings(false);
    }
  }

  async function handlePurchase() {
    if (!user || Platform.OS === "web") {
      Alert.alert("Subscribe on Mobile", "Please use the iOS or Android app to subscribe.");
      return;
    }
    setIsPurchasing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    purchaseTimeoutRef.current = setTimeout(() => {
      setIsPurchasing(false);
      Alert.alert("Hmm, that didn't work", "Give it another shot.");
    }, 30000);

    try {
      const Purchases = (await import("react-native-purchases")).default;
      const cfg = TIER_CONFIG[selectedTier];
      const offering = cfg.rcOffering === "default"
        ? loadedOfferings?.current
        : loadedOfferings?.all?.[cfg.rcOffering] ?? null;

      if (!offering) {
        Alert.alert("Couldn't load pricing", "Give it another shot.");
        return;
      }

      const pkg = billing === "annual"
        ? (offering.annual ?? offering.availablePackages[0])
        : (offering.monthly ?? offering.availablePackages[0]);

      if (!pkg) {
        Alert.alert("Plan unavailable", "This plan isn't available right now. Try a different one.");
        return;
      }

      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);

      const active = customerInfo?.entitlements?.active ?? {};
      const tier = active["business_access"] ? "business"
        : active["pro_access"] ? "pro"
        : active["personal_access"] ? "personal" : null;

      if (tier) {
        const entKey = `${tier}_access`;
        const expiry: string | null = active[entKey]?.expirationDate ?? null;
        const periodType: string | undefined = active[entKey]?.periodType;
        const isTrialing = periodType === "TRIAL";

        const update: Record<string, any> = {
          subscription_tier: tier,
          subscription_expires_at: expiry,
          revenuecat_customer_id: customerInfo.originalAppUserId ?? null,
        };
        if (isTrialing && expiry) {
          update.trial_started_at = new Date().toISOString();
          update.trial_expires_at = expiry;
        }

        await supabase.from("profiles").update(update).eq("user_id", user.id);
        await refreshProfile();
      }

      setToastMessage("Welcome to LifeMaintained Premium!");
      setToastVisible(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        setToastVisible(false);
        onDismiss?.();
      }, 1600);
    } catch (err: any) {
      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
      if (!err?.userCancelled) {
        Alert.alert("Purchase didn't go through", err?.message ?? "Give it another shot.");
      }
    } finally {
      setIsPurchasing(false);
    }
  }

  async function handleRestore() {
    if (Platform.OS === "web") return;
    setIsRestoring(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const Purchases = (await import("react-native-purchases")).default;
      const customerInfo = await Purchases.restorePurchases();
      const active = customerInfo?.entitlements?.active ?? {};
      const tier = active["business_access"] ? "business"
        : active["pro_access"] ? "pro"
        : active["personal_access"] ? "personal" : null;

      if (tier && user) {
        const entKey = `${tier}_access`;
        await supabase.from("profiles").update({
          subscription_tier: tier,
          subscription_expires_at: active[entKey]?.expirationDate ?? null,
          revenuecat_customer_id: customerInfo.originalAppUserId ?? null,
        }).eq("user_id", user.id);
        await refreshProfile();
        setToastMessage("Purchases restored!");
        setToastVisible(true);
        setTimeout(() => { setToastVisible(false); onDismiss?.(); }, 1600);
      } else {
        Alert.alert("No purchases found", "If you think this is wrong, reach out to us at support@lifemaintained.com.");
      }
    } catch {
      Alert.alert("Restore didn't work", "Give it another shot.");
    } finally {
      setIsRestoring(false);
    }
  }

  async function handleApplyPromo() {
    const code = promoCode.toUpperCase().trim();
    if (!code || !user) return;
    setPromoStatus("checking");
    try {
      const { data } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", code)
        .maybeSingle();

      if (!data) {
        setPromoStatus("error");
        setPromoMessage("Invalid promo code");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        setPromoStatus("error");
        setPromoMessage("This code has expired");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (data.max_uses != null && data.current_uses >= data.max_uses) {
        setPromoStatus("error");
        setPromoMessage("This code has reached its usage limit");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await supabase
        .from("promo_codes")
        .update({ current_uses: (data.current_uses ?? 0) + 1 })
        .eq("id", data.id);

      const expiry = new Date(Date.now() + data.duration_days * 86400000).toISOString();
      await supabase
        .from("profiles")
        .update({
          subscription_tier: data.tier,
          subscription_expires_at: expiry,
        })
        .eq("user_id", user.id);

      await refreshProfile();

      setPromoStatus("success");
      setPromoMessage(`Code applied! ${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)} access for ${data.duration_days} days.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (canDismiss && onDismiss) {
        setTimeout(() => {
          onDismiss();
        }, 1600);
      }
    } catch {
      setPromoStatus("error");
      setPromoMessage("Could not validate code. Please try again.");
    }
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;
  const tiers: TierKey[] = ["personal", "pro", "business"];

  if (Platform.OS === "web") {
    return (
      <View style={[styles.webFallback, { paddingTop: topPad + 16, paddingBottom: botPad + 16 }]}>
        {canDismiss && (
          <Pressable style={styles.closeBtn} onPress={onDismiss}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
        )}
        <View style={styles.webFallbackInner}>
          <Ionicons name="phone-portrait-outline" size={48} color={Colors.accent} />
          <Text style={styles.webFallbackTitle}>Subscribe on Mobile</Text>
          <Text style={styles.webFallbackSub}>
            Download LifeMaintained on iOS or Android to start your free trial.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? topPad + 8 : 0}
    >
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        {canDismiss ? (
          <Pressable
            style={styles.closeBtn}
            onPress={onDismiss}
            hitSlop={8}
            testID="paywall-close"
          >
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
        ) : (
          <View style={styles.closeBtn} />
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>LifeMaintained Premium</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
        <View style={styles.closeBtn} />
      </View>

      {loadingOfferings ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Billing toggle — segmented control */}
          <View style={styles.billingToggle}>
            {(["monthly", "annual"] as Billing[]).map(b => (
              <Pressable
                key={b}
                style={[styles.billingOption, billing === b && styles.billingActive]}
                onPress={() => { Haptics.selectionAsync(); setBilling(b); }}
              >
                <View style={styles.billingOptionContent}>
                  <Text style={[styles.billingLabel, billing === b && styles.billingLabelActive]}>
                    {b === "monthly" ? "Monthly" : "Annual"}
                  </Text>
                  {b === "annual" && (
                    <Text style={[styles.saveText, billing === "annual" && styles.saveTextActive]}>
                      {"  "}Save 40%
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>

          {tiers.map(tier => {
            const cfg = TIER_CONFIG[tier];
            const selected = selectedTier === tier;
            return (
              <View key={tier} style={styles.tierWrapper}>
                {cfg.popular && (
                  <Text style={[styles.popularLabel, { color: cfg.color }]}>Most Popular</Text>
                )}
                <Pressable
                  style={[
                    styles.tierCard,
                    selected && { borderColor: cfg.color, backgroundColor: cfg.color + "0C" },
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setSelectedTier(tier); }}
                  testID={`tier-${tier}`}
                >
                  <View style={styles.tierTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tierName, { color: selected ? cfg.color : Colors.text }]}>
                        {cfg.label}
                      </Text>
                      <Text style={styles.tierPrice}>
                        {billing === "annual" ? cfg.annualPrice : cfg.monthlyPrice}
                      </Text>
                      {billing === "annual" && (
                        <Text style={styles.tierPriceSub}>{cfg.annualMonthly} · billed annually</Text>
                      )}
                    </View>
                    <View style={[
                      styles.radioOuter,
                      selected && { borderColor: cfg.color },
                    ]}>
                      {selected && <View style={[styles.radioInner, { backgroundColor: cfg.color }]} />}
                    </View>
                  </View>
                  <View style={styles.tierFeatures}>
                    {cfg.features.map((f, i) => (
                      <View key={i} style={styles.featureRow}>
                        <Text style={styles.featureBullet}>–</Text>
                        <Text style={styles.featureText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              </View>
            );
          })}

          <View style={styles.scanLimitsBox}>
            <Text style={styles.scanLimitsTitle}>AI scan limits</Text>
            <Text style={styles.scanLimitsText}>Free: Upgrade to scan receipts</Text>
            <Text style={styles.scanLimitsText}>Personal: 15 AI scans/month</Text>
            <Text style={styles.scanLimitsText}>Pro: 30 AI scans/month</Text>
            <Text style={styles.scanLimitsText}>Business: 100 AI scans/month</Text>
          </View>

          <Text style={styles.trialCalloutText}>
            14-day free trial · Full access · No credit card required
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.ctaBtn,
              { opacity: pressed || isPurchasing ? 0.85 : 1 },
              offeringsError && { backgroundColor: Colors.textTertiary },
            ]}
            onPress={offeringsError ? loadOfferings : handlePurchase}
            disabled={isPurchasing || isRestoring || loadingOfferings}
            testID="paywall-cta"
            accessibilityLabel="Subscribe to plan"
            accessibilityRole="button"
          >
            {isPurchasing ? (
              <ActivityIndicator color={Colors.background} />
            ) : offeringsError ? (
              <Text style={styles.ctaBtnText}>Retry Loading Plans</Text>
            ) : (
              <Text style={styles.ctaBtnText}>
                {profile?.subscription_tier === "trial" && profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date()
                  ? "Choose Plan"
                  : "Start Free Trial"}
              </Text>
            )}
          </Pressable>

          <Text style={styles.legalText}>
            Cancel anytime · Billed through App Store after trial
          </Text>

          {showSkip && (
            <Pressable
              style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={onSkip}
              testID="paywall-skip"
            >
              <Text style={styles.skipText}>Maybe later</Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [styles.restoreBtn, { opacity: pressed || isRestoring ? 0.6 : 1 }]}
            onPress={handleRestore}
            disabled={isRestoring || isPurchasing}
          >
            {isRestoring
              ? <ActivityIndicator size="small" color={Colors.textTertiary} />
              : <Text style={styles.restoreText}>Restore Purchases</Text>
            }
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.promoToggle, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => { setShowPromo(p => !p); setPromoStatus("idle"); setPromoMessage(null); }}
          >
            <Text style={styles.promoToggleText}>
              {showPromo ? "Hide promo code" : "Have a promo code?"}
            </Text>
          </Pressable>

          {showPromo && (
            <View style={styles.promoSection}>
              <View style={styles.promoRow}>
                <TextInput
                  style={styles.promoInput}
                  value={promoCode}
                  onChangeText={t => { setPromoCode(t); setPromoStatus("idle"); setPromoMessage(null); }}
                  placeholder="Enter code"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="characters"
                  returnKeyType="done"
                  onSubmitEditing={handleApplyPromo}
                />
                <Pressable
                  style={({ pressed }) => [styles.promoApplyBtn, { opacity: pressed || promoStatus === "checking" ? 0.7 : 1 }]}
                  onPress={handleApplyPromo}
                  disabled={promoStatus === "checking"}
                >
                  {promoStatus === "checking"
                    ? <ActivityIndicator size="small" color={Colors.textInverse} />
                    : <Text style={styles.promoApplyText}>Apply</Text>
                  }
                </Pressable>
              </View>
              {promoMessage && (
                <View style={styles.promoFeedback}>
                  <Ionicons
                    name={promoStatus === "success" ? "checkmark-circle" : "alert-circle"}
                    size={14}
                    color={promoStatus === "success" ? Colors.good : Colors.overdue}
                  />
                  <Text style={[
                    styles.promoFeedbackText,
                    { color: promoStatus === "success" ? Colors.good : Colors.overdue },
                  ]}>
                    {promoMessage}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
      <SaveToast visible={toastVisible} message={toastMessage} />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center", gap: 4 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  headerSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },

  // Billing toggle — segmented control
  billingToggle: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    backgroundColor: Colors.card,
  },
  billingOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  billingActive: { backgroundColor: Colors.accent },
  billingOptionContent: { flexDirection: "row", alignItems: "center" },
  billingLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  billingLabelActive: { color: Colors.textInverse, fontFamily: "Inter_600SemiBold" },
  saveText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.accent },
  saveTextActive: { color: Colors.textInverse },

  // Tier cards
  tierWrapper: { gap: 4 },
  popularLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    paddingLeft: 2,
  },
  tierCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  tierTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  tierName: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  tierPrice: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 26 },
  tierPriceSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  tierFeatures: { gap: 6 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureBullet: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, width: 10 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 },

  scanLimitsBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  scanLimitsTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 2,
  },
  scanLimitsText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },

  trialCalloutText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  ctaBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.textInverse },
  legalText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: -8,
  },
  skipBtn: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  restoreBtn: { alignItems: "center", paddingVertical: 8 },
  restoreText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  promoToggle: { alignItems: "center", paddingVertical: 4 },
  promoToggleText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  promoSection: { gap: 8, marginTop: -4 },
  promoRow: { flexDirection: "row", gap: 8 },
  promoInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  promoApplyBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
    minWidth: 64,
    alignItems: "center",
  },
  promoApplyText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.background },
  promoFeedback: { flexDirection: "row", alignItems: "center", gap: 6 },
  promoFeedbackText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  webFallback: { flex: 1, backgroundColor: Colors.background, position: "relative" },
  webFallbackInner: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  webFallbackTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
  webFallbackSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
});
