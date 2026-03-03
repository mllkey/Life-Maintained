import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_ITEM_HEIGHT = 52;

const YEARS: number[] = Array.from(
  { length: CURRENT_YEAR + 2 - 1980 },
  (_, i) => CURRENT_YEAR + 1 - i
);

const MAKES = [
  "Toyota", "Ford", "Chevrolet", "Honda", "Nissan", "Jeep", "RAM", "GMC",
  "Subaru", "Hyundai", "Kia", "Volkswagen", "BMW", "Mercedes-Benz", "Audi",
  "Mazda", "Dodge", "Chrysler", "Buick", "Cadillac", "Volvo", "Tesla",
  "Lexus", "Acura", "Infiniti", "Lincoln", "Mitsubishi", "Porsche",
  "Land Rover", "Jaguar", "Mini", "Alfa Romeo", "Genesis", "Rivian",
  "Lucid", "Scout", "Kawasaki", "Harley-Davidson", "Honda Powersports", "Yamaha",
];

const MILEAGE_TRACKED_TYPES = new Set(["car", "truck", "suv", "motorcycle", "superbike", "rv", "electric"]);

const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "truck", label: "Truck" },
  { value: "suv", label: "SUV" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "superbike", label: "Superbike" },
  { value: "rv", label: "RV / Camper" },
  { value: "boat", label: "Boat" },
  { value: "atv", label: "ATV / Off-road" },
  { value: "electric", label: "Electric Vehicle" },
  { value: "other", label: "Other" },
];

type MfrTask = {
  task: string;
  mileage_interval: number | null;
  interval_days: number | null;
  estimated_cost: number;
  priority: string;
};

