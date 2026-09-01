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
import { Colors } from "@/constants/colors";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { capture as captureAnalytics } from "@/lib/analytics";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";
import { rcReady, extractTierHintFromCustomerInfo, syncSubscriptionFromRc } from "@/lib/revenuecat";
import {
  vehicleLimit,
  propertyLimit,
  personLimit,
  petLimit,
  scanLimit,
  type Profile as SubscriptionProfile,
} from "@/lib/subscription";
import { voiceCapPerDay } from "@/lib/voiceQuota";

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
  icon: IconName;
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

// "person" and "pet" are preselection-only refinements of "family": they let
// the Paywall know WHICH family limit blocked the user, because personLimit and
// petLimit do not move at the same tier. "family" is retained for compatibility
// and behaves exactly as before. Everything the user sees or that analytics
// records treats person/pet as family — see displayVertical.
export type PaywallVertical = "vehicle" | "property" | "family" | "person" | "pet" | "scans" | "voice" | "general";
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

/**
 * Collapses the preselection-only verticals back onto the surface they belong
 * to. Every consumer that a user can see — accent color, default subtitle — and
 * the analytics payload go through this, so introducing person/pet changes
 * nothing observable; only tier preselection reads the refined value.
 */
function displayVertical(vertical: PaywallVertical): PaywallVertical {
  if (vertical === "person" || vertical === "pet") return "family";
  return vertical;
}

// Per-vertical accent color for the primary CTA and contextual subtitle tint.
function verticalAccent(rawVertical: PaywallVertical): string {
  const vertical = displayVertical(rawVertical);
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
  const vertical = displayVertical(ctx.vertical);
  if (ctx.reason === "locked_existing") {
    if (vertical === "vehicle") return "Unlock your other vehicles";
    if (vertical === "property") return "Unlock your other properties";
    if (vertical === "family") return "Unlock your other family members";
    return "Unlock everything you have";
  }
  if (ctx.reason === "limit_reached") {
    if (vertical === "vehicle") return "Upgrade to add more vehicles";
    if (vertical === "property") return "Upgrade to add more properties";
    if (vertical === "family") return "Upgrade to add more family members";
    if (vertical === "scans") return "Upgrade for more receipt scans";
    if (vertical === "voice") return "Upgrade for more voice logging";
    return "Upgrade to keep going";
  }
  if (ctx.reason === "feature_locked") {
    if (vertical === "vehicle") return "Upgrade to export your service history";
    if (vertical === "scans") return "Upgrade to scan receipts with AI";
    return "Upgrade to unlock this";
  }
  return "Choose the plan that fits your life";
}

type PaywallProfile = {
  subscription_tier: string | null;
  subscription_expires_at?: string | null;
  trial_expires_at?: string | null;
};

function isFutureDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function activeTierForPaywall(profile: PaywallProfile | null | undefined): TierKey | null {
  const tier = profile?.subscription_tier;
  if (tier !== "personal" && tier !== "pro" && tier !== "business") return null;
  if (isFutureDate(profile?.trial_expires_at) || isFutureDate(profile?.subscription_expires_at)) {
    return tier;
  }
  return null;
}

/** Price order. The first qualifying candidate is therefore the cheapest one. */
const TIER_LADDER: TierKey[] = ["personal", "pro", "business"];

const FAR_FUTURE_ISO = "9999-12-31T00:00:00.000Z";

/**
 * A synthetic profile that reads as exactly `tier` to the read-only limit
 * authorities (null = no active paid tier, i.e. free). This is how the ladder
 * asks "what would this tier grant me?" without this file ever restating a
 * limit number — lib/subscription.ts and lib/voiceQuota.ts stay the only
 * places those numbers live.
 */
function probeProfileForTier(tier: TierKey | null): SubscriptionProfile {
  return {
    subscription_tier: tier,
    trial_started_at: null,
    trial_expires_at: null,
    subscription_expires_at: tier ? FAR_FUTURE_ISO : null,
    revenuecat_customer_id: null,
    push_token: null,
    monthly_scan_count: 0,
    scan_count_reset_at: null,
    onboarding_completed: true,
    terms_accepted_at: null,
    terms_version: null,
  };
}

/**
 * The limit that `vertical` imposes at `tier`, or null when the vertical does
 * not map to a known capability — in which case the caller preserves the
 * legacy rank-based answer rather than guessing.
 */
function limitForVertical(vertical: PaywallVertical, tier: TierKey | null): number | null {
  const probe = probeProfileForTier(tier);
  if (vertical === "vehicle") return vehicleLimit(probe);
  if (vertical === "property") return propertyLimit(probe);
  if (vertical === "person") return personLimit(probe);
  if (vertical === "pet") return petLimit(probe);
  if (vertical === "scans") return scanLimit(probe);
  if (vertical === "voice") return voiceCapPerDay(probe);
  return null;
}

