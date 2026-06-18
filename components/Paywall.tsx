import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
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
import { capture as captureAnalytics } from "@/lib/analytics";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";
import { rcReady, extractTierHintFromCustomerInfo, syncSubscriptionFromRc } from "@/lib/revenuecat";

type Billing = "monthly" | "annual";
type TierKey = "personal" | "pro" | "business";

// Compute true annual-vs-monthly savings percentage from price strings.
// Returns an integer percentage rounded down. Source of truth is
// TIER_CONFIG below; do not duplicate the math anywhere else.
function savingsPctFor(monthlyStr: string, annualStr: string): number {
  const m = parseFloat(monthlyStr.replace(/[^0-9.]/g, ""));
  const a = parseFloat(annualStr.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(m) || !Number.isFinite(a) || m <= 0) return 0;
  const yearlyAtMonthly = m * 12;
  if (yearlyAtMonthly <= 0) return 0;
  return Math.floor(((yearlyAtMonthly - a) / yearlyAtMonthly) * 100);
}

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
    monthlyPrice: "$7.99/month",
    features: [
      "3 vehicles + 2 properties",
      "1 person + 1 pet",
      "15 AI receipt scans/month",
      "30 voice logs/day",
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
      "Unlimited voice logging",
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
    monthlyPrice: "$34.99/month",
    features: [
      "Unlimited vehicles & properties",
      "Unlimited people & pets",
      "100 AI receipt scans/month",
      "Unlimited voice logging",
      "Export to PDF/CSV",
      "Priority support",
    ],
  },
};

type PaywallInlineError = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  feedback?: "error" | "warning";
};

export type PaywallVertical = "vehicle" | "property" | "family" | "scans" | "voice" | "general";
export type PaywallReason = "limit_reached" | "feature_locked" | "locked_existing" | "general";
export interface PaywallContext {
  vertical: PaywallVertical;
  reason: PaywallReason;
}

interface PaywallProps {
  canDismiss: boolean;
  showSkip?: boolean;
  onDismiss?: () => void;
  onSkip?: () => void;
  subtitle?: string;
  context?: PaywallContext;
}

// Per-vertical accent color for the primary CTA and contextual subtitle tint.
function verticalAccent(vertical: PaywallVertical): string {
  if (vertical === "vehicle") return Colors.vehicle;
  if (vertical === "property") return Colors.home;
  if (vertical === "family") return Colors.health;
  return Colors.accent;
}

// Per-context default subtitle. Distinguishes locked-existing from limit-reached
// so the user knows whether they are unlocking what they already have or being
// asked to grow beyond their current plan.
function contextualSubtitle(ctx: PaywallContext | undefined): string {
  if (!ctx) return "Choose the plan that fits your life";
  if (ctx.reason === "locked_existing") {
    if (ctx.vertical === "vehicle") return "Unlock your other vehicles";
    if (ctx.vertical === "property") return "Unlock your other properties";
    if (ctx.vertical === "family") return "Unlock your other family members";
    return "Unlock everything you have";
  }
  if (ctx.reason === "limit_reached") {
    if (ctx.vertical === "vehicle") return "Upgrade to add more vehicles";
    if (ctx.vertical === "property") return "Upgrade to add more properties";
    if (ctx.vertical === "family") return "Upgrade to add more family members";
    if (ctx.vertical === "scans") return "Upgrade for more receipt scans";
    if (ctx.vertical === "voice") return "Upgrade for more voice logging";
    return "Upgrade to keep going";
  }
  if (ctx.reason === "feature_locked") {
    if (ctx.vertical === "vehicle") return "Upgrade to export your service history";
    if (ctx.vertical === "scans") return "Upgrade to scan receipts with AI";
    return "Upgrade to unlock this";
  }
  return "Choose the plan that fits your life";
}

// Tier preselect: free user hitting any context starts at Personal; Personal user
// hitting any context starts at Pro. Defaults to Personal otherwise.
function preselectedTierFor(profile: { subscription_tier: string | null } | null | undefined): TierKey {
  const t = profile?.subscription_tier ?? null;
  if (t === "personal") return "pro";
  return "personal";
}

