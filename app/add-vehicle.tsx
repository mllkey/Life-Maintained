import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  FlatList,
  SectionList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_ITEM_HEIGHT = 52;
const MODEL_ITEM_HEIGHT = 52;

const YEARS: number[] = Array.from(
  { length: CURRENT_YEAR + 2 - 1980 },
  (_, i) => CURRENT_YEAR + 1 - i
);

const MAKES_BY_TYPE: Record<string, string[]> = {
  car: [
    "Toyota", "Ford", "Chevrolet", "Honda", "Nissan", "Jeep", "RAM", "GMC",
    "Subaru", "Hyundai", "Kia", "Volkswagen", "BMW", "Mercedes-Benz", "Audi",
    "Mazda", "Dodge", "Chrysler", "Buick", "Cadillac", "Volvo", "Tesla",
    "Lexus", "Acura", "Infiniti", "Lincoln", "Mitsubishi", "Porsche",
    "Land Rover", "Jaguar", "Mini", "Alfa Romeo", "Genesis", "Rivian",
    "Lucid", "Scout",
  ],
  motorcycle: [
    "Harley-Davidson", "Honda", "Kawasaki", "Yamaha", "Suzuki", "Ducati",
    "BMW", "KTM", "Triumph", "Royal Enfield", "Indian", "Can-Am",
    "Zero Motorcycles", "Aprilia", "Moto Guzzi", "Husqvarna",
  ],
  rv: [
    "Winnebago", "Airstream", "Thor Industries", "Forest River", "Coachmen",
    "Keystone", "Grand Design", "Jayco", "Heartland", "Tiffin", "Newmar",
    "Fleetwood",
  ],
  boat: [
    "Sea Ray", "Bayliner", "Boston Whaler", "Malibu", "MasterCraft",
    "Grady-White", "Lund", "Tracker", "Yamaha", "Mercury", "Chaparral",
    "Cobalt", "Ranger", "Crestliner",
  ],
  atv: [
    "Polaris", "Can-Am", "Yamaha", "Honda", "Kawasaki", "Suzuki",
    "Arctic Cat", "Textron", "CFMoto", "Kubota",
  ],
  other: [],
};

const ALL_MAKES = [...new Set(Object.values(MAKES_BY_TYPE).flat())];

type MakeSection = { title: string; data: string[] };

const CAR_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Toyota", "Ford", "Chevrolet", "Honda", "Nissan", "Jeep", "RAM", "GMC", "Subaru", "Hyundai", "Kia"] },
  { title: "A", data: ["Acura", "Alfa Romeo", "Audi"] },
  { title: "B", data: ["BMW", "Buick"] },
  { title: "C", data: ["Cadillac", "Chrysler"] },
  { title: "D", data: ["Dodge"] },
  { title: "G", data: ["Genesis"] },
  { title: "I", data: ["Infiniti"] },
  { title: "J", data: ["Jaguar"] },
  { title: "L", data: ["Land Rover", "Lexus", "Lincoln", "Lucid"] },
  { title: "M", data: ["Mazda", "Mercedes-Benz", "Mini", "Mitsubishi"] },
  { title: "P", data: ["Porsche"] },
  { title: "R", data: ["Rivian"] },
  { title: "S", data: ["Scout"] },
  { title: "T", data: ["Tesla"] },
  { title: "V", data: ["Volkswagen", "Volvo"] },
];

const MOTO_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Harley-Davidson", "Honda", "Kawasaki", "Yamaha", "Suzuki"] },
  { title: "A", data: ["Aprilia"] },
  { title: "B", data: ["BMW"] },
  { title: "C", data: ["Can-Am"] },
  { title: "D", data: ["Ducati"] },
  { title: "H", data: ["Husqvarna"] },
  { title: "I", data: ["Indian"] },
  { title: "K", data: ["KTM"] },
  { title: "M", data: ["Moto Guzzi"] },
  { title: "R", data: ["Royal Enfield"] },
  { title: "T", data: ["Triumph"] },
  { title: "Z", data: ["Zero Motorcycles"] },
];