/**
 * The pre-G6.12 rank-based answer. Retained verbatim as the fallback for every
 * case capability selection cannot improve on: non-limit reasons, unknown or
 * legacy verticals, trial, and any vertical where no higher tier actually
 * raises the limit. Keeping it intact is what makes the change provably
 * neutral everywhere except the person cap.
 */
function legacyPreselectedTierFor(
  profile: PaywallProfile | null | undefined,
  isLimitContext: boolean,
): TierKey {
  if (isFutureDate(profile?.trial_expires_at) && profile?.subscription_tier === "trial") {
    return isLimitContext ? "business" : "personal";
  }

  const current = activeTierForPaywall(profile);
  if (!current) return "personal";
  if (isLimitContext) {
    if (current === "personal") return "pro";
    if (current === "pro") return "business";
  }
  return current;
}

/**
 * Capability-aware preselection.
 *
 * Ranking alone was wrong: it assumed the next tier up always raises the limit
 * that blocked you. personLimit is 1 on both Free and Personal, so a free user
 * at the one-person cap was preselected Personal and could pay while staying
 * blocked. The ladder now asks each tier what it would actually grant for the
 * blocking vertical and takes the cheapest one that strictly beats what the
 * user already has.
 */
function preselectedTierFor(
  profile: PaywallProfile | null | undefined,
  context: PaywallContext | undefined,
): TierKey {
  const isLimitContext = context?.reason === "limit_reached" || context?.reason === "locked_existing";
  const legacy = legacyPreselectedTierFor(profile, isLimitContext);

  if (!isLimitContext) return legacy;
  if (!context) return legacy;

  // Trial keeps its existing mapping to Business by contract; no capability
  // probe can improve on the top tier anyway.
  if (isFutureDate(profile?.trial_expires_at) && profile?.subscription_tier === "trial") return legacy;

  const current = activeTierForPaywall(profile);
  const currentLimit = limitForVertical(context.vertical, current);
  if (currentLimit === null) return legacy;

  const currentRank = current ? tierRank(current) : 0;
  for (const candidate of TIER_LADDER) {
    if (tierRank(candidate) <= currentRank) continue;
    const candidateLimit = limitForVertical(context.vertical, candidate);
    // Infinity beats every finite limit, so unlimited tiers qualify naturally.
    if (candidateLimit !== null && candidateLimit > currentLimit) return candidate;
  }
  return legacy;
}

function tierRank(tier: TierKey): number {
  if (tier === "personal") return 1;
  if (tier === "pro") return 2;
  return 3;
}