export default function Paywall({
  canDismiss,
  showSkip = false,
  onDismiss,
  onSkip,
  subtitle,
  context,
}: PaywallProps) {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();
  const [billing, setBilling] = useState<Billing>("annual");
  const [selectedTier, setSelectedTier] = useState<TierKey>(context ? preselectedTierFor(profile) : "personal");
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
  const [toastMessage, setToastMessage] = useState("You're in. Trial starts now.");
  const [toastSubtitle, setToastSubtitle] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inlineError, setInlineError] = useState<PaywallInlineError | null>(null);
  const purchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestProfileTierRef = useRef<string | null>(profile?.subscription_tier ?? null);
  useEffect(() => {
    latestProfileTierRef.current = profile?.subscription_tier ?? null;
  }, [profile?.subscription_tier]);

  useEffect(() => {
    captureAnalytics("paywall_viewed", {
      context_vertical: context?.vertical,
      context_reason: context?.reason,
    });
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const waitForWebhookProfileTier = async (expectedTier: string): Promise<boolean> => {
    for (let i = 0; i < 8; i++) {
      await refreshProfile();
      if (latestProfileTierRef.current === expectedTier) return true;
      if (i < 7) await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  };

  useEffect(() => {
    if (Platform.OS === "web") return;
    loadOfferings();
  }, []);

  function showToast(message: string, subtitle?: string, isError = false, duration = 2400) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastSubtitle(subtitle ?? null);
    setToastIsError(isError);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, duration);
  }

  function showInlineError(next: PaywallInlineError) {
    setInlineError(next);
    const feedbackType =
      next.feedback === "warning"
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Error;
    Haptics.notificationAsync(feedbackType).catch(() => {});
  }

  function clearPaywallError() {
    setInlineError(null);
  }

  async function loadOfferings(retried = false) {
    setLoadingOfferings(true);
    setOfferingsError(false);
    clearPaywallError();
    try {
      await rcReady;
      const Purchases = (await import("react-native-purchases")).default;
      const offerings = await Purchases.getOfferings();
      setLoadedOfferings(offerings);
    } catch (e) {
      console.error("[Paywall] getOfferings failed:", e);
      if (!retried) {
        setTimeout(() => loadOfferings(true), 3000);
      } else {
        setOfferingsError(true);
      }
    } finally {
      setLoadingOfferings(false);
    }
  }

  async function handlePurchase() {
    if (!user || Platform.OS === "web") {
      showInlineError({
        title: "Sign in required",
        message: "Please sign in to start a subscription.",
        actionLabel: "Try again",
        onAction: handlePurchase,
      });
      return;
    }
    setIsPurchasing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Apple sandbox routinely takes >30s and can exceed 120s during
    // outages. Do not tell the user the purchase failed while purchasePackage
    // is still in flight.
    //
    // 30s soft hint: toast only. Spinner stays. CTA stays disabled.
    // 150s long-wait nudge: advisory Alert only. Does NOT set isPurchasing
    // false — that would re-enable the CTA and allow a duplicate purchase
    // attempt while StoreKit is still working. The original purchase promise
    // remains authoritative and runs the normal finally{} cleanup when it
    // eventually resolves or rejects.
    purchaseTimeoutRef.current = setTimeout(() => {
      setToastMessage("Still waiting on Apple…");
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2400);
    }, 30000);

    const purchaseEscapeTimeout = setTimeout(() => {
      showInlineError({
        title: "Still waiting on Apple",
        message: "This is taking longer than expected. You can leave this screen — if Apple completes the charge, come back and tap Restore Purchases.",
        feedback: "warning",
      });
    }, 150000);

    try {
      const Purchases = (await import("react-native-purchases")).default;
      const cfg = TIER_CONFIG[selectedTier];
      const offering = cfg.rcOffering === "default"
        ? loadedOfferings?.current
        : loadedOfferings?.all?.[cfg.rcOffering] ?? null;

      if (!offering) {
        if (purchaseTimeoutRef.current) { clearTimeout(purchaseTimeoutRef.current); purchaseTimeoutRef.current = null; }
        clearTimeout(purchaseEscapeTimeout);
        setIsPurchasing(false);
        showInlineError({
          title: "Couldn't load pricing",
          message: "Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => loadOfferings(false),
        });
        return;
      }

      const pkg = billing === "annual"
        ? (offering.annual ?? offering.availablePackages[0])
        : (offering.monthly ?? offering.availablePackages[0]);

      if (!pkg) {
        if (purchaseTimeoutRef.current) { clearTimeout(purchaseTimeoutRef.current); purchaseTimeoutRef.current = null; }
        clearTimeout(purchaseEscapeTimeout);
        setIsPurchasing(false);
        showInlineError({
          title: "Plan unavailable",
          message: "This plan isn't available right now. Try another plan or check back shortly.",
          feedback: "warning",
        });
        return;
      }

      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
      clearTimeout(purchaseEscapeTimeout);

      const active = customerInfo?.entitlements?.active ?? {};
      const tier = active["business_access"] ? "business"
        : active["pro_access"] ? "pro"
        : active["personal_access"] ? "personal" : null;

      if (tier) {
        const synced = await waitForWebhookProfileTier(tier);

        if (synced) {
          setToastMessage("You're in. Trial starts now.");
          setToastVisible(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setTimeout(() => {
            setToastVisible(false);
            onDismiss?.();
          }, 1600);
        } else {
          const syncResult = await syncSubscriptionFromRc();
          await refreshProfile();

          if (syncResult.ok && latestProfileTierRef.current === tier) {
            setToastMessage("You're in. Trial starts now.");
            setToastVisible(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => {
              setToastVisible(false);
              onDismiss?.();
            }, 1600);
          } else {
            showInlineError({
              title: "Just a moment",
              message: "The purchase went through. Tap Restore Purchases. If it still won't unlock, email support@lifemaintained.com.",
              actionLabel: "Restore Purchases",
              onAction: handleRestore,
              feedback: "warning",
            });
          }
        }
      } else {
        console.warn("[Paywall] Purchase completed but no entitlement found:", JSON.stringify(active));
        showInlineError({
          title: "Activation needs a retry",
          message: "Your purchase was processed, but we couldn't activate your plan. Tap Restore Purchases, or contact support@lifemaintained.com.",
          actionLabel: "Restore Purchases",
          onAction: handleRestore,
          feedback: "warning",
        });
      }
    } catch (err: any) {
      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
      clearTimeout(purchaseEscapeTimeout);
      if (!err?.userCancelled) {
        showInlineError({
          title: "Purchase didn't go through",
          message: "No charge was made. Try again or pick a different plan.",
          actionLabel: "Try again",
          onAction: handlePurchase,
        });
      }
    } finally {
      setIsPurchasing(false);
    }
  }

  async function handleRestore() {
    if (Platform.OS === "web") return;
    if (!user) {
      showInlineError({
        title: "Sign in required",
        message: "Please sign in to restore your purchases.",
        actionLabel: "Try again",
        onAction: handleRestore,
      });
      return;
    }
    setIsRestoring(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const Purchases = (await import("react-native-purchases")).default;
      const customerInfo = await Purchases.restorePurchases();
      const tierHint = extractTierHintFromCustomerInfo(customerInfo);

      if (!tierHint) {
        showInlineError({
          title: "No purchases found",
          message: "We couldn't find purchases on this Apple ID. Contact support@lifemaintained.com if you think this is wrong.",
        });
        return;
      }

      const syncResult = await syncSubscriptionFromRc();
      if (!syncResult.ok) {
        showInlineError({
          title: "Restore couldn't finish",
          message: "We saw your purchase, but couldn't update your account. Please try again or contact support@lifemaintained.com.",
          actionLabel: "Try again",
          onAction: handleRestore,
        });
        return;
      }

      await refreshProfile();

      if (syncResult.tier === "free") {
        showInlineError({
          title: "No active subscription",
          message: "We couldn't find an active subscription on this Apple ID. Contact support@lifemaintained.com if you think this is wrong.",
        });
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToastMessage("Purchases restored!");
      setToastVisible(true);
      setTimeout(() => { setToastVisible(false); onDismiss?.(); }, 1600);
    } catch (e) {
      console.error("[Paywall] Restore failed:", e);
      showInlineError({
        title: "Couldn't restore purchases",
        message: "Make sure you're signed into the same Apple ID you used to subscribe, then try again.",
        actionLabel: "Try again",
        onAction: handleRestore,
      });
    } finally {
      setIsRestoring(false);
    }
  }

  async function handleApplyPromo() {
    const code = promoCode.toUpperCase().trim();
    if (!code || !user) return;
    setPromoStatus("checking");
    try {
      const { data, error } = await supabase.functions.invoke("apply-promo-code", {
        body: { code },
      });

      if (error) {
        setPromoStatus("error");
        setPromoMessage("That code didn't work. Double-check it and try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      if (data?.error) {
        setPromoStatus("error");
        setPromoMessage(data.error);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await refreshProfile();

      setPromoStatus("success");
      setPromoMessage(data?.message ? `Code applied! ${data.message}.` : "Code applied!");
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
          <Text style={styles.headerSubtitle}>{subtitle ?? contextualSubtitle(context)}</Text>
        </View>
        <View style={styles.closeBtn} />
      </View>

      {loadingOfferings ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : offeringsError ? (
        <View style={styles.offeringsErrorContainer}>
          <View style={styles.offeringsErrorIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={Colors.accent} />
          </View>
          <Text style={styles.offeringsErrorTitle}>Couldn't load plans</Text>
          <Text style={styles.offeringsErrorText}>
            Check your connection and try again.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.offeringsRetryBtn, { opacity: pressed ? 0.82 : 1 }]}
            onPress={() => loadOfferings(false)}
            accessibilityRole="button"
            accessibilityLabel="Try loading plans again"
          >
            <Text style={styles.offeringsRetryText}>Try again</Text>
          </Pressable>
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
                onPress={() => { setBilling(b); Haptics.selectionAsync(); }}
              >
                <View style={styles.billingOptionContent}>
                  <Text style={[styles.billingLabel, billing === b && styles.billingLabelActive]}>
                    {b === "monthly" ? "Monthly" : "Annual"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>

          {tiers.map(tier => {
            const cfg = TIER_CONFIG[tier];
            const selected = selectedTier === tier;
            return (
              <View key={tier} style={[styles.tierWrapper, cfg.popular && styles.tierWrapperPopular]}>
                <Pressable
                  style={[
                    styles.tierCard,
                    cfg.popular && styles.tierCardPopular,
                    selected && { borderColor: cfg.color, backgroundColor: cfg.color + "0C" },
                  ]}
                  onPress={() => { setSelectedTier(tier); Haptics.selectionAsync(); }}
                  testID={`tier-${tier}`}
                >
                  {cfg.popular ? (
                    <View
                      pointerEvents="none"
                      style={[styles.popularPillBadge, { backgroundColor: cfg.color }]}
                    >
                      <Text style={styles.popularPillBadgeText}>Most Popular</Text>
                    </View>
                  ) : null}
                  <View style={styles.tierTop}>
                    <View style={[
                      styles.tierIconWrap,
                      { backgroundColor: cfg.color + "1A", borderColor: cfg.color + "33" },
                    ]}>
                      <Ionicons name={cfg.icon} size={22} color={cfg.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tierName, { color: selected ? cfg.color : Colors.text }]}>
                        {cfg.label}
                      </Text>
                      <Text style={styles.tierPrice}>
                        {billing === "annual" ? cfg.annualPrice : cfg.monthlyPrice}
                      </Text>
                      {billing === "annual" && (
                        <Text style={styles.tierPriceSub}>{cfg.annualMonthly} · billed annually · save {savingsPctFor(cfg.monthlyPrice, cfg.annualPrice)}%</Text>
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
            <Text style={styles.scanLimitsText}>Free: 0 AI scans/month</Text>
            <Text style={styles.scanLimitsText}>Personal: 15 AI scans/month</Text>
            <Text style={styles.scanLimitsText}>Pro: 30 AI scans/month</Text>
            <Text style={styles.scanLimitsText}>Business: 100 AI scans/month</Text>
          </View>

          <Text style={styles.trialCalloutText}>
            14 days free · Full access · Manage in Settings
          </Text>

          {inlineError && (
            <View style={[
              styles.inlineErrorCard,
              inlineError.feedback === "warning" && styles.inlineWarningCard,
            ]}>
              <View style={styles.inlineErrorIcon}>
                <Ionicons
                  name={inlineError.feedback === "warning" ? "time-outline" : "alert-circle"}
                  size={18}
                  color={inlineError.feedback === "warning" ? Colors.accent : Colors.overdue}
                />
              </View>
              <View style={styles.inlineErrorTextBlock}>
                <Text style={styles.inlineErrorTitle}>{inlineError.title}</Text>
                <Text style={styles.inlineErrorMessage}>{inlineError.message}</Text>
              </View>
              {inlineError.actionLabel && inlineError.onAction && (
                <Pressable
                  style={({ pressed }) => [styles.inlineErrorAction, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={() => {
                    const action = inlineError.onAction;
                    clearPaywallError();
                    action?.();
                  }}
                >
                  <Text style={styles.inlineErrorActionText}>{inlineError.actionLabel}</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.ctaBtn,
              context ? { backgroundColor: verticalAccent(context.vertical) } : null,
              { opacity: pressed || isPurchasing ? 0.85 : 1 },
            ]}
            onPress={handlePurchase}
            disabled={isPurchasing || isRestoring || loadingOfferings}
            testID="paywall-cta"
            accessibilityLabel="Subscribe to plan"
            accessibilityRole="button"
          >
            {isPurchasing ? (
              <ActivityIndicator color={Colors.background} />
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
      <SaveToast
        visible={toastVisible}
        message={toastMessage}
        subtitle={toastSubtitle ?? undefined}
        isError={toastIsError}
      />
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
  tierWrapperPopular: { marginTop: 10 },
  popularPillBadge: {
    position: "absolute",
    top: -10,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    zIndex: 2,
  },
  popularPillBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: Colors.textInverse,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  popularLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    paddingLeft: 2,
  },
  tierIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  tierCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    overflow: "visible",
  },
  tierCardPopular: {
    padding: 20,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
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

  inlineErrorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.overdue,
    padding: 14,
  },
  inlineWarningCard: { borderColor: Colors.accent },
  inlineErrorIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
  },
  inlineErrorTextBlock: { flex: 1, gap: 3 },
  inlineErrorTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.text },
  inlineErrorMessage: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  inlineErrorAction: {
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineErrorActionText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.accent },

  offeringsErrorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  offeringsErrorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  offeringsErrorTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    textAlign: "center",
  },
  offeringsErrorText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  offeringsRetryBtn: {
    marginTop: 8,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  offeringsRetryText: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.textInverse },
});
