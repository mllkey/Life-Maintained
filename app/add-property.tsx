import React, { useState, useRef, useEffect, useCallback } from "react";
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

const PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? "";

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
  if (!PLACES_API_KEY || query.length < 2) return [];
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&components=country:us&types=address&key=${PLACES_API_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") return [];
    return (json.predictions ?? []).slice(0, 5).map((p: {
      place_id: string;
      description: string;
      structured_formatting: { main_text: string; secondary_text: string };
    }) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));
  } catch {
    return [];
  }
}

async function fetchPlaceDetails(placeId: string): Promise<ParsedAddress | null> {
  if (!PLACES_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=address_components&key=${PLACES_API_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.status !== "OK") return null;
    const components: { types: string[]; long_name: string; short_name: string }[] = json.result?.address_components ?? [];
    const get = (type: string, useShort = false) => {
      const c = components.find(c => c.types.includes(type));
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
  const { user } = useAuth();
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

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onStreetChange = useCallback((text: string) => {
    setStreet(text);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!PLACES_API_KEY || text.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsFetchingSuggestions(true);
      const results = await fetchSuggestions(text);
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
    const parsed = await fetchPlaceDetails(suggestion.placeId);
    if (parsed) {
      if (parsed.street) setStreet(parsed.street);
      if (parsed.unit) setUnit(parsed.unit);
      if (parsed.city) setCity(parsed.city);
      if (parsed.stateCode) setStateCode(parsed.stateCode);
      if (parsed.zip) setZip(parsed.zip);
    }
  }

  async function handleSave() {
    if (!user) return;
    if (!street.trim()) {
      setError("Street address is required");
      return;
    }
    setIsLoading(true);
    setError(null);

    const streetLine = unit.trim() ? `${street.trim()} ${unit.trim()}` : street.trim();
    const cityStateZip = [city.trim(), [stateCode, zip.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const fullAddress = [streetLine, cityStateZip].filter(Boolean).join(", ");
    const name = nickname.trim() || `${TYPE_LABELS[propertyType] ?? "Property"} — ${street.trim()}`;

    const { error: err } = await supabase.from("properties").insert({
      user_id: user.id,
      name,
      address: fullAddress || null,
      nickname: nickname.trim() || null,
      property_type: propertyType,
      year_built: yearBuilt ? parseInt(yearBuilt) : null,
      square_footage: sqft ? parseInt(sqft) : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setIsLoading(false);
    if (err) {
      setError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
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
                placeholder="1025 Potomac Ct"
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
                  placeholder="Springfield"
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
                placeholder="62701"
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
                <TextInput
                  style={styles.input}
                  value={yearBuilt}
                  onChangeText={setYearBuilt}
                  placeholder="1985"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                  maxLength={4}
                  returnKeyType="next"
                />
              </Field>
              <Field label="Sq Footage" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  value={sqft}
                  onChangeText={setSqft}
                  placeholder="2400"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </Field>
            </View>
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
