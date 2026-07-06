import React, { useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";
import { PaidActionCTA } from "@/components/PaidActionCTA";
import { usePulse, S } from "@/components/Skeleton";
import { loadConsumableProducts, type LocalizedProduct } from "@/lib/revenuecat";

// Pack metadata (id, title, scan count, popularity). Price is loaded from
// StoreKit via loadConsumableProducts at modal-present time so users see
// localized currency and any App Store pricing changes propagate without
// a code change.
type ScanPackMeta = {
  id: "scan_pack_10" | "scan_pack_25";
  title: string;
  scans: number;
  popular?: boolean;
};

const PACK_META: ScanPackMeta[] = [
  { id: "scan_pack_10", title: "10 scans", scans: 10 },
  { id: "scan_pack_25", title: "25 scans", scans: 25, popular: true },
];

const PACK_IDS = PACK_META.map(p => p.id);

// Unit price shown beneath each pack total so "Best Value" is demonstrated,
// not just asserted. Falls back to a plain format if a currency is unsupported.
function formatPerScan(price: number, scans: number, currencyCode: string): string {
  const per = price / scans;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(per);
  } catch {
    return currencyCode + " " + per.toFixed(2);
  }
}

export type ScanPackModalHandle = {
  present: () => boolean;
  dismiss: () => void;
};

