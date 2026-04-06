import { supabase } from "./supabase";

export type ReceiptScanSource = "camera" | "photo_library";
export type ReceiptAssetType = "vehicle" | "property" | "health";

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
  request_id?: string;
  scans_used?: number;
  scans_limit?: number;
}

function errorResult(message: string, requestId?: string): ReceiptScanResult {
  return {
    date: null,
    cost: null,
    provider: null,
    serviceType: null,
    mileage: null,
    task: null,
    items: [],
    rawText: "",
    error: message,
    request_id: requestId,
  };
}

function createRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function scanReceipt(
  base64Image: string,
  assetType: ReceiptAssetType,
  assetId: string,
  source: ReceiptScanSource,
): Promise<ReceiptScanResult> {
  const requestId = createRequestId();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return errorResult("You must be logged in to scan receipts.", requestId);
    }

    const { data, error: invokeError } = await supabase.functions.invoke("scan-receipt", {
      body: {
        request_id: requestId,
        image: base64Image,
        asset_type: assetType,
        asset_id: assetId,
        source,
      },
    });

    if (__DEV__) {
      console.log("scan-receipt invoke error:", invokeError);
      console.log("scan-receipt invoke data (first 300):", JSON.stringify(data)?.slice(0, 300));
    }

    if (invokeError) {
      // invokeError.context is the raw Response when the function returned a non-2xx status.
      // Try to extract a JSON body from it for structured error info.
      const ctx = (invokeError as any).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const errBody = await ctx.json();
          const msg = typeof errBody?.error === "string" ? errBody.error : invokeError.message;
          console.warn("scan-receipt error response:", msg);
          return {
            ...errorResult(msg, requestId),
            scans_used: typeof errBody?.scans_used === "number" ? errBody.scans_used : undefined,
            scans_limit: typeof errBody?.scans_limit === "number" ? errBody.scans_limit : undefined,
          };
        } catch {
          // fall through to raw text attempt
        }
        try {
          const rawText = await ctx.text();
          const preview = rawText.slice(0, 120).trim();
          console.error("scan-receipt non-JSON error body:", preview);
          return errorResult(`Server error: ${preview}`, requestId);
        } catch {
          // fall through
        }
      }
      console.warn("scan-receipt invoke error:", invokeError.message);
      return errorResult(invokeError.message || "Scan request failed", requestId);
    }

    if (!data) {
      return errorResult("Empty response from scan service", requestId);
    }

    if (data.error) {
      console.warn("Scan returned error:", data.error);
    }

    return {
      date: data.date || null,
      cost: data.cost != null ? Number(data.cost) : null,
      provider: data.provider || null,
      serviceType: data.serviceType || null,
      mileage: data.mileage != null ? Number(data.mileage) : null,
      task: data.task || null,
      items: Array.isArray(data.items) ? data.items : [],
      rawText: data.rawText || "",
      error: data.error || undefined,
      request_id: data.request_id || requestId,
      scans_used: typeof data.scans_used === "number" ? data.scans_used : undefined,
      scans_limit: typeof data.scans_limit === "number" ? data.scans_limit : undefined,
    };
  } catch (err) {
    console.error("Receipt scan failed:", err);
    return errorResult(err instanceof Error ? err.message : "Could not scan receipt", requestId);
  }
}