export default function AddVehicleScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const modelInputRef = useRef<TextInput>(null);

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

  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [makePickerVisible, setMakePickerVisible] = useState(false);
  const [makeSearch, setMakeSearch] = useState("");

  const [hasManufacturerSchedule, setHasManufacturerSchedule] = useState(false);
  const [manufacturerTasks, setManufacturerTasks] = useState<MfrTask[]>([]);
  const [isCheckingSchedule, setIsCheckingSchedule] = useState(false);

  const filteredMakes = useMemo(() => {
    const q = makeSearch.toLowerCase().trim();
    if (!q) return MAKES;
    return MAKES.filter(m => m.toLowerCase().includes(q));
  }, [makeSearch]);

  const showCustomMake =
    makeSearch.trim().length > 0 &&
    !MAKES.some(m => m.toLowerCase() === makeSearch.toLowerCase().trim());

  useEffect(() => {
    const yearNum = parseInt(year);
    if (!year || !make.trim() || isNaN(yearNum)) {
      setHasManufacturerSchedule(false);
      setManufacturerTasks([]);
      return;
    }

    let cancelled = false;
    setIsCheckingSchedule(true);

    supabase
      .from("manufacturer_schedules")
      .select("tasks")
      .ilike("make", make.trim())
      .lte("year_from", yearNum)
      .or(`year_to.is.null,year_to.gte.${yearNum}`)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setIsCheckingSchedule(false);
        if (data) {
          setHasManufacturerSchedule(true);
          setManufacturerTasks((data.tasks as MfrTask[]) ?? []);
        } else {
          setHasManufacturerSchedule(false);
          setManufacturerTasks([]);
        }
      });

    return () => { cancelled = true; };
  }, [year, make]);

  function selectYear(yr: number) {
    setYear(String(yr));
    setYearPickerVisible(false);
    Haptics.selectionAsync();
  }

  function selectMake(selectedMake: string) {
    setMake(selectedMake);
    setMakePickerVisible(false);
    setMakeSearch("");
    Haptics.selectionAsync();
    setTimeout(() => modelInputRef.current?.focus(), 300);
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
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <FieldGroup label="Vehicle Type">
            <View style={styles.typeGrid}>
              {VEHICLE_TYPES.map(t => (
                <Pressable
                  key={t.value}
                  style={[styles.typeOption, vehicleType === t.value && styles.typeOptionSelected]}
                  onPress={() => { Haptics.selectionAsync(); setVehicleType(t.value); }}
                >
                  <Text style={[styles.typeOptionText, vehicleType === t.value && styles.typeOptionTextSelected]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </FieldGroup>

          <FieldGroup label="Basic Info">
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <PickerField
                  label="Year *"
                  value={year}
                  placeholder="Select year"
                  onPress={() => setYearPickerVisible(true)}
                />
              </View>
              <View style={{ flex: 2 }}>
                <PickerField
                  label="Make *"
                  value={make}
                  placeholder="Select make"
                  onPress={() => { setMakeSearch(""); setMakePickerVisible(true); }}
                />
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

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Model *</Text>
              <TextInput
                ref={modelInputRef}
                style={styles.fieldInput}
                value={model}
                onChangeText={setModel}
                placeholder="Camry, F-150, Civic…"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>

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
        onSelect={selectMake}
        onClose={() => { setMakePickerVisible(false); setMakeSearch(""); }}
        insets={insets}
      />
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
            initialScrollIndex={selectedYear
              ? Math.max(0, YEARS.indexOf(selectedYear))
              : 0}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 340 }}
            renderItem={({ item: yr }) => {
              const isSelected = yr === selectedYear;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.yearRow,
                    isSelected && styles.yearRowSelected,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => onSelect(yr)}
                >
                  <Text style={[styles.yearRowText, isSelected && styles.yearRowTextSelected]}>
                    {yr}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark" size={18} color={Colors.vehicle} />
                  )}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function MakePickerModal({ visible, search, onSearchChange, filteredMakes, showCustomMake, onSelect, onClose, insets }: {
  visible: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  filteredMakes: string[];
  showCustomMake: boolean;
  onSelect: (m: string) => void;
  onClose: () => void;
  insets: { bottom: number };
}) {
  const searchRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => searchRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [visible]);

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
              placeholder="Search or type a custom make…"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          <FlatList
            data={filteredMakes}
            keyExtractor={m => m}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 320 }}
            renderItem={({ item: mk }) => (
              <Pressable
                style={({ pressed }) => [styles.makeRow, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => onSelect(mk)}
              >
                <Text style={styles.makeRowText}>{mk}</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
              </Pressable>
            )}
            ListFooterComponent={showCustomMake ? (
              <Pressable
                style={({ pressed }) => [styles.makeRow, styles.makeRowCustom, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => onSelect(search.trim())}
              >
                <View style={styles.makeRowCustomContent}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                  <Text style={styles.makeRowCustomText}>Use "{search.trim()}"</Text>
                </View>
                <Text style={styles.makeRowCustomSub}>Custom make</Text>
              </Pressable>
            ) : null}
            ListEmptyComponent={
              <View style={styles.makeEmpty}>
                <Text style={styles.makeEmptyText}>No matches — type your make above</Text>
              </View>
            }
          />
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
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.overdueMuted,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },

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
  pickerBtnPlaceholder: { color: Colors.textTertiary },

  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
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

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  typeOptionSelected: { backgroundColor: Colors.vehicleMuted, borderColor: Colors.vehicle },
  typeOptionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  typeOptionTextSelected: { color: Colors.vehicle },

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
    maxHeight: "75%",
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
  modalCancelBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  modalCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },

  yearRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: YEAR_ITEM_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  yearRowSelected: { backgroundColor: Colors.vehicleMuted },
  yearRowText: { fontSize: 17, fontFamily: "Inter_400Regular", color: Colors.text },
  yearRowTextSelected: { fontFamily: "Inter_600SemiBold", color: Colors.vehicle },

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

  makeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  makeRowText: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  makeRowCustom: {
    backgroundColor: Colors.accentLight,
    borderBottomWidth: 0,
    marginTop: 4,
  },
  makeRowCustomContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  makeRowCustomText: { fontSize: 16, fontFamily: "Inter_500Medium", color: Colors.accent },
  makeRowCustomSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.accent },
  makeEmpty: { paddingVertical: 32, alignItems: "center" },
  makeEmptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
});
