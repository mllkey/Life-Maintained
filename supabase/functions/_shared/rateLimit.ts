// Per-user sliding-window rate limit for AI edge functions.
// Calls the check_rate_limit RPC (service_role only). Throws on cap.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";

export class RateLimitError extends Error {
  status = 429;
  retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_MAX = 30;
const DEFAULT_WINDOW = 60;

/**
 * Enforce rate limit for (userId, fnName). Throws RateLimitError on cap.
 * Must be called with the admin (service-role) supabase client.
 */
export async function enforceAiRateLimit(
  adminClient: SupabaseClient,
  userId: string,
  fnName: string,
  maxCalls = DEFAULT_MAX,
  windowSeconds = DEFAULT_WINDOW,
): Promise<void> {
  const { data, error } = await adminClient.rpc("check_rate_limit", {
    p_user_id: userId,
    p_fn_name: fnName,
    p_max_calls: maxCalls,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed on RPC error — do not let a broken limit silently allow.
    console.error(`[rateLimit] RPC error for ${fnName}:`, error.message);
    throw new RateLimitError(windowSeconds);
  }
  if (data === false) {
    throw new RateLimitError(windowSeconds);
  }
}
