import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const jwt = authHeader.replace("Bearer ", "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Verify the JWT and get the user
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const userId = user.id;

  // Use service role for all deletes and auth user deletion
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Delete all user data across all tables
    const tables = [
      "user_vehicle_maintenance_tasks",
      "vehicle_mileage_history",
      "vehicle_wallet_documents",
      "property_maintenance_tasks",
      "health_appointments",
      "medications",
      "notifications",
      "promo_redemptions",
      "maintenance_logs",
      "vehicles",
      "properties",
      "family_members",
      "health_profiles",
    ];

    for (const table of tables) {
      const { error } = await adminClient.from(table).delete().eq("user_id", userId);
      if (error) {
        console.error(`[delete-account] Failed to delete from ${table}:`, error.message);
        // Continue — best effort cleanup before auth deletion
      }
    }

    // Delete the profile row
    await adminClient.from("profiles").delete().eq("user_id", userId);

    // Delete the auth user (requires service role)
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error("[delete-account] Failed to delete auth user:", deleteAuthError.message);
      return json({ error: "Failed to delete account. Please try again." }, 500);
    }

    return json({ success: true });
  } catch (err: any) {
    console.error("[delete-account] Unexpected error:", err?.message ?? err);
    return json({ error: "Failed to delete account. Please try again." }, 500);
  }
});