interface ScanPackModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default forwardRef<ScanPackModalHandle, ScanPackModalProps>(function ScanPackModal(
  { onClose, onSuccess },
  ref
) {
  const { user, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [products, setProducts] = useState<LocalizedProduct[] | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const skeletonAnim = usePulse();

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    const list = await loadConsumableProducts(PACK_IDS);
    setProducts(list);
    setProductsLoading(false);
  }, []);

  useImperativeHandle(ref, () => ({
    present: () => {
      const sheet = sheetRef.current;
      if (!sheet) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return false;
      }
      setPurchaseError(null);
      // Kick product load. If already loaded, refresh in background so
      // currency / price changes propagate the next time the sheet opens.
      loadProducts();
      sheet.present();
      return true;
    },
    dismiss: () => {
      sheetRef.current?.dismiss();
    },
  }), [loadProducts]);

  // Called by the sheet when its dismiss animation completes (pan-down,
  // backdrop tap, or programmatic dismiss). Sync parent state.
  const handleDismiss = useCallback(() => {
    setPurchaseError(null);
    onClose();
  }, [onClose]);

  // Block tap-to-dismiss while a purchase is in flight (StoreKit dialog +
  // RPC roundtrip ≈ 3-8s). Otherwise allow normal tap-outside-to-close.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior={purchasingId === null ? "close" : "none"}
      />
    ),
    [purchasingId]
  );

  const handleStyle = useMemo(
    () => ({
      backgroundColor: Colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    }),
    []
  );

  const handleIndicatorStyle = useMemo(
    () => ({ backgroundColor: Colors.border, width: 36, height: 4 }),
    []
  );

  const backgroundStyle = useMemo(
    () => ({ backgroundColor: Colors.card }),
    []
  );

  const snapPoints = useMemo(() => ["55%"], []);

  async function handlePurchase(pack: ScanPackMeta, _product: LocalizedProduct) {
    setPurchaseError(null);
    if (!user || Platform.OS === "web") {
      setPurchaseError("Open LifeMaintained on iPhone to buy a scan pack.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    setPurchasingId(pack.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const Purchases = (await import("react-native-purchases")).default;
      const purchaseResult = await Purchases.purchaseProduct(pack.id);

      // Pull StoreKit transaction id for idempotency.
      // Do NOT fall back to productIdentifier — two purchases of the same pack
      // would collide on the same key and the second purchase would be silently
      // ignored, taking the user's money without granting credits.
      const txId =
        (purchaseResult as any)?.transaction?.transactionIdentifier ??
        null;
      if (!txId || typeof txId !== "string") {
        throw new Error("Missing transaction id from purchase result");
      }

      const source = pack.id === "scan_pack_10" ? "pack_10" : "pack_25";
      const { data: rpcData, error: rpcErr } = await supabase.rpc("grant_scan_pack_credits", {
        p_user_id: user.id,
        p_source: source,
        p_transaction_id: txId,
        p_scans_granted: pack.scans,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message ?? "Failed to grant credits");
      }
      const rpc = (rpcData ?? {}) as { ok?: boolean; idempotent?: boolean; error?: string; credits_granted?: number };
      if (rpc.error) {
        throw new Error(`Credit grant failed: ${rpc.error}`);
      }

      await refreshProfile();

      setPurchaseError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToastVisible(true);
      setTimeout(() => {
        setToastVisible(false);
        sheetRef.current?.dismiss();
        onSuccess();
      }, 1200);
    } catch (err: any) {
      if (!err?.userCancelled) {
        if (__DEV__) console.error("Scan pack purchase failed:", err);
        setPurchaseError("Couldn't complete the purchase. No charge was made — try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      setPurchasingId(null);
    }
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      stackBehavior="replace"
      enablePanDownToClose={purchasingId === null}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleStyle={handleStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      onDismiss={handleDismiss}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.titleRow}>
          <View style={styles.titleIconWrap}>
            <Ionicons name="scan-outline" size={22} color={Colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>You're out of scans this month</Text>
            <Text style={styles.subtitle}>Pick up where you left off — credits never expire</Text>
          </View>
        </View>

        {purchaseError ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
            <Text style={styles.errorText}>{purchaseError}</Text>
          </View>
        ) : null}

        {purchasingId !== null ? (
          <View style={styles.processingCard}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.processingText}>Completing purchase… keep LifeMaintained open.</Text>
          </View>
        ) : null}

        {PACK_META.map(pack => {
          const isPurchasing = purchasingId === pack.id;
          const product = products?.find(p => p.identifier === pack.id);
          const isPriceReady = product !== undefined;
          const isCardDisabled = purchasingId !== null || !isPriceReady;
          return (
            <Pressable
              key={pack.id}
              style={({ pressed }) => [
                styles.packCard,
                pack.popular && styles.packCardPopular,
                { opacity: pressed || (purchasingId !== null && !isPurchasing) || !isPriceReady ? 0.6 : 1 },
              ]}
              onPress={() => {
                if (!product) return;
                handlePurchase(pack, product);
              }}
              disabled={isCardDisabled}
              testID={`scan-pack-${pack.scans}`}
              accessibilityRole="button"
              accessibilityLabel={product ? `${pack.title}, ${product.priceString}` : `${pack.title}, loading price`}
              accessibilityState={{ disabled: isCardDisabled, busy: isPurchasing }}
            >
              {pack.popular && (
                <View style={styles.bestValueBadge}>
                  <Text style={styles.bestValueText}>Best Value</Text>
                </View>
              )}
              <View style={styles.packLeft}>
                <Ionicons name="receipt-outline" size={20} color={pack.popular ? Colors.accent : Colors.textSecondary} />
                <Text style={[styles.packTitle, pack.popular && { color: Colors.text }]}>{pack.title}</Text>
              </View>
              <View style={styles.packRight}>
                {isPurchasing ? (
                  <ActivityIndicator size="small" color={Colors.accent} />
                ) : product ? (
                  <>
                    <Text style={[styles.packPrice, pack.popular && { color: Colors.accent }]}>{product.priceString}</Text>
                    <Text style={styles.packPerScan}>{formatPerScan(product.price, pack.scans, product.currencyCode)}/scan</Text>
                  </>
                ) : (
                  <S anim={skeletonAnim} w={56} h={18} r={6} />
                )}
              </View>
            </Pressable>
          );
        })}

        {products === null && !productsLoading ? (
          <Pressable
            onPress={loadProducts}
            style={({ pressed }) => [styles.retryRow, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Retry loading prices"
          >
            <Ionicons name="refresh" size={14} color={Colors.textSecondary} />
            <Text style={styles.retryText}>Couldn't load pricing — tap to retry</Text>
          </Pressable>
        ) : null}

        <PaidActionCTA
          label="Cancel"
          variant="secondary"
          onPress={() => {
            if (purchasingId !== null) return;
            sheetRef.current?.dismiss();
          }}
          disabled={purchasingId !== null}
          accessibilityLabel="Cancel scan pack purchase"
          testID="scan-pack-cancel"
        />

        <SaveToast visible={toastVisible} message="Scans added to your account" />
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  titleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.accentMuted,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  packCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
  },
  packCardPopular: {
    borderColor: Colors.accentMuted,
    backgroundColor: Colors.accentLight,
  },
  bestValueBadge: {
    position: "absolute",
    top: -8,
    right: 14,
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  bestValueText: { fontSize: 10, fontFamily: "Inter_700Bold", color: Colors.background },
  packLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  packTitle: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary, flex: 1 },
  packRight: { minWidth: 52, alignItems: "flex-end" },
  packPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.text },
  packPerScan: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.textTertiary, marginTop: 2 },
  errorCard: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.overdue,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.overdue,
    lineHeight: 18,
  },
  processingCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  processingText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    lineHeight: 18,
  },
  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
  },
  retryText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
});
