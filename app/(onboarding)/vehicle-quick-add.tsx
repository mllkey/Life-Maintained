import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  Modal, FlatList, ActivityIndicator, Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { inferTrackingMode } from "@/lib/vehicleTypes";

const QUICK_TYPES = [
  { value: "car", label: "Car / Truck / SUV", icon: "car", defaultFuel: "gas" as const },
  { value: "motorcycle", label: "Motorcycle", icon: "motorbike", defaultFuel: "gas" as const },
  { value: "boat", label: "Boat / PWC", icon: "sail-boat", defaultFuel: "gas" as const },
  { value: "lawnmower", label: "Equipment", icon: "flower-outline", defaultFuel: "gas" as const },
  { value: "trailer", label: "Trailer / Other", icon: "swap-horizontal-outline", defaultFuel: "gas" as const },
];

const FUEL_OPTIONS: { value: string; label: string }[] = [
  { value: "gas", label: "Gas" },
  { value: "diesel", label: "Diesel" },
  { value: "hybrid", label: "Hybrid" },
  { value: "ev", label: "Electric" },
];

// Show fuel picker only for these types
const SHOW_FUEL_FOR = new Set(["car", "motorcycle"]);

const POPULAR_MAKES: Record<string, string[]> = {
  car: ["Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia", "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Nissan", "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo"],
  motorcycle: ["BMW", "Ducati", "Harley-Davidson", "Honda", "Indian", "Kawasaki", "KTM", "Royal Enfield", "Suzuki", "Triumph", "Yamaha"],
  boat: ["Bayliner", "Boston Whaler", "Grady-White", "MasterCraft", "Sea Ray", "Tracker", "Yamaha"],
  lawnmower: ["Deere", "Honda", "Husqvarna", "Stihl", "Toro"],
  trailer: ["Big Tex", "Carry-On", "PJ Trailers", "Sure-Trac"],
};

const SKIP_NHTSA = new Set(["boat", "lawnmower", "trailer"]);

