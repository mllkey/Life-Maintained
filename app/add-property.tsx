import React, { useState, useRef, useEffect, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { SaveToast } from "@/components/SaveToast";
import Paywall from "@/components/Paywall";
import { propertyLimit } from "@/lib/subscription";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";


const US_STATES = [
  { abbr: "AL", name: "Alabama" }, { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" }, { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" }, { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" }, { abbr: "DC", name: "District of Columbia" },
  { abbr: "DE", name: "Delaware" }, { abbr: "FL", name: "Florida" },
  { abbr: "GA", name: "Georgia" }, { abbr: "HI", name: "Hawaii" },
  { abbr: "ID", name: "Idaho" }, { abbr: "IL", name: "Illinois" },
  { abbr: "IN", name: "Indiana" }, { abbr: "IA", name: "Iowa" },
  { abbr: "KS", name: "Kansas" }, { abbr: "KY", name: "Kentucky" },
  { abbr: "LA", name: "Louisiana" }, { abbr: "ME", name: "Maine" },
  { abbr: "MD", name: "Maryland" }, { abbr: "MA", name: "Massachusetts" },
  { abbr: "MI", name: "Michigan" }, { abbr: "MN", name: "Minnesota" },
  { abbr: "MS", name: "Mississippi" }, { abbr: "MO", name: "Missouri" },
  { abbr: "MT", name: "Montana" }, { abbr: "NE", name: "Nebraska" },
  { abbr: "NV", name: "Nevada" }, { abbr: "NH", name: "New Hampshire" },
  { abbr: "NJ", name: "New Jersey" }, { abbr: "NM", name: "New Mexico" },
  { abbr: "NY", name: "New York" }, { abbr: "NC", name: "North Carolina" },
  { abbr: "ND", name: "North Dakota" }, { abbr: "OH", name: "Ohio" },
  { abbr: "OK", name: "Oklahoma" }, { abbr: "OR", name: "Oregon" },
  { abbr: "PA", name: "Pennsylvania" }, { abbr: "RI", name: "Rhode Island" },
  { abbr: "SC", name: "South Carolina" }, { abbr: "SD", name: "South Dakota" },
  { abbr: "TN", name: "Tennessee" }, { abbr: "TX", name: "Texas" },
  { abbr: "UT", name: "Utah" }, { abbr: "VT", name: "Vermont" },
  { abbr: "VA", name: "Virginia" }, { abbr: "WA", name: "Washington" },
  { abbr: "WV", name: "West Virginia" }, { abbr: "WI", name: "Wisconsin" },
  { abbr: "WY", name: "Wyoming" },
];

const PROPERTY_TYPES: { value: string; label: string; icon: string }[] = [
  { value: "house",      label: "House",         icon: "home" },
  { value: "condo",      label: "Condo",         icon: "office-building" },
  { value: "apartment",  label: "Apartment",     icon: "domain" },
  { value: "townhouse",  label: "Townhouse",     icon: "home-city" },
  { value: "commercial", label: "Commercial",    icon: "store" },
  { value: "vacation",   label: "Vacation Home", icon: "home-variant" },
  { value: "other",      label: "Other",         icon: "wrench" },
];

const TYPE_LABELS: Record<string, string> = {
  house: "House", condo: "Condo", apartment: "Apartment",
  townhouse: "Townhouse", commercial: "Commercial Building",
  vacation: "Vacation Home", other: "Property",
};

type PlaceSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

type ParsedAddress = {
  street: string;
  unit: string;
  city: string;
  stateCode: string;
  zip: string;
};

async function fetchSuggestions(query: string): Promise<PlaceSuggestion[]> {
  if (query.length < 2) return [];
  try {
    console.log("[places] invoking places-autocomplete with input:", query);
    const { data, error } = await supabase.functions.invoke("places-autocomplete", {
      body: { input: query },
    });
    console.log("[places] invoke result — data:", JSON.stringify(data), "error:", error);
    if (error) {
      console.warn("[places] invoke error:", error.message ?? error);
      return [];
    }
    if (!data?.suggestions) {
      console.warn("[places] no suggestions field in response:", data);
      return [];
    }
    console.log("[places] suggestions count:", data.suggestions.length);
    return data.suggestions;
  } catch (err) {
    console.error("[places] fetchSuggestions threw:", err);
    return [];
  }
}

async function fetchPlaceDetails(placeId: string): Promise<ParsedAddress | null> {
  try {
    const { data, error } = await supabase.functions.invoke("places-details", {
      body: { placeId },
    });
    if (error || !data?.addressComponents) return null;
    const components: { types: string[]; long_name: string; short_name: string }[] = data.addressComponents;
    const get = (type: string, useShort = false) => {
      const c = components.find((comp) => comp.types.includes(type));
      return c ? (useShort ? c.short_name : c.long_name) : "";
    };
    const streetNumber = get("street_number");
    const route = get("route");
    const street = [streetNumber, route].filter(Boolean).join(" ");
    const unit = get("subpremise");
    const city = get("locality") || get("sublocality_level_1") || get("postal_town");
    const stateCode = get("administrative_area_level_1", true);
    const zip = get("postal_code");
    return { street, unit, city, stateCode, zip };
  } catch {
    return null;
  }
}

export default function AddPropertyScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [nickname, setNickname] = useState("");
  const [propertyType, setPropertyType] = useState("house");
  const [yearBuilt, setYearBuilt] = useState("");
  const [sqft, setSqft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statePickerVisible, setStatePickerVisible] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLookingUpProperty, setIsLookingUpProperty] = useState(false);
  const [propertyAutoFilled, setPropertyAutoFilled] = useState(false);
  const [propertyRateLimited, setPropertyRateLimited] = useState(false);
  const [showToast, setShowToast] = useState(false);

  useFocusEffect(useCallback(() => {
    setStreet("");
    setUnit("");
    setCity("");
    setStateCode("");
    setZip("");
    setNickname("");
    setPropertyType("house");
    setYearBuilt("");
    setSqft("");
    setError(null);
    setSuggestions([]);
    setShowSuggestions(false);
    setIsLookingUpProperty(false);
    setPropertyAutoFilled(false);
    setPropertyRateLimited(false);
    setShowToast(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []));

  const onStreetChange = useCallback((text: string) => {
    setStreet(text);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsFetchingSuggestions(true);
      const results = await fetchSuggestions(text);
      console.log("[places] setting suggestions, count:", results.length, "showSuggestions:", results.length > 0);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setIsFetchingSuggestions(false);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  async function onSelectSuggestion(suggestion: PlaceSuggestion) {
    Haptics.selectionAsync();
    setStreet(suggestion.mainText);
    setShowSuggestions(false);
    setSuggestions([]);
    setPropertyAutoFilled(false);
    setPropertyRateLimited(false);

    const parsed = await fetchPlaceDetails(suggestion.placeId);
    if (!parsed) return;

    const resolvedStreet = parsed.street || suggestion.mainText;
    const resolvedCity = parsed.city || "";
    const resolvedState = parsed.stateCode || "";
    const resolvedZip = parsed.zip || "";

    if (parsed.street) setStreet(parsed.street);
    if (parsed.unit) setUnit(parsed.unit);
    if (parsed.city) setCity(parsed.city);
    if (parsed.stateCode) setStateCode(parsed.stateCode);
    if (parsed.zip) setZip(parsed.zip);

    if (resolvedStreet) {
      setIsLookingUpProperty(true);
      try {
        const { data } = await supabase.functions.invoke("property-lookup", {
          body: {
            address: resolvedStreet,
            city: resolvedCity,
            state: resolvedState,
            zip: resolvedZip,
          },
        });
        if (data?.rateLimited) {
          setPropertyRateLimited(true);
        } else if (data?.yearBuilt || data?.squareFootage) {
          if (data.yearBuilt) setYearBuilt(String(data.yearBuilt));
          if (data.squareFootage) setSqft(String(data.squareFootage));
          setPropertyAutoFilled(true);
        }
      } catch {
        // silent fail
      } finally {
        setIsLookingUpProperty(false);
      }
    }
  }

  function buildDefaultTasks(propertyId: string, pType: string, yearBuiltNum: number | null) {
    const now = new Date();
    const isoDate = (months: number) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() + months);
      return d.toISOString().split("T")[0];
    };
    const ts = now.toISOString();
    const isOld = yearBuiltNum !== null && yearBuiltNum < 1980;

    type TaskDef = { task: string; category: string; interval: string; estimated_cost: number; due_months: number };

    const houseTasks: TaskDef[] = [
      { task: "HVAC Filter Replacement", category: "HVAC", interval: "3_months", estimated_cost: 25, due_months: 1 },
      { task: "HVAC Annual Service", category: "HVAC", interval: "12_months", estimated_cost: 150, due_months: 6 },
      { task: "Gutter Cleaning", category: "Exterior", interval: "6_months", estimated_cost: 150, due_months: 3 },
      { task: "Roof Inspection", category: "Exterior", interval: "12_months", estimated_cost: 200, due_months: 6 },
      { task: "Smoke & CO Detector Test", category: "Safety", interval: "6_months", estimated_cost: 0, due_months: 1 },
      { task: "Pest Control Inspection", category: "Pest Control", interval: "12_months", estimated_cost: 125, due_months: 4 },
      { task: "Water Heater Flush", category: "Plumbing", interval: "12_months", estimated_cost: 75, due_months: 8 },
      { task: "Dryer Vent Cleaning", category: "Appliances", interval: "12_months", estimated_cost: 100, due_months: 5 },
    ];

    const condoTasks: TaskDef[] = [
      { task: "HVAC Filter Replacement", category: "HVAC", interval: "3_months", estimated_cost: 25, due_months: 1 },
      { task: "Smoke & CO Detector Test", category: "Safety", interval: "6_months", estimated_cost: 0, due_months: 1 },
      { task: "Dryer Vent Cleaning", category: "Appliances", interval: "12_months", estimated_cost: 100, due_months: 5 },
      { task: "Water Filter Replacement", category: "Plumbing", interval: "6_months", estimated_cost: 30, due_months: 3 },
    ];

    const commercialTasks: TaskDef[] = [
      { task: "HVAC Filter Replacement", category: "HVAC", interval: "3_months", estimated_cost: 50, due_months: 1 },
      { task: "HVAC Annual Service", category: "HVAC", interval: "12_months", estimated_cost: 300, due_months: 6 },
      { task: "Fire Extinguisher Inspection", category: "Safety", interval: "12_months", estimated_cost: 50, due_months: 3 },
      { task: "Roof Inspection", category: "Exterior", interval: "12_months", estimated_cost: 250, due_months: 6 },
      { task: "Pest Control", category: "Pest Control", interval: "3_months", estimated_cost: 150, due_months: 1 },
    ];

    const vacationTasks: TaskDef[] = [
      { task: "Seasonal Opening Inspection", category: "General", interval: "12_months", estimated_cost: 100, due_months: 3 },
      { task: "Smoke & CO Detector Test", category: "Safety", interval: "6_months", estimated_cost: 0, due_months: 1 },
      { task: "Pest Control Inspection", category: "Pest Control", interval: "12_months", estimated_cost: 125, due_months: 4 },
      { task: "HVAC Filter Replacement", category: "HVAC", interval: "6_months", estimated_cost: 25, due_months: 2 },
      { task: "Gutter Cleaning", category: "Exterior", interval: "12_months", estimated_cost: 150, due_months: 5 },
    ];

    const oldHomeTasks: TaskDef[] = [
      { task: "Plumbing System Inspection", category: "Plumbing", interval: "24_months", estimated_cost: 200, due_months: 2 },
      { task: "Electrical Panel Inspection", category: "Electrical", interval: "24_months", estimated_cost: 250, due_months: 3 },
      { task: "Foundation Inspection", category: "Structural", interval: "36_months", estimated_cost: 300, due_months: 4 },
    ];

    let base: TaskDef[];
    switch (pType) {
      case "condo": case "apartment": case "townhouse": base = condoTasks; break;
      case "commercial": base = commercialTasks; break;
      case "vacation": base = vacationTasks; break;
      default: base = houseTasks;
    }

    const all = isOld && (pType === "house" || pType === "townhouse") ? [...base, ...oldHomeTasks] : base;

    return all.map(t => ({
      user_id: user!.id,
      property_id: propertyId,
      task: t.task,
      category: t.category,
      interval: t.interval,
      estimated_cost: t.estimated_cost,
      next_due_date: isoDate(t.due_months),
      is_completed: false,
      created_at: ts,
      updated_at: ts,
    }));
  }

  async function handleSave() {
    if (!user) return;
    if (!street.trim()) {
      setError("Street address is required");
      return;
    }
    try {
      const { count } = await supabase
        .from("properties")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      if ((count ?? 0) >= propertyLimit(profile)) {
        setShowPaywall(true);
        return;
      }
    } catch {}
    setIsLoading(true);
    setError(null);

    const streetLine = unit.trim() ? `${street.trim()} ${unit.trim()}` : street.trim();
    const cityStateZip = [city.trim(), [stateCode, zip.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const fullAddress = [streetLine, cityStateZip].filter(Boolean).join(", ");
    const name = nickname.trim() || `${TYPE_LABELS[propertyType] ?? "Property"} — ${street.trim()}`;
    const yearBuiltNum = yearBuilt ? parseInt(yearBuilt) : null;

    const { data: newProperty, error: err } = await supabase.from("properties").insert({
      user_id: user.id,
      name,
      address: fullAddress || null,
      nickname: nickname.trim() || null,
      property_type: propertyType,
      year_built: yearBuiltNum,
      square_footage: sqft ? parseInt(sqft) : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("id").single();

    if (err) {
      setIsLoading(false);
      setError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (newProperty?.id) {
      const tasks = buildDefaultTasks(newProperty.id, propertyType, yearBuiltNum);
      await supabase.from("property_maintenance_tasks").insert(tasks);
    }

    setIsLoading(false);
    queryClient.invalidateQueries({ queryKey: ["properties"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowToast(true);
    setTimeout(() => router.dismiss(), 900);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
          <Pressable onPress={() => router.dismiss()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Property</Text>
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

          <FieldGroup label="Property Type">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.typeRow}
            >
              {PROPERTY_TYPES.map(t => {
                const isSelected = propertyType === t.value;
                return (
                  <Pressable
                    key={t.value}
                    style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                    onPress={() => { Haptics.selectionAsync(); setPropertyType(t.value); }}
                  >
                    <MaterialCommunityIcons
                      name={t.icon as any}
                      size={26}
                      color={isSelected ? Colors.home : Colors.textSecondary}
                    />
                    <Text style={[styles.typeCardLabel, isSelected && styles.typeCardLabelSelected]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </FieldGroup>

          <FieldGroup label="Address">
            <View style={{ gap: 5 }}>
              <Text style={styles.fieldLabel}>Street Address *</Text>
              <TextInput
                style={styles.input}
                value={street}
                onChangeText={onStreetChange}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                placeholder="123 Main St"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {isFetchingSuggestions && (
                <View style={styles.suggestionsCard}>
                  <ActivityIndicator size="small" color={Colors.accent} style={{ padding: 12 }} />
                </View>
              )}
              {showSuggestions && suggestions.length > 0 && (
                <View style={styles.suggestionsCard}>
                  {suggestions.map((s, idx) => (
                    <Pressable
                      key={s.placeId}
                      style={({ pressed }) => [
                        styles.suggestionRow,
                        idx < suggestions.length - 1 && styles.suggestionRowBorder,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={() => onSelectSuggestion(s)}
                    >
                      <Ionicons name="location-outline" size={16} color={Colors.textTertiary} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionMain} numberOfLines={1}>{s.mainText}</Text>
                        {!!s.secondaryText && (
                          <Text style={styles.suggestionSub} numberOfLines={1}>{s.secondaryText}</Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <Field label="Unit / Apt (optional)">
              <TextInput
                style={styles.input}
                value={unit}
                onChangeText={setUnit}
                placeholder="Apt 4B"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="characters"
                returnKeyType="next"
              />
            </Field>

            <View style={styles.row}>
              <Field label="City" style={{ flex: 2 }}>
                <TextInput
                  style={styles.input}
                  value={city}
                  onChangeText={setCity}
                  placeholder="Chicago"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </Field>
              <Field label="State" style={{ flex: 1 }}>
                <Pressable
                  style={[styles.input, styles.statePicker]}
                  onPress={() => setStatePickerVisible(true)}
                >
                  <Text style={[styles.statePickerText, !stateCode && { color: Colors.textTertiary }]}>
                    {stateCode || "State"}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
                </Pressable>
              </Field>
            </View>

            <Field label="ZIP Code">
              <TextInput
                style={styles.input}
                value={zip}
                onChangeText={setZip}
                placeholder="60601"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                maxLength={10}
                returnKeyType="next"
              />
            </Field>
          </FieldGroup>

          <FieldGroup label="Details">
            <Field label="Nickname (optional)">
              <TextInput
                style={styles.input}
                value={nickname}
                onChangeText={setNickname}
                placeholder="My House, Beach Condo…"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </Field>
            <View style={styles.row}>
              <Field label="Year Built" style={{ flex: 1 }}>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    value={yearBuilt}
                    onChangeText={(t) => { setYearBuilt(t); setPropertyAutoFilled(false); }}
                    placeholder="1985"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                    maxLength={4}
                    returnKeyType="next"
                  />
                  {isLookingUpProperty && (
                    <ActivityIndicator size="small" color={Colors.accent} style={styles.inputAdornment} />
                  )}
                  {!isLookingUpProperty && propertyAutoFilled && !!yearBuilt && (
                    <Ionicons name="checkmark-circle" size={18} color="#34C759" style={styles.inputAdornment} />
                  )}
                </View>
              </Field>
              <Field label="Sq Footage" style={{ flex: 1 }}>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    value={sqft}
                    onChangeText={(t) => { setSqft(t); setPropertyAutoFilled(false); }}
                    placeholder="2400"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                    returnKeyType="done"
                  />
                  {isLookingUpProperty && (
                    <ActivityIndicator size="small" color={Colors.accent} style={styles.inputAdornment} />
                  )}
                  {!isLookingUpProperty && propertyAutoFilled && !!sqft && (
                    <Ionicons name="checkmark-circle" size={18} color="#34C759" style={styles.inputAdornment} />
                  )}
                </View>
              </Field>
            </View>
            {propertyRateLimited && (
              <Text style={styles.rateLimitedText}>
                Property details unavailable right now — please enter manually
              </Text>
            )}
          </FieldGroup>
        </ScrollView>
      </View>

      <StatePickerModal
        visible={statePickerVisible}
        selected={stateCode}
        onSelect={(abbr) => { setStateCode(abbr); setStatePickerVisible(false); }}
        onClose={() => setStatePickerVisible(false)}
        insets={insets}
      />
      <SaveToast visible={showToast} message="Property saved!" />
      {showPaywall && (
        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <Paywall
            canDismiss
            subtitle="Upgrade to add more properties"
            onDismiss={() => setShowPaywall(false)}
          />
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

function StatePickerModal({ visible, selected, onSelect, onClose, insets }: {
  visible: boolean;
  selected: string;
  onSelect: (abbr: string) => void;
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
            <Text style={styles.modalTitle}>Select State</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
          </View>
          <FlatList
            data={US_STATES}
            keyExtractor={item => item.abbr}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 400 }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.stateRow, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => onSelect(item.abbr)}
              >
                <Text style={styles.stateAbbr}>{item.abbr}</Text>
                <Text style={styles.stateName}>{item.name}</Text>
                {selected === item.abbr && (
                  <Ionicons name="checkmark" size={16} color={Colors.home} />
                )}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.fieldGroupContent}>{children}</View>
    </View>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: 5 }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
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
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: {
    backgroundColor: Colors.home,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 20 },
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
  groupLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  fieldGroupContent: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  inputFlex: {
    flex: 1,
  },
  inputAdornment: {
    position: "absolute",
    right: 12,
  },
  rateLimitedText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    marginTop: 4,
  },
  statePicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statePickerText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },

  suggestionsCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    zIndex: 100,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  suggestionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  suggestionMain: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  suggestionSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    marginTop: 1,
  },

  typeRow: { gap: 8, paddingVertical: 2 },
  typeCard: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minWidth: 80,
  },
  typeCardSelected: {
    backgroundColor: Colors.homeMuted,
    borderColor: Colors.home,
  },
  typeCardLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  typeCardLabelSelected: {
    color: Colors.home,
    fontFamily: "Inter_600SemiBold",
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  modalCancel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
    minHeight: 44,
  },
  stateAbbr: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    width: 32,
  },
  stateName: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
});
