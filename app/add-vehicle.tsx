import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  FlatList,
  SectionList,
  Modal,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import Paywall from "@/components/Paywall";
import { vehicleLimit } from "@/lib/subscription";
import { MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_ITEM_HEIGHT = 52;
const MODEL_ITEM_HEIGHT = 52;

const modelCache = new Map<string, string[]>();
function modelCacheKey(make: string, year: string, vType: string): string {
  return `${make.trim().toLowerCase()}:${year}:${vType}`;
}

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
    "Pontiac", "Saturn", "Mercury", "Scion", "Hummer", "Fiat", "Saab",
    "Suzuki", "Isuzu", "Oldsmobile", "Plymouth", "Polestar", "VinFast",
    "Smart", "Fisker",
  ],
  motorcycle: [
    "Harley-Davidson", "Honda", "Kawasaki", "Yamaha", "Suzuki", "Ducati",
    "BMW", "KTM", "Triumph", "Royal Enfield", "Indian", "Can-Am",
    "Zero Motorcycles", "Aprilia", "Moto Guzzi", "Husqvarna", "Benelli",
    "CFMoto", "LiveWire", "Vespa", "Buell", "MV Agusta",
  ],
  rv: [
    "Winnebago", "Airstream", "Thor Industries", "Forest River", "Coachmen",
    "Keystone", "Grand Design", "Jayco", "Heartland", "Tiffin", "Newmar",
    "Fleetwood",
    "Dutchmen", "CrossRoads", "Venture RV", "Palomino", "Lance", "nuCamp",
    "Pleasure-Way", "Roadtrek", "Entegra",
  ],
  boat: [
    "Sea Ray", "Bayliner", "Boston Whaler", "Malibu", "MasterCraft",
    "Grady-White", "Lund", "Tracker", "Chaparral", "Cobalt", "Ranger",
    "Crestliner", "Nitro", "Skeeter", "Triton", "Alumacraft",
    "Yamaha", "Bennington", "Robalo", "Wellcraft", "Key West", "Stingray",
    "Carolina Skiff", "Regulator", "Scout Boats", "Sylvan", "Sun Tracker",
    "Godfrey",
  ],
  atv: [
    "Honda", "Yamaha", "Can-Am", "Polaris", "Kawasaki",
    "Suzuki", "Arctic Cat", "CFMoto",
    "KYMCO", "Segway",
  ],
  utv: [
    "Polaris", "Can-Am", "Kawasaki", "Yamaha", "Honda",
    "Arctic Cat", "Textron", "John Deere", "Kubota", "CFMoto",
    "KYMCO", "Segway", "Hisun",
  ],
  pwc: ["Sea-Doo", "Yamaha", "Kawasaki"],
  snowmobile: ["Ski-Doo", "Polaris", "Arctic Cat", "Yamaha", "Lynx", "Taiga"],
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
  { title: "F", data: ["Fiat", "Fisker"] },
  { title: "G", data: ["Genesis"] },
  { title: "H", data: ["Hummer"] },
  { title: "I", data: ["Infiniti", "Isuzu"] },
  { title: "J", data: ["Jaguar"] },
  { title: "L", data: ["Land Rover", "Lexus", "Lincoln", "Lucid"] },
  { title: "M", data: ["Mazda", "Mercedes-Benz", "Mercury", "Mini", "Mitsubishi"] },
  { title: "O", data: ["Oldsmobile"] },
  { title: "P", data: ["Plymouth", "Polestar", "Pontiac", "Porsche"] },
  { title: "R", data: ["Rivian"] },
  { title: "S", data: ["Saab", "Saturn", "Scion", "Scout", "Smart", "Suzuki"] },
  { title: "T", data: ["Tesla"] },
  { title: "V", data: ["VinFast", "Volkswagen", "Volvo"] },
];

