import React, { useState } from "react";
import { TouchableOpacity, Text, Alert, ActivityIndicator, StyleSheet, View } from "react-native";
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
  scansRemaining: number;
}

export default function ReceiptScanButton({ assetType, assetId, onScanComplete, onScanLimitReached, onPaidUserAtCap, scansRemaining }: Props) {
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

    const fireCapHandler = async () => {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}
      if (onPaidUserAtCap) {
        onPaidUserAtCap();
      } else if (onScanLimitReached) {
        onScanLimitReached();
      }
    };

    // Fast path: prop already shows no scans left -- gate instantly, no network.
    if (scansRemaining <= 0) {
      await fireCapHandler();
      return;
    }

    // Authoritative pre-pick gate: receipt_scans rows are source of truth, not
    // the legacy profile counter. Confirm live quota BEFORE the picker + AI
    // roundtrip so a capped paid user is routed to top-up instantly. On a null
    // result (network hiccup) we do NOT block -- the post-scan server branch
    // remains the backstop, so a paying user is never falsely blocked.
    const live = await getLiveScanQuota();
    if (live && live.scans_remaining <= 0) {
      await fireCapHandler();
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
        const isScanLimit = result.scans_used != null && result.scans_limit != null && result.scans_used >= result.scans_limit;

        if (isScanLimit) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          const handler = onPaidUserAtCap ?? onScanLimitReached;
          if (handler) {
            handler();
            return;
          }
          showToast("Scan limit reached", "You can enter the receipt manually for now.");
          return;
        }

        showToast("Scan needs review", result.error || "We filled what we could. Review the fields below.");
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
      <TouchableOpacity style={styles.button} onPress={showOptions}>
        <Text style={styles.buttonText}>📷 Scan Receipt</Text>
      </TouchableOpacity>
      <SaveToast visible={toastVisible} message={toastMessage} subtitle={toastSubtitle ?? undefined} isError={toastIsError} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
    marginVertical: 8,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  scanningContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  scanningText: { color: Colors.accent, fontSize: 14 },
});
