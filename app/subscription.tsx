import React from "react";
import { router, useLocalSearchParams } from "expo-router";
import Paywall, { type PaywallVertical, type PaywallReason } from "@/components/Paywall";

const VALID_VERTICALS = ["vehicle", "property", "family", "scans", "voice", "general"];
const VALID_REASONS = ["limit_reached", "feature_locked", "locked_existing", "general"];

function pickParam(value: string | string[] | undefined, allowed: string[], fallback: string): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && allowed.includes(v) ? v : fallback;
}

export default function SubscriptionScreen() {
  const { vertical, reason } = useLocalSearchParams<{ vertical?: string; reason?: string }>();
  const ctxVertical = pickParam(vertical, VALID_VERTICALS, "general") as PaywallVertical;
  const ctxReason = pickParam(reason, VALID_REASONS, "general") as PaywallReason;
  return (
    <Paywall
      canDismiss
      showSkip={false}
      context={{ vertical: ctxVertical, reason: ctxReason }}
      onDismiss={() => router.back()}
    />
  );
}