const MOTO_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Harley-Davidson", "Honda", "Kawasaki", "Yamaha", "Suzuki"] },
  { title: "A", data: ["Aprilia"] },
  { title: "B", data: ["Benelli", "BMW", "Buell"] },
  { title: "C", data: ["Can-Am", "CFMoto"] },
  { title: "D", data: ["Ducati"] },
  { title: "H", data: ["Husqvarna"] },
  { title: "I", data: ["Indian"] },
  { title: "K", data: ["KTM"] },
  { title: "L", data: ["LiveWire"] },
  { title: "M", data: ["Moto Guzzi", "MV Agusta"] },
  { title: "R", data: ["Royal Enfield"] },
  { title: "T", data: ["Triumph"] },
  { title: "V", data: ["Vespa"] },
  { title: "Z", data: ["Zero Motorcycles"] },
];

const ATV_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Honda", "Yamaha", "Can-Am", "Polaris", "Kawasaki"] },
  { title: "A", data: ["Arctic Cat"] },
  { title: "C", data: ["CFMoto"] },
  { title: "K", data: ["KYMCO"] },
  { title: "S", data: ["Segway", "Suzuki"] },
];

const UTV_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Polaris", "Can-Am", "Kawasaki", "Yamaha"] },
  { title: "A", data: ["Arctic Cat"] },
  { title: "C", data: ["CFMoto"] },
  { title: "H", data: ["Hisun", "Honda"] },
  { title: "J", data: ["John Deere"] },
  { title: "K", data: ["Kubota", "KYMCO"] },
  { title: "S", data: ["Segway"] },
  { title: "T", data: ["Textron"] },
];

const PWC_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Sea-Doo", "Yamaha", "Kawasaki"] },
];

const SNOWMOBILE_MAKE_SECTIONS: MakeSection[] = [
  { title: "Most Popular", data: ["Ski-Doo", "Polaris", "Arctic Cat"] },
  { title: "L", data: ["Lynx"] },
  { title: "T", data: ["Taiga"] },
  { title: "Y", data: ["Yamaha"] },
];

const MAKE_SECTIONS_BY_TYPE: Record<string, MakeSection[]> = {
  car: CAR_MAKE_SECTIONS,
  motorcycle: MOTO_MAKE_SECTIONS,
  atv: ATV_MAKE_SECTIONS,
  utv: UTV_MAKE_SECTIONS,
  pwc: PWC_MAKE_SECTIONS,
  snowmobile: SNOWMOBILE_MAKE_SECTIONS,
};


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isMonthInRange(month: number, start: number | null, end: number | null): boolean {
  if (start === null) return false;
  if (end === null) return month === start;
  if (start <= end) return month >= start && month <= end;
  return month >= start || month <= end;
}

function countMonthsInRange(start: number | null, end: number | null): number {
  if (start === null || end === null) return 0;
  if (start <= end) return end - start + 1;
  return (12 - start + 1) + end;
}

const VEHICLE_TYPES: { value: string; label: string; icon: string }[] = [
  { value: "car",        label: "Car / Truck / SUV",    icon: "car" },
  { value: "motorcycle", label: "Motorcycle",            icon: "motorbike" },
  { value: "rv",         label: "RV / Camper",           icon: "rv-truck" },
  { value: "boat",       label: "Boat",                  icon: "sail-boat" },
  { value: "atv",        label: "ATV",                   icon: "atv" },
  { value: "utv",        label: "UTV / Side-by-Side",    icon: "atv" },
  { value: "pwc",        label: "Personal Watercraft",   icon: "waves" },
  { value: "snowmobile", label: "Snowmobile",            icon: "snowmobile" },
  { value: "other",      label: "Other",                 icon: "wrench" },
];

const FUEL_TYPES: { value: "gas" | "diesel" | "hybrid" | "ev"; label: string }[] = [
  { value: "gas",     label: "Gas" },
  { value: "diesel",  label: "Diesel" },
  { value: "hybrid",  label: "Hybrid" },
  { value: "ev",      label: "Electric" },
];

const FUEL_OPTIONS_BY_TYPE: Record<string, ("gas" | "diesel" | "hybrid" | "ev")[]> = {
  car:        ["gas", "diesel", "hybrid", "ev"],
  motorcycle: ["gas", "ev"],
  rv:         ["gas", "diesel"],
  other:      ["gas", "diesel", "hybrid", "ev"],
};

const AWD_TYPES = new Set(["car", "rv", "utv", "other"]);

