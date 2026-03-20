import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SCAN_COUNT_KEY = "@daily_scan_count";
const SCAN_DATE_KEY = "@daily_scan_date";
const MAX_DAILY_SCANS = 20;

async function checkScanLimit(): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const savedDate = await AsyncStorage.getItem(SCAN_DATE_KEY);
  let count = 0;
  if (savedDate === today) {
    count = parseInt(await AsyncStorage.getItem(SCAN_COUNT_KEY) ?? "0", 10);
  }
  return count < MAX_DAILY_SCANS;
}

async function incrementScanCount(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const savedDate = await AsyncStorage.getItem(SCAN_DATE_KEY);
  let count = 0;
  if (savedDate === today) {
    count = parseInt(await AsyncStorage.getItem(SCAN_COUNT_KEY) ?? "0", 10);
  }
  await AsyncStorage.setItem(SCAN_DATE_KEY, today);
  await AsyncStorage.setItem(SCAN_COUNT_KEY, String(count + 1));
}

export interface ReceiptScanResult {
  date: string | null;
  cost: number | null;
  provider: string | null;
  serviceType: string | null;
  mileage: number | null;
  task: string | null;
  items: Array<{ name: string; cost: number | null; details: string | null }>;
  rawText: string;
  error?: string;
  localUri?: string;
}

export async function scanReceipt(base64Image: string): Promise<ReceiptScanResult> {
  try {
    const canScan = await checkScanLimit();
    if (!canScan) {
      return {
        date: null,
        cost: null,
        provider: null,
        serviceType: null,
        mileage: null,
        task: null,
        items: [],
        rawText: "",
        error: "Daily scan limit reached. Try again tomorrow.",
      };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error("You must be logged in to scan receipts.");
    }

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    const response = await fetch(supabaseUrl + "/functions/v1/scan-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
        "apikey": supabaseAnonKey || "",
      },
      body: JSON.stringify({ image: base64Image }),
    });

    const data = await response.json();
    console.log("RAW RESPONSE:", JSON.stringify(data));

    if (data.error) {
      console.warn("Scan returned error:", data.error);
    }

    const result = {
      date: data.date || null,
      cost: data.cost != null ? Number(data.cost) : null,
      provider: data.provider || null,
      serviceType: data.serviceType || null,
      mileage: data.mileage != null ? Number(data.mileage) : null,
      task: data.task || null,
      items: data.items || [],
      rawText: data.rawText || "",
      error: data.error || undefined,
    };
    await incrementScanCount();
    console.log("RETURNING:", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error("Receipt scan failed:", err);
    return {
      date: null,
      cost: null,
      provider: null,
      serviceType: null,
      mileage: null,
      task: null,
      items: [],
      rawText: "",
      error: err instanceof Error ? err.message : "Could not scan receipt",
    };
  }
}
