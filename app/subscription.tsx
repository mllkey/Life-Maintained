import React from "react";
import { router } from "expo-router";
import Paywall from "@/components/Paywall";

export default function SubscriptionScreen() {
  return (
    <Paywall
      canDismiss
      showSkip={false}
      onDismiss={() => router.back()}
    />
  );
}