const HARDCODED_MODELS: Record<string, Record<string, string[]>> = {
  pwc: {
    "Sea-Doo": [
      "Fish Pro Scout", "Fish Pro Sport", "Fish Pro Trophy",
      "GTI 90", "GTI 130", "GTI SE 130", "GTI SE 170",
      "GTX 170", "GTX 230", "GTX Limited 230", "GTX Limited 300",
      "RXP-X 300", "RXP-X 325",
      "RXT 230", "RXT-X 300", "RXT-X 325",
      "Spark", "Spark Trixx",
      "Wake 170", "Wake Pro 230",
    ],
    "Yamaha": [
      "EX", "EX Deluxe", "EX Sport",
      "FX Cruiser HO", "FX Cruiser SVHO",
      "FX HO", "FX SVHO",
      "GP1800R HO", "GP1800R SVHO",
      "VX", "VX Cruiser", "VX Cruiser HO", "VX Deluxe", "VX Limited",
    ],
    "Kawasaki": [
      "Jet Ski STX 160", "Jet Ski STX 160LX",
      "Jet Ski Ultra 160",
      "Jet Ski Ultra 310LX", "Jet Ski Ultra 310R", "Jet Ski Ultra 310X", "Jet Ski Ultra 310X SE",
      "Jet Ski SX-R 160",
    ],
  },
  snowmobile: {
    "Ski-Doo": [
      "Backcountry 850", "Backcountry X 850", "Backcountry X-RS 850",
      "Expedition LE 900 ACE", "Expedition SE 900 ACE", "Expedition Sport 900 ACE",
      "Freeride 154 850", "Freeride 165 850",
      "Grand Touring LE 900 ACE", "Grand Touring SE 900 ACE",
      "MXZ Sport 600", "MXZ X 850", "MXZ X-RS 850",
      "Renegade Enduro 850", "Renegade X 850", "Renegade X-RS 850",
      "Skandic SWT 600", "Skandic WT 600",
      "Summit Expert 154 850", "Summit X 154 850", "Summit X Expert 165 850",
      "Tundra Sport 600",
    ],
    "Polaris": [
      "850 Indy XC 129", "850 Indy XC 137",
      "Indy Adventure 137", "Indy Trail 550",
      "Patriot Boost RMK Khaos 163",
      "Patriot Boost Switchback Assault 146", "Patriot Boost Switchback Pro-S 850",
      "RMK Khaos Matryx Slash 155",
      "Switchback 850", "Switchback Assault 850", "Switchback Pro-S 850",
      "Titan Adventure 155", "Titan XC 155 550",
      "Trail 550", "Voyageur 550",
    ],
    "Arctic Cat": [
      "Blast M 4000", "Blast XR 6000",
      "Catalyst 600", "Catalyst 800",
      "M 8000 Mountain Cat Alpha One 153",
      "Riot 8000", "Riot X 8000",
      "Thundercat 9000 ARR",
      "ZR 200", "ZR 6000 El Tigre", "ZR 8000 RR", "ZR 9000 Thundercat",
    ],
    "Yamaha": [
      "Apex XT-X",
      "Sidewinder B-TX LE", "Sidewinder L-TX GT", "Sidewinder L-TX LE",
      "Sidewinder M-TX LE 153", "Sidewinder S-TX GT", "Sidewinder X-TX SE",
      "Transporter 800",
    ],
    "Lynx": [
      "Boondocker RE 3700 850 E-TEC",
      "Commander RE 3700 600R E-TEC",
      "Rave RE 3700 850 E-TEC",
      "Shredder RE 3700 850 E-TEC",
    ],
  },
};

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
  if (t.includes("snowmobile")) return "snowmobile";
  if (t.includes("watercraft") || t.includes("jet ski") || t.includes("waverunner") || t.includes("personal water")) return "pwc";
  if (t.includes("utv") || t.includes("side-by-side") || t.includes("side by side")) return "utv";
  if (t.includes("atv") || t.includes("off-road") || t.includes("offroad") || t.includes("quad")) return "atv";
  if (t.includes("boat") || t.includes("marine") || t.includes("vessel") || t.includes("yacht")) return "boat";
  if (t.includes("truck") || t.includes("mpv") || t.includes("multipurpose") || t.includes("passenger car") || t.includes("passenger vehicle") || t.includes("low speed")) return "car";
  return "other";
}

