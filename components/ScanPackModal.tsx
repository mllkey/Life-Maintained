import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ScanPack {
  id: "scan_pack_10" | "scan_pack_25";
  title: string;
  scans: number;
  price: string;
  popular?: boolean;
}

const PACKS: ScanPack[] = [
  { id: "scan_pack_10", title: "10 scans", scans: 10, price: "$2.99" },
  { id: "scan_pack_25", title: "25 scans", scans: 25, price: "$4.99", popular: true },
];

interface ScanPackModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ScanPackModal({ visible, onClose, onSuccess }: ScanPackModalProps) {
  const insets = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  async function handlePurchase(pack: ScanPack) {
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

  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: botPad + 16 }]}>
        <View style={styles.handle} />

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

        {PACKS.map(pack => {
          const isPurchasing = purchasingId === pack.id;
          return (
            <Pressable
              key={pack.id}
              style={({ pressed }) => [
                styles.packCard,
                pack.popular && styles.packCardPopular,
                { opacity: pressed || (purchasingId !== null && !isPurchasing) ? 0.6 : 1 },
              ]}
              onPress={() => handlePurchase(pack)}
              disabled={purchasingId !== null}
              testID={`scan-pack-${pack.scans}`}
            >
              {pack.popular && (
                <View style={styles.bestValueBadge}>
                  <Text style={styles.bestValueText}>Save 40%</Text>
                </View>
              )}
              <View style={styles.packLeft}>
                <Ionicons name="receipt-outline" size={20} color={pack.popular ? Colors.accent : Colors.textSecondary} />
                <Text style={[styles.packTitle, pack.popular && { color: Colors.text }]}>{pack.title}</Text>
              </View>
              <View style={styles.packRight}>
                {isPurchasing ? (
                  <ActivityIndicator size="small" color={Colors.accent} />
                ) : (
                  <Text style={[styles.packPrice, pack.popular && { color: Colors.accent }]}>{pack.price}</Text>
                )}
              </View>
            </Pressable>
          );
        })}

        <Pressable
          style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={onClose}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>

        <SaveToast visible={toastVisible} message="Scans added to your account" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 4,
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
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
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
});
