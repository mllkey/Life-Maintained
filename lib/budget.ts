/**
 * lib/budget.ts — the single read/write path for the monthly budget threshold
 * (user_notification_preferences.budget_threshold). Settings and the dashboard
 * budget sheet both go through here so the cache shape stays one thing:
 * ["budget_threshold", userId] -> { budget_threshold: number } | null.
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type BudgetPref = { budget_threshold: number | null } | null;

export const budgetQueryKey = (userId: string | undefined) => ["budget_threshold", userId] as const;

export async function fetchBudgetThreshold(userId: string): Promise<BudgetPref> {
  const { data, error } = await (supabase.from("user_notification_preferences") as any)
    .select("budget_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Parse the control's text value; null when empty or not a positive number. */
export function parseBudgetInput(value: string): number | null {
  const n = parseFloat(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function saveBudgetThreshold(queryClient: QueryClient, userId: string, threshold: number): Promise<void> {
  const { error } = await (supabase.from("user_notification_preferences") as any).upsert(
    { user_id: userId, budget_threshold: threshold, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw error;
  queryClient.setQueryData(budgetQueryKey(userId), { budget_threshold: threshold });
  queryClient.invalidateQueries({ queryKey: ["budget_threshold"] });
}