function purchaseCtaLabel(
  selectedTier: TierKey,
  profile: PaywallProfile | null | undefined,
): string {
  const selectedLabel = TIER_CONFIG[selectedTier].label;
  if (isFutureDate(profile?.trial_expires_at)) return `Choose ${selectedLabel}`;
  const current = activeTierForPaywall(profile);
  if (!current) return `Continue with ${selectedLabel}`;
  if (tierRank(selectedTier) > tierRank(current)) return `Upgrade to ${selectedLabel}`;
  if (tierRank(selectedTier) < tierRank(current)) return `Switch to ${selectedLabel}`;
  return `Continue with ${selectedLabel}`;
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
  const [selectedTier, setSelectedTier] = useState<TierKey>(context ? preselectedTierFor(profile, context) : "personal");
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
  const [toastMessage, setToastMessage] = useState("Your plan is active.");
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
      // Normalized so person/pet keep reporting as family — existing funnels
      // keyed on context_vertical stay comparable across this change.
      context_vertical: context ? displayVertical(context.vertical) : undefined,
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
          setToastMessage(`${TIER_CONFIG[tier].label} is active.`);
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
            setToastMessage(`${TIER_CONFIG[tier].label} is active.`);
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
  const currentPaywallTier = activeTierForPaywall(profile);
  const hasActiveTrial = isFutureDate(profile?.trial_expires_at);
  const purchaseLabel = purchaseCtaLabel(selectedTier, profile);
  const planCallout = hasActiveTrial
    ? "Your free trial is active · Manage in Settings"
    : currentPaywallTier
      ? "Manage your plan anytime in Settings"
      : "14-day free trial for eligible new subscribers";

  if (Platform.OS === "web") {
    return (
      <View style={[styles.webFallback, { paddingTop: topPad + 16, paddingBottom: botPad + 16 }]}>
        {canDismiss && (
          <Pressable style={styles.closeBtn} onPress={onDismiss}>
            <Icon name="close" size={22} color={Colors.text} />
          </Pressable>
        )}
        <View style={styles.webFallbackInner}>
          <Icon name="phone-portrait-outline" size={48} color={Colors.accent} />
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
            <Icon name="close" size={22} color={Colors.text} />
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
            <Icon name="cloud-offline-outline" size={30} color={Colors.accent} />
          </View>
          <Text style={styles.offeringsErrorTitle}>Couldn&apos;t load plans</Text>
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
                      <Icon name={cfg.icon} size={22} color={cfg.color} />
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
            {planCallout}
          </Text>

          {inlineError && (
            <View style={[
              styles.inlineErrorCard,
              inlineError.feedback === "warning" && styles.inlineWarningCard,
            ]}>
              <View style={styles.inlineErrorIcon}>
                <Icon
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
            accessibilityLabel={purchaseLabel}
            accessibilityRole="button"
          >
            {isPurchasing ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <Text style={styles.ctaBtnText}>{purchaseLabel}</Text>
            )}
          </Pressable>

          <Text style={styles.legalText}>
            Billed through the App Store · Cancel anytime
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
                  <Icon
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
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center", gap: 4 },
  headerTitle: { ...Typography.title2, color: Colors.text },
  headerSubtitle: { ...Typography.footnote, color: Colors.textSecondary, textAlign: "center" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },

  // Billing toggle — segmented control
  billingToggle: {
    flexDirection: "row",
    borderRadius: Radius.lg,
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
  billingLabel: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  billingLabelActive: { fontWeight: "600", color: Colors.textInverse },
  saveText: { ...Typography.caption, fontWeight: "600", color: Colors.accent },
  saveTextActive: { color: Colors.textInverse },

  // Tier cards
  tierWrapper: { gap: 4 },
  tierWrapperPopular: { marginTop: 12 },
  popularPillBadge: {
    position: "absolute",
    top: -10,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    zIndex: 2,
  },
  popularPillBadgeText: {
    ...Typography.caption,
    fontWeight: "700",
    color: Colors.textInverse,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  popularLabel: {
    ...Typography.caption,
    fontWeight: "600",
    paddingLeft: 2,
  },
  tierIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  tierCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    overflow: "visible",
  },
  tierCardPopular: {
    padding: 20,
    borderWidth: 1.5,
    backgroundColor: Colors.cardElevated,
  },
  tierTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  tierName: { ...Typography.headline, fontWeight: "700", marginBottom: 4 },
  tierPrice: { ...Typography.title2, color: Colors.text },
  tierPriceSub: { ...Typography.footnote, color: Colors.textSecondary, marginTop: 2 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  radioInner: { width: 10, height: 10, borderRadius: Radius.pill },
  tierFeatures: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureBullet: { ...Typography.footnote, color: Colors.textSecondary, width: 10 },
  featureText: { ...Typography.footnote, color: Colors.textSecondary, flex: 1 },

  scanLimitsBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  scanLimitsTitle: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  scanLimitsText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },

  trialCalloutText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  ctaBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnText: { ...Typography.subheadline, fontWeight: "700", color: Colors.textInverse },
  legalText: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: -8,
  },
  skipBtn: { alignItems: "center", paddingVertical: 4 },
  skipText: { ...Typography.footnote, color: Colors.textSecondary },
  restoreBtn: { alignItems: "center", paddingVertical: 8 },
  restoreText: { ...Typography.footnote, color: Colors.textTertiary },
  promoToggle: { alignItems: "center", paddingVertical: 4 },
  promoToggleText: { ...Typography.subheadline, fontWeight: "500", color: Colors.textSecondary },
  promoSection: { gap: 8, marginTop: -4 },
  promoRow: { flexDirection: "row", gap: 8 },
  promoInput: {
    ...Typography.subheadline,
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: Colors.text,
  },
  promoApplyBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    justifyContent: "center",
    minWidth: 64,
    alignItems: "center",
  },
  promoApplyText: { ...Typography.subheadline, fontWeight: "600", color: Colors.background },
  promoFeedback: { flexDirection: "row", alignItems: "center", gap: 8 },
  promoFeedbackText: { ...Typography.footnote },
  webFallback: { flex: 1, backgroundColor: Colors.background, position: "relative" },
  webFallbackInner: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  webFallbackTitle: { ...Typography.title3, fontWeight: "700", color: Colors.text },
  webFallbackSub: { ...Typography.footnote, color: Colors.textSecondary, textAlign: "center" },

  inlineErrorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.overdue,
    padding: 16,
  },
  inlineWarningCard: { borderColor: Colors.accent },
  inlineErrorIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
  },
  inlineErrorTextBlock: { flex: 1, gap: 4 },
  inlineErrorTitle: { ...Typography.footnote, fontWeight: "700", color: Colors.text },
  inlineErrorMessage: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  inlineErrorAction: {
    alignSelf: "center",
    borderRadius: Radius.pill,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineErrorActionText: { ...Typography.footnote, fontWeight: "700", color: Colors.accent },

  offeringsErrorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  offeringsErrorIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  offeringsErrorTitle: {
    ...Typography.title2,
    color: Colors.text,
    textAlign: "center",
  },
  offeringsErrorText: {
    ...Typography.subheadline,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  offeringsRetryBtn: {
    marginTop: 8,
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  offeringsRetryText: { ...Typography.subheadline, fontWeight: "700", color: Colors.textInverse },
});