export default function VehicleQuickAddScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [vehicleType, setVehicleType] = useState("car");
  const [fuelType, setFuelType] = useState("gas");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [usage, setUsage] = useState("");
  const [makePickerVisible, setMakePickerVisible] = useState(false);
  const [makeSearch, setMakeSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const trackingMode = inferTrackingMode(vehicleType);
  const isHours = trackingMode === "hours";
  const isTimeOnly = trackingMode === "time_only";
  const showFuel = SHOW_FUEL_FOR.has(vehicleType);

  const availableMakes = POPULAR_MAKES[vehicleType] ?? POPULAR_MAKES.car;
  const filteredMakes = useMemo(() => {
    if (!makeSearch) return availableMakes;
    return availableMakes.filter(m => m.toLowerCase().includes(makeSearch.toLowerCase()));
  }, [makeSearch, availableMakes]);

  const canGenerate = year.length === 4 && make.trim().length > 0 && model.trim().length > 0;

  async function handleGenerate() {
    if (!canGenerate || !user || isLoading) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const yearNum = parseInt(year, 10);
      const inferredMode = inferTrackingMode(vehicleType);
      const parsedUsage = usage ? parseFloat(usage.replace(/,/g, "")) : 0;

      const vehicleData: Record<string, unknown> = {
        user_id: user.id,
        year: yearNum,
        make: make.trim(),
        model: model.trim(),
        vehicle_type: vehicleType,
        vehicle_category: vehicleType,
        fuel_type: showFuel ? fuelType : "gas",
        tracking_mode: inferredMode,
        mileage: !isHours ? (parsedUsage !== 0 ? parsedUsage || null : 0) : null,
        hours: isHours ? (parsedUsage !== 0 ? parsedUsage || null : 0) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: inserted, error: err } = await supabase
        .from("vehicles")
        .insert(vehicleData)
        .select("id")
        .single();

      if (err || !inserted) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setIsLoading(false);
        return;
      }

      // Use push so user can go back to edit if needed
      router.push({
        pathname: "/(onboarding)/building-plan",
        params: {
          vehicleId: inserted.id,
          vehicleName: `${yearNum} ${make.trim()} ${model.trim()}`,
          make: make.trim(),
          model: model.trim(),
          year: String(yearNum),
          currentMileage: String(!isHours ? parsedUsage : 0),
          currentHours: String(isHours ? parsedUsage : 0),
          trackingMode: inferredMode,
          // CRITICAL: vehicle_type in the invoke body = fuelType, NOT category
          fuelType: showFuel ? fuelType : "gas",
          vehicleCategory: vehicleType,
        },
      });
    } catch (e) {
      if (__DEV__) console.error("[onboarding] vehicle save error:", e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back + Progress */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={Colors.text} />
            </Pressable>
            <View style={[styles.progressBar, { flex: 1 }]}>
              <View style={[styles.progressFill, { width: "50%" }]} />
            </View>
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Tell us about your vehicle</Text>
            <Text style={styles.subtitle}>Only the essentials. You can add details later.</Text>
          </View>

          {/* Vehicle Type */}
          <View style={styles.section}>
            <Text style={styles.label}>Type</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {QUICK_TYPES.map(t => {
                const sel = vehicleType === t.value;
                return (
                  <Pressable
                    key={t.value}
                    style={[styles.typeChip, sel && styles.typeChipSelected]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setVehicleType(t.value);
                      setFuelType(t.defaultFuel);
                      setMake("");
                      setModel("");
                    }}
                  >
                    <MaterialCommunityIcons name={t.icon as never} size={18} color={sel ? Colors.accent : Colors.textSecondary} />
                    <Text style={[styles.typeChipText, sel && { color: Colors.accent }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Fuel Type — only for cars and motorcycles */}
          {showFuel && (
            <View style={styles.section}>
              <Text style={styles.label}>Fuel / Powertrain</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {FUEL_OPTIONS.map(f => {
                  const sel = fuelType === f.value;
                  return (
                    <Pressable
                      key={f.value}
                      style={[styles.typeChip, sel && styles.typeChipSelected]}
                      onPress={() => { Haptics.selectionAsync(); setFuelType(f.value); }}
                    >
                      <Text style={[styles.typeChipText, sel && { color: Colors.accent }]}>{f.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Year */}
          <View style={styles.section}>
            <Text style={styles.label}>Year</Text>
            <TextInput
              style={styles.input}
              value={year}
              onChangeText={t => setYear(t.replace(/\D/g, "").slice(0, 4))}
              placeholder="e.g. 2019"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              maxLength={4}
              returnKeyType="done"
            />
          </View>

          {/* Make */}
          <View style={styles.section}>
            <Text style={styles.label}>Make</Text>
            <Pressable style={styles.pickerBtn} onPress={() => { setMakeSearch(""); setMakePickerVisible(true); }}>
              <Text style={make ? styles.pickerValue : styles.pickerPlaceholder}>
                {make || "Select make"}
              </Text>
              <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
            </Pressable>
          </View>

          {/* Model */}
          <View style={styles.section}>
            <Text style={styles.label}>Model</Text>
            <TextInput
              style={styles.input}
              value={model}
              onChangeText={setModel}
              placeholder={SKIP_NHTSA.has(vehicleType) ? "e.g. Model name" : "e.g. Camry"}
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>

          {/* Mileage / Hours */}
          {!isTimeOnly && (
            <View style={styles.section}>
              <Text style={styles.label}>{isHours ? "Current Engine Hours" : "Current Mileage"}</Text>
              <TextInput
                style={styles.input}
                value={usage}
                onChangeText={setUsage}
                placeholder={isHours ? "e.g. 250" : "e.g. 52,000"}
                placeholderTextColor={Colors.textTertiary}
                keyboardType={isHours ? "decimal-pad" : "number-pad"}
                returnKeyType="done"
              />
            </View>
          )}

          {/* Generate CTA */}
          <Pressable
            style={[styles.cta, !canGenerate && styles.ctaDisabled]}
            onPress={handleGenerate}
            disabled={!canGenerate || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#0C111B" />
            ) : (
              <Text style={styles.ctaText}>Generate my plan</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.back()} style={styles.skip}>
            <Text style={styles.skipText}>Skip vehicle for now</Text>
          </Pressable>
        </ScrollView>

        {/* Make Picker Modal */}
        <Modal visible={makePickerVisible} transparent animationType="slide" onRequestClose={() => setMakePickerVisible(false)}>
          <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <Pressable style={styles.modalBackdrop} onPress={() => setMakePickerVisible(false)} />
            <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16, maxHeight: "70%" }]}>
              <View style={styles.modalHandle} />
              <TextInput
                style={styles.modalSearch}
                value={makeSearch}
                onChangeText={setMakeSearch}
                placeholder="Search makes..."
                placeholderTextColor={Colors.textTertiary}
                autoFocus
                returnKeyType="search"
                {...(Platform.OS === "ios" ? { clearButtonMode: "while-editing" as const } : {})}
              />
              <FlatList
                data={filteredMakes}
                keyExtractor={m => m}
                keyboardShouldPersistTaps="handled"
                style={{ flexShrink: 1 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.modalRow}
                    onPress={() => { Haptics.selectionAsync(); setMake(item); setMakePickerVisible(false); }}
                  >
                    <Text style={styles.modalRowText}>{item}</Text>
                  </Pressable>
                )}
                ListFooterComponent={
                  makeSearch.trim().length > 0 ? (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => { setMake(makeSearch.trim()); setMakePickerVisible(false); }}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
                      <Text style={[styles.modalRowText, { color: Colors.accent }]}>Use &quot;{makeSearch.trim()}&quot;</Text>
                    </Pressable>
                  ) : null
                }
              />
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 20, gap: 20 },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.accent },
  header: { gap: 6 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  section: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, height: 48, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text,
  },
  pickerBtn: {
    backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  pickerValue: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  pickerPlaceholder: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  typeChipSelected: { borderColor: Colors.accent, backgroundColor: "rgba(232,147,58,0.08)" },
  typeChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", marginTop: 4 },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#0C111B" },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 12 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 12 },
  modalSearch: {
    backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 14, height: 44,
    fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text, marginBottom: 8,
  },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalRowText: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
});
