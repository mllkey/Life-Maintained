import { supabase } from "./supabase";

export interface ReceiptScanResult {
  date: string | null;
  cost: number | null;
  provider: string | null;
  serviceType: string | null;
  rawText: string;
  error?: string;
}

export async function scanReceipt(base64Image: string): Promise<ReceiptScanResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error("You must be logged in to scan receipts.");
    }
    const { data, error } = await supabase.functions.invoke("scan-receipt", {
      body: { image: base64Image },
    });
    if (error) {
      throw new Error(error.message || "Failed to scan receipt");
    }
    return {
      date: data.date || null,
      cost: data.cost != null ? Number(data.cost) : null,
      provider: data.provider || null,
      serviceType: data.serviceType || null,
      rawText: data.rawText || "",
      error: data.error || undefined,
    };
  } catch (err) {
    console.error("Receipt scan failed:", err);
    return {
      date: null,
      cost: null,
      provider: null,
      serviceType: null,
      rawText: "",
      error: err instanceof Error ? err.message : "Could not scan receipt",
    };
  }
}
