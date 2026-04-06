import React, { useState } from "react";
import { TouchableOpacity, Text, Alert, ActivityIndicator, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Colors } from "@/constants/colors";
import {
  scanReceipt,
  ReceiptScanResult,
  ReceiptAssetType,
  ReceiptScanSource,
} from "../lib/receiptScanner";

interface Props {
  assetType: ReceiptAssetType;
  assetId: string;
  onScanComplete: (result: ReceiptScanResult) => void;
  onScanLimitReached?: () => void;
}

export default function ReceiptScanButton({ assetType, assetId, onScanComplete, onScanLimitReached }: Props) {
  const [scanning, setScanning] = useState(false);

  const handleScan = async (useCamera: boolean) => {
    const source: ReceiptScanSource = useCamera ? "camera" : "photo_library";

    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Camera access is required to scan receipts.");
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

        if (isScanLimit && onScanLimitReached) {
          Alert.alert(
            "Scan Limit Reached",
            `You've used all ${result.scans_limit} scans this month. Upgrade your plan for more.`,
            [
              { text: "Upgrade", onPress: onScanLimitReached },
              { text: "Enter Manually", style: "cancel" },
            ]
          );
          return;
        }

        Alert.alert(
          "Scan Issue",
          result.error || "We couldn't read all fields automatically. You can fill in the remaining fields manually."
        );
      }

      onScanComplete(withUri);
    } catch (err) {
      console.error("Receipt scan error:", err);
      Alert.alert("Scan Failed", "Something went wrong scanning the receipt. Please enter the details manually.");
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
    <TouchableOpacity style={styles.button} onPress={showOptions}>
      <Text style={styles.buttonText}>📷 Scan Receipt</Text>
    </TouchableOpacity>
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
