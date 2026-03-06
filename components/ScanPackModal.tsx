import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
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
  { id: "scan_pack_10", title: "10 Additional Receipt Scans", scans: 10, price: "$2.99" },
  { id: "scan_pack_25", title: "25 Additional Receipt Scans", scans: 25, price: "$4.99", popular: true },
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

  async function handlePurchase(pack: ScanPack) {
    if (!user || Platform.OS === "web") {
      Alert.alert("Purchase on Mobile", "Use the iOS or Android app to purchase scan packs.");
      return;
    }
    setPurchasingId(pack.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const Purchases = (await import("react-native-purchases")).default;
      await Purchases.purchaseProduct(pack.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("monthly_scan_count")
        .eq("user_id", user.id)
        .single();

      const current = (profile as any)?.monthly_scan_count ?? 0;
      const newCount = Math.max(0, current - pack.scans);
      await supabase
        .from("profiles")
        .update({ monthly_scan_count: newCount })
        .eq("user_id", user.id);
      await refreshProfile();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToastVisible(true);
      setTimeout(() => {
        setToastVisible(false);
        onSuccess();
      }, 1200);
    } catch (err: any) {
      if (!err?.userCancelled) {
        Alert.alert("Purchase Failed", err?.message ?? "Something went wrong. Please try again.");
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
          <View>
            <Text style={styles.title}>Need More Scans?</Text>
            <Text style={styles.subtitle}>You've used all your receipt scans for this month</Text>
          </View>
        </View>

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

        <SaveToast visible={toastVisible} message="Scans added!" />
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
});