function CopyFromVehicleModal({
  visible,
  newVehicleId,
  userId,
  candidates,
  onClose,
}: {
  visible: boolean;
  newVehicleId: string | null;
  userId: string;
  candidates: { id: string; year: number; make: string; model: string; nickname: string | null }[];
  onClose: () => void;
}) {
  const [copying, setCopying] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  async function copyDocs(fromVehicleId: string) {
    if (!newVehicleId || copying) return;
    setCopying(fromVehicleId);
    try {
      const { data: docs } = await supabase
        .from("vehicle_wallet_documents")
        .select("*")
        .eq("vehicle_id", fromVehicleId)
        .eq("user_id", userId)
        .in("document_type", ["insurance", "registration"]);
      if (docs && docs.length > 0) {
        const inserts = docs.map((d: any) => ({
          vehicle_id: newVehicleId,
          user_id: userId,
          document_type: d.document_type,
          data: d.data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        await supabase.from("vehicle_wallet_documents").insert(inserts);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn("[CopyFromVehicleModal] copy error:", e);
    } finally {
      setCopying(null);
      onClose();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={copyStyles.overlay}>
        <Pressable style={copyStyles.backdrop} onPress={onClose} />
        <View style={[copyStyles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={copyStyles.handle} />
          <Text style={copyStyles.title}>Copy Documents?</Text>
          <Text style={copyStyles.subtitle}>Import insurance and registration from another vehicle</Text>

          {candidates.map(v => {
            const isCopying = copying === v.id;
            const label = v.nickname
              ? `${v.nickname} (${v.year} ${v.make} ${v.model})`
              : `${v.year} ${v.make} ${v.model}`;
            return (
              <Pressable
                key={v.id}
                style={({ pressed }) => [copyStyles.vehicleRow, { opacity: pressed || !!copying ? 0.7 : 1 }]}
                onPress={() => copyDocs(v.id)}
                disabled={!!copying}
              >
                <View style={copyStyles.vehicleIcon}>
                  <Ionicons name="car-outline" size={20} color={Colors.accent} />
                </View>
                <Text style={copyStyles.vehicleLabel} numberOfLines={1}>{label}</Text>
                {isCopying
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
                }
              </Pressable>
            );
          })}

          <Pressable
            style={({ pressed }) => [copyStyles.skipBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={onClose}
            disabled={!!copying}
          >
            <Text style={copyStyles.skipText}>Skip</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const copyStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center", marginBottom: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.text, marginBottom: 6 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginBottom: 20 },
  vehicleRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  vehicleIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Colors.accentLight,
    alignItems: "center", justifyContent: "center",
  },
  vehicleLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  skipBtn: {
    marginTop: 16, paddingVertical: 14, alignItems: "center",
  },
  skipText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
});

export default function AddVehicleScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: walletCandidates } = useQuery<{ id: string; year: number; make: string; model: string; nickname: string | null }[]>({
    queryKey: ["wallet_copy_candidates", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data: docVehicles } = await supabase
        .from("vehicle_wallet_documents")
        .select("vehicle_id")
        .eq("user_id", user.id)
        .in("document_type", ["insurance", "registration"]);
      if (!docVehicles?.length) return [];
      const vehicleIds = [...new Set(docVehicles.map((d: any) => d.vehicle_id as string))];
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("id, year, make, model, nickname")
        .eq("user_id", user.id)
        .in("id", vehicleIds);
      return (vehicles ?? []) as { id: string; year: number; make: string; model: string; nickname: string | null }[];
    },
    enabled: !!user,
  });

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [nickname, setNickname] = useState("");
  const [vehicleType, setVehicleType] = useState("car");
  const [mileage, setMileage] = useState("");
  const [avgMilesPerMonth, setAvgMilesPerMonth] = useState("");
  const [isSeasonal, setIsSeasonal] = useState(false);
  const [seasonStartMonth, setSeasonStartMonth] = useState<number | null>(null);
  const [seasonEndMonth, setSeasonEndMonth] = useState<number | null>(null);
  const [fuelType, setFuelType] = useState<"gas" | "diesel" | "hybrid" | "ev">("gas");
  const [isAwd, setIsAwd] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [savedVehicleId, setSavedVehicleId] = useState<string | null>(null);

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
    } else if (vehicleType === "pwc" || vehicleType === "snowmobile") {
      const byMake = HARDCODED_MODELS[vehicleType] ?? {};
      const models = byMake[make.trim()] ?? [];
      setNhtsaModels(models);
      setIsLoadingModels(false);
    } else {
      const cacheKey = modelCacheKey(make, year, vehicleType);
      const cached = modelCache.get(cacheKey);
      if (cached) {
        setNhtsaModels(cached);
        setIsLoadingModels(false);
      } else {
        setIsLoadingModels(true);
        setNhtsaModels([]);
      }

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
            const [passengerResp, truckResp, mpvResp] = await Promise.all([
              fetch(`${nhtsaBase}?format=json&vehicleType=Passenger%20Car`),
              fetch(`${nhtsaBase}?format=json&vehicleType=Truck`),
              fetch(`${nhtsaBase}?format=json&vehicleType=Multipurpose%20Passenger%20Vehicle%20(MPV)`),
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
          } else if (vehicleType === "rv") {
            const [incompleteResp, busResp, mpvResp] = await Promise.all([
              fetch(`${nhtsaBase}?format=json&vehicleType=Incomplete%20Vehicle`),
              fetch(`${nhtsaBase}?format=json&vehicleType=Bus`),
              fetch(`${nhtsaBase}?format=json&vehicleType=Multipurpose%20Passenger%20Vehicle%20(MPV)`),
            ]);
            const [incompleteJson, busJson, mpvJson] = await Promise.all([
              incompleteResp.json(),
              busResp.json(),
              mpvResp.json(),
            ]);
            names = [...new Set([
              ...extractNames(incompleteJson),
              ...extractNames(busJson),
              ...extractNames(mpvJson),
            ])];
          } else if (vehicleType === "motorcycle") {
            const motoResp = await fetch(`${nhtsaBase}?format=json&vehicleType=Motorcycle`);
            const motoJson = await motoResp.json();
            names = extractNames(motoJson);
          } else if (vehicleType === "atv" || vehicleType === "utv") {
            const offRoadResp = await fetch(`${nhtsaBase}?format=json&vehicleType=Off%20Road%20Vehicle`);
            const offRoadJson = await offRoadResp.json();
            names = extractNames(offRoadJson);
          } else {
            const allResp = await fetch(`${nhtsaBase}?format=json`);
            const allJson = await allResp.json();
            names = extractNames(allJson);
          }

          if (names.length < 3) {
            const allResp = await fetch(`${nhtsaBase}?format=json`);
            const allJson = await allResp.json();
            names = [...new Set([...names, ...extractNames(allJson)])];
          }

          if (!modelCancelled) {
            const sorted = names.sort();
            modelCache.set(cacheKey, sorted);
            setNhtsaModels(sorted);
            setIsLoadingModels(false);
          }
        } catch {
          if (!modelCancelled) {
            setNhtsaModels([]);
            setIsLoadingModels(false);
          }
        }
      }

      if (!cached) loadModels();
    }

    return () => {
      schedCancelled = true;
      modelCancelled = true;
    };
  }, [year, make, vehicleType]);

  useEffect(() => {
    if (!AWD_TYPES.has(vehicleType)) {
      setIsAwd(false);
    }
    const allowedFuels = FUEL_OPTIONS_BY_TYPE[vehicleType];
    if (allowedFuels && !allowedFuels.includes(fuelType)) {
      setFuelType("gas");
    }
    if (!allowedFuels) {
      setFuelType("gas");
    }
  }, [vehicleType]);

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
        setVinError("Invalid VIN. Please check and try again.");
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
      setVinError("Could not reach lookup service. Check your connection.");
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

  function handleMonthTap(m: number) {
    Haptics.selectionAsync();
    if (seasonStartMonth === null || (seasonStartMonth !== null && seasonEndMonth !== null)) {
      setSeasonStartMonth(m);
      setSeasonEndMonth(null);
    } else {
      if (m === seasonStartMonth) {
        setSeasonStartMonth(null);
      } else {
        setSeasonEndMonth(m);
      }
    }
  }

  function applyPreset(start: number, end: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSeasonStartMonth(start);
    setSeasonEndMonth(end);
  }

  async function handleSave() {
    if (isLoading) return;
    if (!user) {
      setError("Session unavailable. Please close and reopen this screen.");
      return;
    }

    // 1. Validate — all existing checks unchanged
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

    // 2. Paywall check (must await before dismissing — can't dismiss if paywall needs to show)
    try {
      const { count } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      if ((count ?? 0) >= vehicleLimit(profile)) {
        setShowPaywall(true);
        return;
      }
    } catch {}

    const hasCandidates = walletCandidates && walletCandidates.length > 0;
    const vehicleData = {
      user_id: user.id,
      year: yearNum,
      make: make.trim(),
      model: model.trim(),
      trim: trim.trim() || null,
      nickname: nickname.trim() || null,
      vehicle_type: vehicleType,
      fuel_type: fuelType,
      is_awd: isAwd,
      mileage: mileage ? parseInt(mileage) : null,
      average_miles_per_month: avgMilesPerMonth ? parseInt(avgMilesPerMonth) : null,
      is_seasonal: isSeasonal,
      season_start_month: isSeasonal ? seasonStartMonth : null,
      season_end_month: isSeasonal ? seasonEndMonth : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!hasCandidates) {
      // 3a. No copy candidates — instant nav + background save (original flow)
      setIsLoading(true);
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_tasks"] });
      router.back();

      try {
        const { data: inserted, error: err } = await supabase
          .from("vehicles")
          .insert(vehicleData)
          .select("id")
          .single();
        if (err || !inserted) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Save Failed", err?.message ?? "Failed to save vehicle. Please try again.");
          return;
        }
        try {
          console.log("[generate-maintenance-schedule] Invoking for vehicle:", inserted.id);
          const { error: scheduleError } = await supabase.functions.invoke(
            "generate-maintenance-schedule",
            { body: { vehicle_id: inserted.id, make: make.trim(), year: yearNum, current_mileage: mileage ? parseInt(mileage) : 0, vehicle_type: fuelType, is_awd: isAwd, vehicle_category: vehicleType } },
          );
          if (scheduleError) {
            const httpStatus = ((scheduleError as unknown as Record<string, unknown>)?.context as Record<string, unknown>)?.status as number | undefined;
            if (httpStatus !== 409) console.warn("[generate-maintenance-schedule] Error:", scheduleError.message);
          } else {
            console.log("[generate-maintenance-schedule] Success for vehicle:", inserted.id);
          }
        } catch (scheduleErr) {
          console.warn("[generate-maintenance-schedule] Caught:", scheduleErr);
        }
        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["maintenance_tasks"] });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (saveErr) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Save Failed", "Failed to save vehicle. Please try again.");
      }
      return;
    }

    // 3b. Copy candidates exist — save first (show spinner), then show copy modal
    setIsLoading(true);
    try {
      const { data: inserted, error: err } = await supabase
        .from("vehicles")
        .insert(vehicleData)
        .select("id")
        .single();
      if (err || !inserted) {
        setIsLoading(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Save Failed", err?.message ?? "Failed to save vehicle. Please try again.");
        return;
      }
      try {
        console.log("[generate-maintenance-schedule] Invoking for vehicle:", inserted.id);
        const { error: scheduleError } = await supabase.functions.invoke(
          "generate-maintenance-schedule",
          { body: { vehicle_id: inserted.id, make: make.trim(), year: yearNum, current_mileage: mileage ? parseInt(mileage) : 0, vehicle_type: fuelType, is_awd: isAwd, vehicle_category: vehicleType } },
        );
        if (scheduleError) {
          const httpStatus = ((scheduleError as unknown as Record<string, unknown>)?.context as Record<string, unknown>)?.status as number | undefined;
          if (httpStatus !== 409) console.warn("[generate-maintenance-schedule] Error:", scheduleError.message);
        } else {
          console.log("[generate-maintenance-schedule] Success for vehicle:", inserted.id);
        }
      } catch (scheduleErr) {
        console.warn("[generate-maintenance-schedule] Caught:", scheduleErr);
      }
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_tasks"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedVehicleId(inserted.id);
      setShowCopyModal(true);
    } catch (saveErr) {
      setIsLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Save Failed", "Failed to save vehicle. Please try again.");
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
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

          {/* ── Powertrain ───────────────────────────────────── */}
          {(FUEL_OPTIONS_BY_TYPE[vehicleType] || AWD_TYPES.has(vehicleType)) && (
            <FieldGroup label="Powertrain">
              {FUEL_OPTIONS_BY_TYPE[vehicleType] && (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Fuel Type</Text>
                  <View style={styles.segControl}>
                    {FUEL_TYPES.filter(ft => FUEL_OPTIONS_BY_TYPE[vehicleType].includes(ft.value)).map(ft => {
                      const isSelected = fuelType === ft.value;
                      return (
                        <Pressable
                          key={ft.value}
                          style={[styles.segOption, isSelected && styles.segOptionSelected]}
                          onPress={() => { Haptics.selectionAsync(); setFuelType(ft.value); }}
                        >
                          <Text style={[styles.segOptionText, isSelected && styles.segOptionTextSelected]}>
                            {ft.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
              {AWD_TYPES.has(vehicleType) && (
                <Pressable
                  style={styles.toggleRow}
                  onPress={() => { Haptics.selectionAsync(); setIsAwd(!isAwd); }}
                >
                  <View>
                    <Text style={styles.toggleLabel}>AWD / 4WD</Text>
                    <Text style={styles.toggleSub}>All-wheel or four-wheel drive</Text>
                  </View>
                  <View style={[styles.toggle, isAwd && styles.toggleOn]}>
                    <View style={[styles.toggleThumb, isAwd && styles.toggleThumbOn]} />
                  </View>
                </Pressable>
              )}
            </FieldGroup>
          )}

          {/* ── Mileage ───────────────────────────────────────── */}
          {MILEAGE_TRACKED_TYPES.has(vehicleType) && (
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
            </FieldGroup>
          )}

          {/* ── Options ───────────────────────────────────────── */}
          <FieldGroup label="Options">
            <Pressable
              style={styles.toggleRow}
              onPress={() => {
                Haptics.selectionAsync();
                const next = !isSeasonal;
                setIsSeasonal(next);
                if (!next) { setSeasonStartMonth(null); setSeasonEndMonth(null); }
              }}
            >
              <View>
                <Text style={styles.toggleLabel}>Seasonal Vehicle</Text>
                <Text style={styles.toggleSub}>Motorcycles, boats, snowmobiles, etc.</Text>
              </View>
              <View style={[styles.toggle, isSeasonal && styles.toggleOn]}>
                <View style={[styles.toggleThumb, isSeasonal && styles.toggleThumbOn]} />
              </View>
            </Pressable>

            {isSeasonal && (
              <View style={styles.monthPickerWrap}>
                <Text style={styles.monthPickerLabel}>Active months — when this vehicle is in use</Text>

                <View style={styles.presetRow}>
                  {([
                    { label: "Spring–Fall", start: 4, end: 10 },
                    { label: "Winter",      start: 11, end: 3 },
                    { label: "Summer",      start: 5, end: 9 },
                  ] as { label: string; start: number; end: number }[]).map(preset => {
                    const active = seasonStartMonth === preset.start && seasonEndMonth === preset.end;
                    return (
                      <Pressable
                        key={preset.label}
                        style={[styles.presetChip, active && styles.presetChipActive]}
                        onPress={() => applyPreset(preset.start, preset.end)}
                      >
                        <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {[0, 1, 2].map(row => (
                  <View key={row} style={styles.monthRow}>
                    {MONTHS.slice(row * 4, row * 4 + 4).map((abbr, col) => {
                      const monthNum = row * 4 + col + 1;
                      const inRange = isMonthInRange(monthNum, seasonStartMonth, seasonEndMonth);
                      const isEdge = monthNum === seasonStartMonth || monthNum === seasonEndMonth;
                      return (
                        <Pressable
                          key={monthNum}
                          style={({ pressed }) => [
                            styles.monthTile,
                            inRange && styles.monthTileSelected,
                            isEdge && styles.monthTileEdge,
                            { opacity: pressed ? 0.75 : 1 },
                          ]}
                          onPress={() => handleMonthTap(monthNum)}
                        >
                          <Text style={[styles.monthTileText, inRange && styles.monthTileTextSelected]}>
                            {abbr}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}

                {seasonStartMonth !== null && seasonEndMonth !== null && (
                  <Text style={styles.monthRangeSummary}>
                    {MONTHS[seasonStartMonth - 1]} – {MONTHS[seasonEndMonth - 1]}
                    {" "}({countMonthsInRange(seasonStartMonth, seasonEndMonth)} months active)
                  </Text>
                )}
                {seasonStartMonth !== null && seasonEndMonth === null && (
                  <Text style={styles.monthRangeSummary}>Tap a second month to complete the range</Text>
                )}
              </View>
            )}
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
      {showPaywall && (
        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <Paywall
            canDismiss
            subtitle="Upgrade to add more vehicles"
            onDismiss={() => setShowPaywall(false)}
          />
        </Modal>
      )}

      <CopyFromVehicleModal
        visible={showCopyModal}
        newVehicleId={savedVehicleId}
        userId={user?.id ?? ""}
        candidates={walletCandidates ?? []}
        onClose={() => {
          setShowCopyModal(false);
          router.back();
        }}
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
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Year</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <Pressable onPress={onClose} style={styles.modalCancelBtn} hitSlop={8}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleDone} hitSlop={8}>
                <Text style={[styles.modalCancelText, { color: Colors.accent, fontFamily: "Inter_600SemiBold" }]}>Done</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.yearSearchWrap}>
            <TextInput
              style={styles.yearSearchInput}
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
                    styles.listRow,
                    (isSelected || isHighlighted) && styles.listRowSelected,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => { onSelect(yr); setYearInput(""); }}
                >
                  <Text style={[styles.listRowText, (isSelected || isHighlighted) && styles.listRowTextSelected]}>
                    {yr}
                  </Text>
                  {(isSelected || isHighlighted) && <Ionicons name="checkmark" size={18} color={Colors.vehicle} />}
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
      <Text style={styles.listEmptyText}>No matches. Type your make above.</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ paddingBottom: 20 }}
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
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item: mk }) => (
                <MakeRow mk={mk} onSelect={onSelect} />
              )}
              ListFooterComponent={customFooter}
              ListEmptyComponent={emptyComponent}
            />
          )}
        </View>
      </KeyboardAvoidingView>
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 320 }}
              contentContainerStyle={{ paddingBottom: 20 }}
              ListHeaderComponent={
                <Text style={styles.modelHint}>
                  Don't see your model? Type it in the search bar above.
                </Text>
              }
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
                      ? "No models found. Type a custom model above."
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

  scroll: { paddingHorizontal: 20, paddingTop: 24, gap: 20 },

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

  segControl: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    overflow: "hidden",
  },
  segOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segOptionSelected: {
    backgroundColor: Colors.accentLight,
  },
  segOptionText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  segOptionTextSelected: {
    color: Colors.accent,
    fontFamily: "Inter_600SemiBold",
  },

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
  yearSearchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  yearSearchInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
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
  modelHint: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    fontStyle: "italic", textAlign: "center",
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
  },
  monthPickerWrap: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 6,
  },
  monthPickerLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  monthRow: {
    flexDirection: "row",
    gap: 6,
  },
  monthTile: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  monthTileSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  monthTileEdge: {
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  monthTileText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  monthTileTextSelected: {
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  presetChipActive: {
    backgroundColor: Colors.accentLight,
    borderColor: Colors.accent,
  },
  presetChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  presetChipTextActive: {
    color: Colors.accent,
  },
  monthRangeSummary: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 4,
  },
});
