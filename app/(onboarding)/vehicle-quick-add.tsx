import React, { useState, useMemo, useEffect } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  Modal, FlatList, ActivityIndicator, Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { inferTrackingMode } from "@/lib/vehicleTypes";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS: number[] = Array.from({ length: CURRENT_YEAR + 2 - 1980 }, (_, i) => CURRENT_YEAR + 1 - i);
const YEAR_ITEM_HEIGHT = 52;
const MODEL_ITEM_HEIGHT = 52;

const modelCache = new Map<string, string[]>();
function modelCacheKey(make: string, year: string, vType: string): string {
  return `${make.trim().toLowerCase()}:${year}:${vType}`;
}

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

  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [nhtsaModels, setNhtsaModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelLoadFailed, setModelLoadFailed] = useState(false);

  const trackingMode = inferTrackingMode(vehicleType);
  const isHours = trackingMode === "hours";
  const isTimeOnly = trackingMode === "time_only";
  const showFuel = SHOW_FUEL_FOR.has(vehicleType);

  const availableMakes = POPULAR_MAKES[vehicleType] ?? POPULAR_MAKES.car;
  const filteredMakes = useMemo(() => {
    if (!makeSearch) return availableMakes;
    return availableMakes.filter(m => m.toLowerCase().includes(makeSearch.toLowerCase()));
  }, [makeSearch, availableMakes]);

  const filteredModels = useMemo(() => {
    const q = modelSearch.toLowerCase().trim();
    if (!q) return nhtsaModels;
    return nhtsaModels.filter(m => m.toLowerCase().includes(q));
  }, [modelSearch, nhtsaModels]);

  const showCustomModel =
    modelSearch.trim().length > 0 &&
    !nhtsaModels.some(m => m.toLowerCase() === modelSearch.toLowerCase().trim());

  useEffect(() => {
    if (!year || year.length !== 4 || !make.trim()) {
      setNhtsaModels([]);
      setIsLoadingModels(false);
      setModelLoadFailed(false);
      return;
    }
    if (SKIP_NHTSA.has(vehicleType)) {
      setNhtsaModels([]);
      setIsLoadingModels(false);
      setModelLoadFailed(false);
      return;
    }

    const yearNum = parseInt(year, 10);
    const cacheKey = modelCacheKey(make, year, vehicleType);
    const cached = modelCache.get(cacheKey);
    if (cached) {
      setNhtsaModels(cached);
      setIsLoadingModels(false);
      setModelLoadFailed(false);
      return;
    }

    let cancelled = false;
    setIsLoadingModels(true);
    setNhtsaModels([]);
    setModelLoadFailed(false);

    const encodedMake = encodeURIComponent(make.trim());
    const nhtsaBase = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodedMake}/modelyear/${yearNum}`;

    function extractNames(nhtsaJson: { Results?: { Model_Name?: string }[] }): string[] {
      return (nhtsaJson.Results ?? [])
        .map((item: { Model_Name?: string }) => item.Model_Name ?? "")
        .filter((nm: string) => nm.length > 0);
    }

    async function loadModels(): Promise<void> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        let names: string[] = [];

        if (vehicleType === "car") {
          const [passengerResp, truckResp, mpvResp] = await Promise.all([
            fetch(`${nhtsaBase}?format=json&vehicleType=Passenger%20Car`, { signal: controller.signal }),
            fetch(`${nhtsaBase}?format=json&vehicleType=Truck`, { signal: controller.signal }),
            fetch(`${nhtsaBase}?format=json&vehicleType=Multipurpose%20Passenger%20Vehicle%20(MPV)`, { signal: controller.signal }),
          ]);
          const [passengerJson, truckJson, mpvJson] = await Promise.all([
            passengerResp.json(),
            truckResp.json(),
            mpvResp.json(),
          ]);
          names = [...new Set([
            ...extractNames(passengerJson),
            ...extractNames(truckJson),
            ...extractNames(mpvJson),
          ])];
        } else if (vehicleType === "motorcycle") {
          const motoResp = await fetch(`${nhtsaBase}?format=json&vehicleType=Motorcycle`, { signal: controller.signal });
          const motoJson = await motoResp.json();
          names = extractNames(motoJson);
        } else {
          const allResp = await fetch(`${nhtsaBase}?format=json`, { signal: controller.signal });
          const allJson = await allResp.json();
          names = extractNames(allJson);
        }

        if (names.length < 3) {
          const allResp = await fetch(`${nhtsaBase}?format=json`, { signal: controller.signal });
          const allJson = await allResp.json();
          names = [...new Set([...names, ...extractNames(allJson)])];
        }

        if (!cancelled) {
          const sorted = names.sort();
          modelCache.set(cacheKey, sorted);
          setNhtsaModels(sorted);
          setModelLoadFailed(false);
        }
      } catch (e) {
        if ((e as any)?.name === "AbortError") {
          console.warn("[MODELS] NHTSA timeout — user can type model manually");
        } else {
          console.warn("[MODELS] Error loading models:", e);
        }
        if (!cancelled) {
          setNhtsaModels([]);
          setModelLoadFailed(true);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setIsLoadingModels(false);
      }
    }

    loadModels();
    return () => { cancelled = true; };
  }, [year, make, vehicleType]);

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

  const modelHint = !year || year.length !== 4 || !make.trim()
    ? "Select year & make first"
    : isLoadingModels
    ? "Loading models…"
    : nhtsaModels.length > 0 || SKIP_NHTSA.has(vehicleType)
    ? "Select or type model"
    : "Type a custom model";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Stack.Screen options={{ gestureEnabled: !isLoading }} />
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
                      setNhtsaModels([]);
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
            <Pressable style={styles.pickerBtn} onPress={() => setYearPickerVisible(true)}>
              <Text style={year ? styles.pickerValue : styles.pickerPlaceholder}>
                {year || "Select year"}
              </Text>
              <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
            </Pressable>
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
            <Pressable
              style={styles.pickerBtn}
              onPress={() => { setModelSearch(""); setModelPickerVisible(true); }}
            >
              <Text style={model ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>
                {model || modelHint}
              </Text>
              {isLoadingModels && year.length === 4 && make.trim().length > 0
                ? <ActivityIndicator size="small" color={Colors.textTertiary} />
                : <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />}
            </Pressable>
          </View>

          {/* Mileage / Hours */}
          {!isTimeOnly && (
            <View style={styles.section}>
              <Text style={styles.label}>{isHours ? "Current Engine Hours" : "Current Mileage"}</Text>
              <TextInput
                style={styles.input}
                value={usage}
                onChangeText={t => setUsage(t.replace(/[^0-9,]/g, ""))}
                placeholder={isHours ? "e.g. 250" : "e.g. 52,000"}
                placeholderTextColor={Colors.textTertiary}
                keyboardType={isHours ? "decimal-pad" : "number-pad"}
                returnKeyType="done"
                maxLength={7}
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

        {/* Year Picker Modal */}
        <YearPickerModal
          visible={yearPickerVisible}
          selectedYear={year ? parseInt(year, 10) : null}
          onSelect={y => { setYear(String(y)); setYearPickerVisible(false); setModel(""); }}
          onClose={() => setYearPickerVisible(false)}
          insets={insets}
        />

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
                    onPress={() => { Haptics.selectionAsync(); setMake(item); setModel(""); setNhtsaModels([]); setMakePickerVisible(false); }}
                  >
                    <Text style={styles.modalRowText}>{item}</Text>
                  </Pressable>
                )}
                ListFooterComponent={
                  makeSearch.trim().length > 0 ? (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => { setMake(makeSearch.trim()); setModel(""); setNhtsaModels([]); setMakePickerVisible(false); }}
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

        {/* Model Picker Modal */}
        <ModelPickerModal
          visible={modelPickerVisible}
          search={modelSearch}
          onSearchChange={setModelSearch}
          filteredModels={filteredModels}
          showCustomModel={showCustomModel}
          isLoadingModels={isLoadingModels}
          yearAndMakeSet={year.length === 4 && make.trim().length > 0}
          modelLoadFailed={modelLoadFailed}
          skipNhtsa={SKIP_NHTSA.has(vehicleType)}
          onSelect={m => { setModel(m); setModelPickerVisible(false); setModelSearch(""); }}
          onClose={() => { setModelPickerVisible(false); setModelSearch(""); }}
          insets={insets}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function YearPickerModal({ visible, selectedYear, onSelect, onClose, insets }: {
  visible: boolean;
  selectedYear: number | null;
  onSelect: (y: number) => void;
  onClose: () => void;
  insets: { bottom: number };
}) {
  const [yearInput, setYearInput] = useState("");
  const isSearching = yearInput.length > 0;
  const filteredYears = isSearching
    ? YEARS.filter(yr => String(yr).startsWith(yearInput))
    : YEARS;

  const typedYear = yearInput.length === 4 ? parseInt(yearInput, 10) : null;
  const typedYearValid = typedYear !== null && YEARS.includes(typedYear);

  function handleYearInput(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 4);
    setYearInput(digits);
  }

  function handleDone() {
    if (typedYearValid && typedYear !== null) {
      onSelect(typedYear);
      setYearInput("");
    } else {
      onClose();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pickerStyles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[pickerStyles.modalSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={pickerStyles.modalHandle} />
          <View style={pickerStyles.modalHeader}>
            <Text style={pickerStyles.modalTitle}>Select Year</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <Pressable onPress={onClose} style={pickerStyles.modalCancelBtn} hitSlop={8}>
                <Text style={pickerStyles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleDone} hitSlop={8}>
                <Text style={[pickerStyles.modalCancelText, { color: Colors.accent, fontFamily: "Inter_600SemiBold" }]}>Done</Text>
              </Pressable>
            </View>
          </View>
          <View style={pickerStyles.yearSearchWrap}>
            <TextInput
              style={pickerStyles.yearSearchInput}
              value={yearInput}
              onChangeText={handleYearInput}
              placeholder="Type a year..."
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              maxLength={4}
              returnKeyType="done"
              onSubmitEditing={handleDone}
            />
          </View>
          <FlatList
            data={filteredYears}
            keyExtractor={yr => String(yr)}
            getItemLayout={isSearching ? undefined : (_, index) => ({
              length: YEAR_ITEM_HEIGHT,
              offset: YEAR_ITEM_HEIGHT * index,
              index,
            })}
            initialScrollIndex={isSearching ? undefined : (selectedYear ? Math.max(0, YEARS.indexOf(selectedYear)) : 0)}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 300 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: yr }) => {
              const isSelected = yr === selectedYear;
              const isHighlighted = yr === typedYear && typedYearValid;
              return (
                <Pressable
                  style={({ pressed }) => [
                    pickerStyles.listRow,
                    (isSelected || isHighlighted) && pickerStyles.listRowSelected,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => { onSelect(yr); setYearInput(""); }}
                >
                  <Text style={[pickerStyles.listRowText, (isSelected || isHighlighted) && pickerStyles.listRowTextSelected]}>
                    {yr}
                  </Text>
                  {(isSelected || isHighlighted) && <Ionicons name="checkmark" size={18} color={Colors.accent} />}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function ModelPickerModal({ visible, search, onSearchChange, filteredModels, showCustomModel, isLoadingModels, yearAndMakeSet, modelLoadFailed, skipNhtsa, onSelect, onClose, insets }: {
  visible: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  filteredModels: string[];
  showCustomModel: boolean;
  isLoadingModels: boolean;
  yearAndMakeSet: boolean;
  modelLoadFailed: boolean;
  skipNhtsa: boolean;
  onSelect: (m: string) => void;
  onClose: () => void;
  insets: { bottom: number };
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={pickerStyles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[pickerStyles.modalSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={pickerStyles.modalHandle} />
          <View style={pickerStyles.modalHeader}>
            <Text style={pickerStyles.modalTitle}>Select Model</Text>
            <Pressable onPress={onClose} style={pickerStyles.modalCancelBtn} hitSlop={8}>
              <Text style={pickerStyles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
          <View style={pickerStyles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={Colors.textTertiary} />
            <TextInput
              style={pickerStyles.searchInput}
              value={search}
              onChangeText={onSearchChange}
              placeholder="Search or type a custom model…"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          {isLoadingModels ? (
            <View style={pickerStyles.listEmpty}>
              <ActivityIndicator color={Colors.accent} />
              <Text style={[pickerStyles.listEmptyText, { marginTop: 8 }]}>Loading models…</Text>
            </View>
          ) : !yearAndMakeSet ? (
            <View style={pickerStyles.listEmpty}>
              <Ionicons name="information-circle-outline" size={28} color={Colors.textTertiary} />
              <Text style={[pickerStyles.listEmptyText, { marginTop: 8 }]}>
                Select a year and make first to see available models
              </Text>
              {search.trim().length > 0 && (
                <Pressable
                  style={({ pressed }) => [pickerStyles.listRow, pickerStyles.listRowCustom, { marginTop: 12, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onSelect(search.trim())}
                >
                  <View style={pickerStyles.listRowCustomContent}>
                    <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                    <Text style={pickerStyles.listRowCustomText}>Use &quot;{search.trim()}&quot;</Text>
                  </View>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              data={filteredModels}
              keyExtractor={m => m}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 320 }}
              contentContainerStyle={{ paddingBottom: 20 }}
              ListHeaderComponent={
                filteredModels.length > 0 ? (
                  <Text style={pickerStyles.modelHint}>
                    Don't see your model? Type it in the search bar above.
                  </Text>
                ) : null
              }
              getItemLayout={(_, index) => ({
                length: MODEL_ITEM_HEIGHT,
                offset: MODEL_ITEM_HEIGHT * index,
                index,
              })}
              renderItem={({ item: mdl }) => (
                <Pressable
                  style={({ pressed }) => [pickerStyles.listRow, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onSelect(mdl)}
                >
                  <Text style={pickerStyles.listRowText}>{mdl}</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
                </Pressable>
              )}
              ListFooterComponent={showCustomModel ? (
                <Pressable
                  style={({ pressed }) => [pickerStyles.listRow, pickerStyles.listRowCustom, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onSelect(search.trim())}
                >
                  <View style={pickerStyles.listRowCustomContent}>
                    <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                    <Text style={pickerStyles.listRowCustomText}>Use &quot;{search.trim()}&quot;</Text>
                  </View>
                  <Text style={pickerStyles.listRowCustomSub}>Custom model</Text>
                </Pressable>
              ) : null}
              ListEmptyComponent={
                <View style={pickerStyles.listEmpty}>
                  <Text style={pickerStyles.listEmptyText}>
                    {modelLoadFailed || skipNhtsa
                      ? "Type your model in the search bar above."
                      : "No matches. Type your model above."}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

const pickerStyles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: "80%",
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: "center", marginBottom: 12,
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  modalCancelBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  modalCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },
  yearSearchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  yearSearchInput: {
    backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text, borderWidth: 1, borderColor: Colors.border,
  },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10, margin: 12,
    backgroundColor: Colors.background, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, minHeight: 44,
  },
  searchInput: {
    flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text,
    paddingVertical: 10, minHeight: 44,
  },
  listRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, minHeight: 52,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  listRowSelected: { backgroundColor: "rgba(232,147,58,0.08)" },
  listRowText: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  listRowTextSelected: { fontFamily: "Inter_600SemiBold", color: Colors.accent },
  listRowCustom: { backgroundColor: "rgba(232,147,58,0.08)", borderBottomWidth: 0, marginTop: 4 },
  listRowCustomContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  listRowCustomText: { fontSize: 16, fontFamily: "Inter_500Medium", color: Colors.accent },
  listRowCustomSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.accent },
  listEmpty: { paddingVertical: 32, alignItems: "center", paddingHorizontal: 24 },
  listEmptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  modelHint: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    fontStyle: "italic", textAlign: "center",
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
  },
});
