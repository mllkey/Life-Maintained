import React, { useState } from "react";
import { Pressable, Text, Alert, ActivityIndicator, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { SaveToast } from "@/components/SaveToast";
import { capture } from "@/lib/analytics";
import {
  scanReceipt,
  ReceiptScanResult,
  ReceiptAssetType,
  ReceiptScanSource,
} from "../lib/receiptScanner";
import { getLiveScanQuota } from "../lib/subscription";

interface Props {
  assetType: ReceiptAssetType;
  assetId: string;
  onScanComplete: (result: ReceiptScanResult) => void;
  /** Free-tier or unknown-tier user hits cap — caller typically opens Paywall. */
  onScanLimitReached?: () => void;
  /** Paid user hits cap — caller typically opens ScanPackModal. */
  onPaidUserAtCap?: () => void;
}

export default function ReceiptScanButton({ assetType, assetId, onScanComplete, onScanLimitReached, onPaidUserAtCap }: Props) {
  const [scanning, setScanning] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastSubtitle, setToastSubtitle] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(true);

  function showToast(message: string, subtitle?: string, isError = true) {
    setToastMessage(message);
    setToastSubtitle(subtitle ?? null);
    setToastIsError(isError);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2600);
  }

  const handleScan = async (useCamera: boolean) => {

    // Route a capped user to the correct CTA. toPackModal=true -> Scan Pack modal
    // (active subscriber out of monthly + credits); false -> Paywall (no active sub).
    // Mirrors the server's quota_exceeded vs subscription_required split so the local
    // gate and the post-reserve error_code branch can never disagree.
    const routeCap = async (toPackModal: boolean) => {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      if (toPackModal && onPaidUserAtCap) { onPaidUserAtCap(); return; }
      if (onScanLimitReached) { onScanLimitReached(); return; }
      if (onPaidUserAtCap) { onPaidUserAtCap(); return; }
      showToast(toPackModal ? "Out of scans" : "Upgrade required", "You can enter the receipt manually for now.");
    };

    // Authoritative pre-pick gate: get_scan_quota is the single credit-aware source of
    // truth — scans_remaining already includes spendable pack credits, so a capped user
    // WITH credits passes and reaches reserve. Only when nothing remains do we route:
    // a TRIAL user at cap -> Paywall (convert them, never sell a consumable); an active
    // paid subscriber (scans_limit > 0) out of monthly + credits -> Scan Packs; a user
    // with no active subscription (scans_limit <= 0) -> Paywall. Mirrors the server split
    // plus the trial-conversion override. Null result (network hiccup) does NOT block —
    // the post-reserve error_code branch is the backstop.
    const live = await getLiveScanQuota();
    if (live && live.scans_remaining <= 0) {
      await routeCap(live.tier !== "trial" && live.scans_limit > 0);
      return;
    }
    const source: ReceiptScanSource = useCamera ? "camera" : "photo_library";

    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          showToast("Camera access is off", "Allow camera access in Settings to scan receipts.");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          return;
        }
      }

      const pickerResult = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false })
        : await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ["images"] });

      if (pickerResult.canceled || !pickerResult.assets?.[0]?.uri) {
        return;
      }

      setScanning(true);

      const manipulated = await ImageManipulator.manipulateAsync(
        pickerResult.assets[0].uri,
        [{ resize: { width: 2400 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!manipulated.base64) {
        throw new Error("Failed to process image");
      }

      const result = await scanReceipt(manipulated.base64, assetType, assetId, source);
      const withUri = { ...result, localUri: manipulated.uri };

      if (result.error) {
        // Route strictly off the server's machine code via the same routeCap seam as
        // the pre-pick gate — never off scans_used arithmetic. A trial user who hits the
        // cap goes to Paywall (convert), not Scan Packs, using the tier from the cached
        // pre-pick quota read.
        if (result.error_code === "quota_exceeded") {
          // If the pre-pick quota read was null (network hiccup), re-read tier so a
          // trial user at cap still routes to Paywall, not Scan Packs.
          const capTier = live?.tier ?? (await getLiveScanQuota())?.tier;
          await routeCap(capTier !== "trial");
          return;
        }
        if (result.error_code === "subscription_required") { await routeCap(false); return; }
        // Non-cap error. Be honest: only claim we filled fields if we actually did.
        const filledSomething =
          result.date != null || result.cost != null || result.provider != null ||
          result.mileage != null || result.serviceType != null || result.task != null;
        showToast(
          filledSomething ? "Scan needs review" : "Couldn't read that receipt",
          filledSomething
            ? "We filled what we could. Review the fields below."
            : (result.error || "Enter the details manually for now."),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }

      capture("scan_completed", {
        asset_type: assetType,
        asset_id: assetId,
        source: source ? "camera" : "library",
      });
      onScanComplete(withUri);
    } catch (err) {
      console.error("Receipt scan error:", err);
      showToast("Scan failed", "Enter the details manually for now.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setScanning(false);
    }
  };

  const showOptions = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert("Scan Receipt", "How would you like to add a receipt?", [
      { text: "Take Photo", onPress: () => handleScan(true) },
      { text: "Choose from Library", onPress: () => handleScan(false) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  if (scanning) {
    return (
      <View style={styles.scanningContainer}>
        <ActivityIndicator size="small" color={Colors.accent} />
        <Text style={styles.scanningText}>Scanning receipt...</Text>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
        onPress={showOptions}
        accessibilityRole="button"
        accessibilityLabel="Scan a receipt"
      >
        <Ionicons name="scan-outline" size={18} color={Colors.textInverse} />
        <Text style={styles.buttonText}>Scan Receipt</Text>
      </Pressable>
      <SaveToast visible={toastVisible} message={toastMessage} subtitle={toastSubtitle ?? undefined} isError={toastIsError} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: 14,
    marginVertical: 8,
  },
  buttonText: { color: Colors.textInverse, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  scanningContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  scanningText: { color: Colors.accent, fontSize: 14, fontFamily: "Inter_500Medium" },
});