const MAKE_SECTIONS_BY_TYPE: Record<string, MakeSection[]> = {
  car: CAR_MAKE_SECTIONS,
  motorcycle: MOTO_MAKE_SECTIONS,
};

const MILEAGE_TRACKED_TYPES = new Set(["car", "motorcycle", "rv"]);

const VEHICLE_TYPES: { value: string; label: string; icon: string }[] = [
  { value: "car",        label: "Car / Truck / SUV", icon: "car" },
  { value: "motorcycle", label: "Motorcycle",         icon: "motorbike" },
  { value: "rv",         label: "RV / Camper",        icon: "rv-truck" },
  { value: "boat",       label: "Boat",               icon: "sail-boat" },
  { value: "atv",        label: "ATV / Off-road",     icon: "atv" },
  { value: "other",      label: "Other",              icon: "wrench" },
];

type MfrTask = {
  task: string;
  mileage_interval: number | null;
  interval_days: number | null;
  estimated_cost: number;
  priority: string;
};

function normalizeMake(raw: string): string {
  const upper = raw.toUpperCase();
  const found = ALL_MAKES.find(m => m.toUpperCase() === upper);
  return found ?? raw.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function mapNhtsaVehicleType(nhtsaType: string): string {
  const t = nhtsaType.toLowerCase();
  if (t.includes("motorcycle") || t.includes("moped") || t.includes("scooter")) return "motorcycle";
  if (t.includes("rv") || t.includes("recreational") || t.includes("motor home") || t.includes("motorhome") || t.includes("camper") || t.includes("trailer")) return "rv";
  if (t.includes("atv") || t.includes("off-road") || t.includes("offroad") || t.includes("quad") || t.includes("utv") || t.includes("snowmobile")) return "atv";
  if (t.includes("boat") || t.includes("marine") || t.includes("vessel") || t.includes("watercraft") || t.includes("yacht")) return "boat";
  if (t.includes("truck") || t.includes("mpv") || t.includes("multipurpose") || t.includes("passenger car") || t.includes("passenger vehicle") || t.includes("low speed")) return "car";
  return "other";
}

export default function AddVehicleScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [nickname, setNickname] = useState("");
  const [vehicleType, setVehicleType] = useState("car");
  const [mileage, setMileage] = useState("");
  const [avgMilesPerMonth, setAvgMilesPerMonth] = useState("");
  const [isSeasonal, setIsSeasonal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vin, setVin] = useState("");
  const [isVinLoading, setIsVinLoading] = useState(false);
  const [vinError, setVinError] = useState<string | null>(null);
  const [vinSuccess, setVinSuccess] = useState<string | null>(null);

  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [makePickerVisible, setMakePickerVisible] = useState(false);
  const [makeSearch, setMakeSearch] = useState("");
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  const [nhtsaModels, setNhtsaModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [hasManufacturerSchedule, setHasManufacturerSchedule] = useState(false);
  const [manufacturerTasks, setManufacturerTasks] = useState<MfrTask[]>([]);
  const [isCheckingSchedule, setIsCheckingSchedule] = useState(false);

  const availableMakes = MAKES_BY_TYPE[vehicleType] ?? [];

  const filteredMakes = useMemo(() => {
    const q = makeSearch.toLowerCase().trim();
    if (!q) return availableMakes;
    return availableMakes.filter(m => m.toLowerCase().includes(q));
  }, [makeSearch, availableMakes]);

  const showCustomMake =
    makeSearch.trim().length > 0 &&
    !availableMakes.some(m => m.toLowerCase() === makeSearch.toLowerCase().trim());

  const filteredModels = useMemo(() => {
    const q = modelSearch.toLowerCase().trim();
    if (!q) return nhtsaModels;
    return nhtsaModels.filter(m => m.toLowerCase().includes(q));
  }, [modelSearch, nhtsaModels]);

  const showCustomModel =
    modelSearch.trim().length > 0 &&
    !nhtsaModels.some(m => m.toLowerCase() === modelSearch.toLowerCase().trim());

  useEffect(() => {
    const yearNum = parseInt(year);
    if (!year || !make.trim() || isNaN(yearNum)) {
      setHasManufacturerSchedule(false);
      setManufacturerTasks([]);
      setNhtsaModels([]);
      return;
    }

    let schedCancelled = false;
    setIsCheckingSchedule(true);

    supabase
      .from("manufacturer_schedules")
      .select("tasks")
      .ilike("make", make.trim())
      .lte("year_from", yearNum)
      .or(`year_to.is.null,year_to.gte.${yearNum}`)
      .maybeSingle()
      .then(({ data }) => {
        if (schedCancelled) return;
        setIsCheckingSchedule(false);
        if (data) {
          setHasManufacturerSchedule(true);
          setManufacturerTasks((data.tasks as MfrTask[]) ?? []);
        } else {
          setHasManufacturerSchedule(false);
          setManufacturerTasks([]);
        }
      });

    let modelCancelled = false;

    if (vehicleType === "other") {
      setNhtsaModels([]);
      setIsLoadingModels(false);
    } else {
      setIsLoadingModels(true);
      setNhtsaModels([]);

      const encodedMake = encodeURIComponent(make.trim());
      const nhtsaBase = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodedMake}/modelyear/${yearNum}`;

      function extractNames(nhtsaJson: { Results?: { Model_Name?: string }[] }): string[] {
        return (nhtsaJson.Results ?? [])
          .map((item: { Model_Name?: string }) => item.Model_Name ?? "")
          .filter((nm: string) => nm.length > 0);
      }

      async function loadModels(): Promise<void> {
        try {
          let names: string[] = [];

          if (vehicleType === "car") {
            const [passengerResp, truckResp] = await Promise.all([
              fetch(`${nhtsaBase}?format=json&vehicleType=Passenger%20Car`),
              fetch(`${nhtsaBase}?format=json&vehicleType=Truck`),
            ]);
            const [passengerJson, truckJson] = await Promise.all([
              passengerResp.json(),
              truckResp.json(),
            ]);
            names = [...new Set([...extractNames(passengerJson), ...extractNames(truckJson)])];
          } else if (vehicleType === "rv") {
            const [incompleteResp, busResp] = await Promise.all([
              fetch(`${nhtsaBase}?format=json&vehicleType=Incomplete%20Vehicle`),
              fetch(`${nhtsaBase}?format=json&vehicleType=Bus`),
            ]);
            const [incompleteJson, busJson] = await Promise.all([
              incompleteResp.json(),
              busResp.json(),
            ]);
            names = [...new Set([...extractNames(incompleteJson), ...extractNames(busJson)])];
          } else if (vehicleType === "motorcycle") {
            const motoResp = await fetch(`${nhtsaBase}?format=json&vehicleType=Motorcycle`);
            const motoJson = await motoResp.json();
            names = extractNames(motoJson);
          } else {
            const allResp = await fetch(`${nhtsaBase}?format=json`);
            const allJson = await allResp.json();
            names = extractNames(allJson);
          }

          if (!modelCancelled) {
            setNhtsaModels(names.sort());
            setIsLoadingModels(false);
          }
        } catch {
          if (!modelCancelled) {
            setNhtsaModels([]);
            setIsLoadingModels(false);
          }
        }
      }

      loadModels();
    }

    return () => {
      schedCancelled = true;
      modelCancelled = true;
    };
  }, [year, make, vehicleType]);

  async function handleVinLookup() {
    const cleanVin = vin.trim().toUpperCase();
    if (cleanVin.length !== 17) {
      setVinError("VIN must be exactly 17 characters");
      setVinSuccess(null);
      return;
    }
    setIsVinLoading(true);
    setVinError(null);
    setVinSuccess(null);
    try {
      const res = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${cleanVin}?format=json`
      );
      const json = await res.json();
      const result = json.Results?.[0];
      if (!result || !String(result.ErrorCode ?? "").startsWith("0") || !result.Make) {
        setVinError("Invalid VIN — please check and try again");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (result.ModelYear) setYear(result.ModelYear);
      if (result.Make) setMake(normalizeMake(result.Make));
      if (result.Model) setModel(result.Model);
      if (result.Trim) setTrim(result.Trim);
      if (result.VehicleType) setVehicleType(mapNhtsaVehicleType(result.VehicleType));
      setVinSuccess("Vehicle details filled from VIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setVinError("Could not reach lookup service — check your connection");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsVinLoading(false);
    }
  }

  function selectYear(yr: number) {
    setYear(String(yr));
    setYearPickerVisible(false);
    Haptics.selectionAsync();
  }

  function selectMake(selectedMake: string) {
    setMake(selectedMake);
    setMakePickerVisible(false);
    setMakeSearch("");
    setModel("");
    Haptics.selectionAsync();
  }

  function selectModel(selectedModel: string) {
    setModel(selectedModel);
    setModelPickerVisible(false);
    setModelSearch("");
    Haptics.selectionAsync();
  }

  async function handleSave() {
    if (!user) return;
    if (!year || !make || !model) {
      setError("Year, make, and model are required");
      return;
    }
    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 1980 || yearNum > CURRENT_YEAR + 2) {
      setError("Please select a valid year");
      return;
    }
    if (MILEAGE_TRACKED_TYPES.has(vehicleType) && !avgMilesPerMonth.trim()) {
      setError("Estimated monthly miles is required for this vehicle type");
      return;
    }
    setIsLoading(true);
    setError(null);

    const { data: inserted, error: err } = await supabase
      .from("vehicles")
      .insert({
        user_id: user.id,
        year: yearNum,
        make: make.trim(),
        model: model.trim(),
        trim: trim.trim() || null,
        nickname: nickname.trim() || null,
        vehicle_type: vehicleType,
        mileage: mileage ? parseInt(mileage) : null,
        average_miles_per_month: avgMilesPerMonth ? parseInt(avgMilesPerMonth) : null,
        is_seasonal: isSeasonal,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (err || !inserted) {
      setIsLoading(false);
      setError(err?.message ?? "Failed to save vehicle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (hasManufacturerSchedule && manufacturerTasks.length > 0) {
      const taskRows = manufacturerTasks.map(t => ({
        vehicle_id: inserted.id,
        task: t.task,
        interval: t.interval_days,
        mileage_interval: t.mileage_interval,
        estimated_cost: t.estimated_cost,
        priority: t.priority,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      await supabase.from("vehicle_maintenance_tasks").insert(taskRows);
    }

    setIsLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
    router.back();
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Vehicle</Text>
          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={handleSave}
            disabled={isLoading}
          >
            {isLoading
              ? <ActivityIndicator size="small" color={Colors.textInverse} />
              : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error && (
            <View style={styles.alertBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
              <Text style={styles.alertText}>{error}</Text>
            </View>
          )}

          {/* ── VIN Lookup ────────────────────────────────────── */}
          <FieldGroup label="VIN Lookup (Optional)">
            <View style={styles.vinRow}>
              <TextInput
                style={styles.vinInput}
                value={vin}
                onChangeText={v => {
                  setVin(v.toUpperCase());
                  setVinError(null);
                  setVinSuccess(null);
                }}
                placeholder="17-character VIN"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="characters"
                maxLength={17}
                returnKeyType="go"
                onSubmitEditing={handleVinLookup}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.vinBtn,
                  vin.trim().length === 17 && styles.vinBtnActive,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={handleVinLookup}
                disabled={isVinLoading}
              >
                {isVinLoading
                  ? <ActivityIndicator size="small" color={Colors.textInverse} />
                  : <Text style={[styles.vinBtnText, vin.trim().length === 17 && styles.vinBtnTextActive]}>
                      Look Up
                    </Text>}
              </Pressable>
            </View>

            {vinError && (
              <View style={styles.alertBox}>
                <Ionicons name="alert-circle-outline" size={14} color={Colors.overdue} />
                <Text style={styles.alertText}>{vinError}</Text>
              </View>
            )}
            {vinSuccess && (
              <View style={styles.successBox}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.good} />
                <Text style={styles.successText}>{vinSuccess}</Text>
              </View>
            )}
            <Text style={styles.vinHint}>
              Skip this and fill in the details below manually
            </Text>
          </FieldGroup>

          {/* ── Vehicle Type ──────────────────────────────────── */}
          <FieldGroup label="Vehicle Type">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.typeScroll}
            >
              {VEHICLE_TYPES.map(t => {
                const isSelected = vehicleType === t.value;
                return (
                  <Pressable
                    key={t.value}
                    style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setVehicleType(t.value);
                      setMake("");
                      setModel("");
                    }}
                  >
                    <MaterialCommunityIcons
                      name={t.icon as any}
                      size={26}
                      color={isSelected ? Colors.accent : Colors.textSecondary}
                    />
                    <Text style={[styles.typeCardLabel, isSelected && styles.typeCardLabelSelected]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </FieldGroup>

          {/* ── Basic Info ────────────────────────────────────── */}
          <FieldGroup label="Basic Info">
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <PickerField
                  label="Year *"
                  value={year}
                  placeholder="Year"
                  onPress={() => setYearPickerVisible(true)}
                />
              </View>
              <View style={{ flex: 2 }}>
                {vehicleType === "other" ? (
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Make *</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={make}
                      onChangeText={setMake}
                      placeholder="Enter make…"
                      placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="words"
                      returnKeyType="next"
                    />
                  </View>
                ) : (
                  <PickerField
                    label="Make *"
                    value={make}
                    placeholder="Select make"
                    onPress={() => { setMakeSearch(""); setMakePickerVisible(true); }}
                  />
                )}
              </View>
            </View>

            {(hasManufacturerSchedule || isCheckingSchedule) && year && make && (
              <View style={styles.scheduleRow}>
                {isCheckingSchedule ? (
                  <>
                    <ActivityIndicator size="small" color={Colors.accent} />
                    <Text style={styles.schedulePending}>Checking manufacturer schedule…</Text>
                  </>
                ) : (
                  <>
                    <View style={styles.scheduleBadge}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.good} />
                      <Text style={styles.scheduleBadgeText}>Manufacturer schedule available</Text>
                    </View>
                    <Text style={styles.scheduleTaskCount}>
                      {manufacturerTasks.length} task{manufacturerTasks.length !== 1 ? "s" : ""} will be added
                    </Text>
                  </>
                )}
              </View>
            )}

            <ModelPickerField
              label="Model *"
              value={model}
              isLoadingModels={isLoadingModels}
              hasModels={nhtsaModels.length > 0}
              yearAndMakeSet={!!year && !!make}
              onPress={() => { setModelSearch(""); setModelPickerVisible(true); }}
            />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Trim</Text>
              <TextInput
                style={styles.fieldInput}
                value={trim}
                onChangeText={setTrim}
                placeholder="XSE, Sport, Limited…"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Nickname</Text>
              <TextInput
                style={styles.fieldInput}
                value={nickname}
                onChangeText={setNickname}
                placeholder="Daily driver, My truck…"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>
          </FieldGroup>

          {/* ── Mileage ───────────────────────────────────────── */}
          <FieldGroup label="Mileage">
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Current Mileage</Text>
              <TextInput
                style={styles.fieldInput}
                value={mileage}
                onChangeText={setMileage}
                placeholder="45000"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>
            {MILEAGE_TRACKED_TYPES.has(vehicleType) && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Estimated Monthly Miles *</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={avgMilesPerMonth}
                  onChangeText={setAvgMilesPerMonth}
                  placeholder="1000"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                <Text style={styles.fieldHint}>Used to calculate mileage-based maintenance intervals</Text>
              </View>
            )}
          </FieldGroup>

          {/* ── Options ───────────────────────────────────────── */}
          <FieldGroup label="Options">
            <Pressable
              style={styles.toggleRow}
              onPress={() => { Haptics.selectionAsync(); setIsSeasonal(!isSeasonal); }}
            >
              <View>
                <Text style={styles.toggleLabel}>Seasonal Vehicle</Text>
                <Text style={styles.toggleSub}>Motorcycles, boats, snowmobiles, etc.</Text>
              </View>
              <View style={[styles.toggle, isSeasonal && styles.toggleOn]}>
                <View style={[styles.toggleThumb, isSeasonal && styles.toggleThumbOn]} />
              </View>
            </Pressable>
          </FieldGroup>
        </ScrollView>
      </View>

      <YearPickerModal
        visible={yearPickerVisible}
        selectedYear={year ? parseInt(year) : null}
        onSelect={selectYear}
        onClose={() => setYearPickerVisible(false)}
        insets={insets}
      />

      <MakePickerModal
        visible={makePickerVisible}
        search={makeSearch}
        onSearchChange={setMakeSearch}
        filteredMakes={filteredMakes}
        showCustomMake={showCustomMake}
        vehicleType={vehicleType}
        onSelect={selectMake}
        onClose={() => { setMakePickerVisible(false); setMakeSearch(""); }}
        insets={insets}
      />

      <ModelPickerModal
        visible={modelPickerVisible}
        search={modelSearch}
        onSearchChange={setModelSearch}
        filteredModels={filteredModels}
        showCustomModel={showCustomModel}
        isLoadingModels={isLoadingModels}
        yearAndMakeSet={!!year && !!make}
        onSelect={selectModel}
        onClose={() => { setModelPickerVisible(false); setModelSearch(""); }}
        insets={insets}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function YearPickerModal({ visible, selectedYear, onSelect, onClose, insets }: {
  visible: boolean;
  selectedYear: number | null;
  onSelect: (y: number) => void;
  onClose: () => void;
  insets: { bottom: number };
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Year</Text>
            <Pressable onPress={onClose} style={styles.modalCancelBtn} hitSlop={8}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
          <FlatList
            data={YEARS}
            keyExtractor={yr => String(yr)}
            getItemLayout={(_, index) => ({
              length: YEAR_ITEM_HEIGHT,
              offset: YEAR_ITEM_HEIGHT * index,
              index,
            })}
            initialScrollIndex={selectedYear ? Math.max(0, YEARS.indexOf(selectedYear)) : 0}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 340 }}
            renderItem={({ item: yr }) => {
              const isSelected = yr === selectedYear;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.listRow,
                    isSelected && styles.listRowSelected,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => onSelect(yr)}
                >
                  <Text style={[styles.listRowText, isSelected && styles.listRowTextSelected]}>
                    {yr}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color={Colors.vehicle} />}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function MakeSectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.makeSectionHeader}>
      <Text style={styles.makeSectionHeaderText}>{title.toUpperCase()}</Text>
    </View>
  );
}

function MakeRow({ mk, onSelect }: { mk: string; onSelect: (m: string) => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => onSelect(mk)}
    >
      <Text style={styles.listRowText}>{mk}</Text>
      <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
    </Pressable>
  );
}

function MakePickerModal({ visible, search, onSearchChange, filteredMakes, showCustomMake, vehicleType, onSelect, onClose, insets }: {
  visible: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  filteredMakes: string[];
  showCustomMake: boolean;
  vehicleType: string;
  onSelect: (m: string) => void;
  onClose: () => void;
  insets: { bottom: number };
}) {
  const searchRef = useRef<TextInput>(null);
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => searchRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const sections = MAKE_SECTIONS_BY_TYPE[vehicleType];
  const isSearching = search.trim().length > 0;
  const useSections = !!sections && !isSearching;

  const customFooter = showCustomMake ? (
    <Pressable
      style={({ pressed }) => [styles.listRow, styles.listRowCustom, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => onSelect(search.trim())}
    >
      <View style={styles.listRowCustomContent}>
        <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
        <Text style={styles.listRowCustomText}>Use "{search.trim()}"</Text>
      </View>
      <Text style={styles.listRowCustomSub}>Custom make</Text>
    </Pressable>
  ) : null;

  const emptyComponent = (
    <View style={styles.listEmpty}>
      <Text style={styles.listEmptyText}>No matches — type your make above</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Make</Text>
            <Pressable onPress={onClose} style={styles.modalCancelBtn} hitSlop={8}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={Colors.textTertiary} />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              value={search}
              onChangeText={onSearchChange}
              placeholder="Search makes…"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          {useSections ? (
            <SectionList
              sections={sections}
              keyExtractor={(mk) => mk}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 380 }}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => (
                <MakeSectionHeader title={section.title} />
              )}
              renderItem={({ item: mk }) => (
                <MakeRow mk={mk} onSelect={onSelect} />
              )}
              ListFooterComponent={customFooter}
            />
          ) : (
            <FlatList
              data={filteredMakes}
              keyExtractor={(mk) => mk}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 380 }}
              renderItem={({ item: mk }) => (
                <MakeRow mk={mk} onSelect={onSelect} />
              )}
              ListFooterComponent={customFooter}
              ListEmptyComponent={emptyComponent}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ModelPickerModal({ visible, search, onSearchChange, filteredModels, showCustomModel, isLoadingModels, yearAndMakeSet, onSelect, onClose, insets }: {
  visible: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  filteredModels: string[];
  showCustomModel: boolean;
  isLoadingModels: boolean;
  yearAndMakeSet: boolean;
  onSelect: (m: string) => void;
  onClose: () => void;
  insets: { bottom: number };
}) {
  const searchRef = useRef<TextInput>(null);
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => searchRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Model</Text>
            <Pressable onPress={onClose} style={styles.modalCancelBtn} hitSlop={8}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={Colors.textTertiary} />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
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
            <View style={styles.listEmpty}>
              <ActivityIndicator color={Colors.accent} />
              <Text style={[styles.listEmptyText, { marginTop: 8 }]}>Loading models…</Text>
            </View>
          ) : !yearAndMakeSet ? (
            <View style={styles.listEmpty}>
              <Ionicons name="information-circle-outline" size={28} color={Colors.textTertiary} />
              <Text style={[styles.listEmptyText, { marginTop: 8 }]}>
                Select a year and make first to see available models
              </Text>
              {search.trim().length > 0 && (
                <Pressable
                  style={({ pressed }) => [styles.listRow, styles.listRowCustom, { marginTop: 12, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onSelect(search.trim())}
                >
                  <View style={styles.listRowCustomContent}>
                    <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                    <Text style={styles.listRowCustomText}>Use "{search.trim()}"</Text>
                  </View>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              data={filteredModels}
              keyExtractor={m => m}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 320 }}
              getItemLayout={(_, index) => ({
                length: MODEL_ITEM_HEIGHT,
                offset: MODEL_ITEM_HEIGHT * index,
                index,
              })}
              renderItem={({ item: mdl }) => (
                <Pressable
                  style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onSelect(mdl)}
                >
                  <Text style={styles.listRowText}>{mdl}</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
                </Pressable>
              )}
              ListFooterComponent={showCustomModel ? (
                <Pressable
                  style={({ pressed }) => [styles.listRow, styles.listRowCustom, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onSelect(search.trim())}
                >
                  <View style={styles.listRowCustomContent}>
                    <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                    <Text style={styles.listRowCustomText}>Use "{search.trim()}"</Text>
                  </View>
                  <Text style={styles.listRowCustomSub}>Custom model</Text>
                </Pressable>
              ) : null}
              ListEmptyComponent={
                <View style={styles.listEmpty}>
                  <Text style={styles.listEmptyText}>
                    {filteredModels.length === 0 && !search
                      ? "No models found — type a custom model above"
                      : "No matches — type your model above"}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldGroupLabel}>{label}</Text>
      <View style={styles.fieldGroupContent}>{children}</View>
    </View>
  );
}

function PickerField({ label, value, placeholder, onPress }: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.pickerBtn, { opacity: pressed ? 0.85 : 1 }]}
        onPress={onPress}
      >
        <Text style={[styles.pickerBtnText, !value && styles.pickerBtnPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function ModelPickerField({ label, value, isLoadingModels, hasModels, yearAndMakeSet, onPress }: {
  label: string;
  value: string;
  isLoadingModels: boolean;
  hasModels: boolean;
  yearAndMakeSet: boolean;
  onPress: () => void;
}) {
  const hint = !yearAndMakeSet
    ? "Select year & make first"
    : isLoadingModels
    ? "Loading models…"
    : hasModels
    ? "Select or type model"
    : "Type a custom model";

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.pickerBtn, { opacity: pressed ? 0.85 : 1 }]}
        onPress={onPress}
      >
        <Text style={[styles.pickerBtnText, !value && styles.pickerBtnPlaceholder]} numberOfLines={1}>
          {value || hint}
        </Text>
        {isLoadingModels && yearAndMakeSet
          ? <ActivityIndicator size="small" color={Colors.textTertiary} />
          : <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />}
      </Pressable>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
    minWidth: 64,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },

  alertBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.overdueMuted,
    borderRadius: 10,
    padding: 12,
  },
  alertText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.goodMuted,
    borderRadius: 10,
    padding: 12,
  },
  successText: { flex: 1, fontSize: 13, color: Colors.good, fontFamily: "Inter_500Medium" },

  vinRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  vinInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 48,
    letterSpacing: 1.5,
  },
  vinBtn: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  vinBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  vinBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary },
  vinBtnTextActive: { color: Colors.textInverse },
  vinHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 },

  typeScroll: { paddingRight: 4, gap: 10, flexDirection: "row" },
  typeCard: {
    width: 72,
    height: 82,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  typeCardSelected: {
    backgroundColor: Colors.accentLight,
    borderColor: Colors.accent,
  },
  typeCardLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  typeCardLabelSelected: { color: Colors.accent, fontFamily: "Inter_600SemiBold" },

  fieldGroup: { gap: 10 },
  fieldGroupLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  fieldGroupContent: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },

  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  fieldHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 },
  fieldInput: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 48,
  },

  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 48,
    gap: 8,
  },
  pickerBtnText: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  pickerBtnPlaceholder: { color: Colors.textTertiary, fontSize: 14 },

  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  scheduleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.goodMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.good + "44",
  },
  scheduleBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.good },
  scheduleTaskCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  schedulePending: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 64,
  },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.border,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleOn: { backgroundColor: Colors.accent },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },

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
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  modalCancelBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  modalCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    paddingVertical: 10,
    minHeight: 44,
  },

  makeSectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
  },
  makeSectionHeaderText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },

  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  listRowSelected: { backgroundColor: Colors.vehicleMuted },
  listRowText: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  listRowTextSelected: { fontFamily: "Inter_600SemiBold", color: Colors.vehicle },
  listRowCustom: { backgroundColor: Colors.accentLight, borderBottomWidth: 0, marginTop: 4 },
  listRowCustomContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  listRowCustomText: { fontSize: 16, fontFamily: "Inter_500Medium", color: Colors.accent },
  listRowCustomSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.accent },
  listEmpty: { paddingVertical: 32, alignItems: "center", paddingHorizontal: 24 },
  listEmptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
});
