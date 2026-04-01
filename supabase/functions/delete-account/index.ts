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

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Fetch vehicle IDs and property IDs upfront for join-based deletes
    const { data: vehicles, error: vehiclesErr } = await adminClient
      .from("vehicles")
      .select("id")
      .eq("user_id", userId);
    if (vehiclesErr) return json({ error: `Failed to fetch vehicles: ${vehiclesErr.message}` }, 500);
    const vehicleIds = (vehicles ?? []).map((v: { id: string }) => v.id);

    const { data: properties, error: propertiesErr } = await adminClient
      .from("properties")
      .select("id")
      .eq("user_id", userId);
    if (propertiesErr) return json({ error: `Failed to fetch properties: ${propertiesErr.message}` }, 500);
    const propertyIds = (properties ?? []).map((p: { id: string }) => p.id);

    // 1. maintenance_logs
    const { error: e1 } = await adminClient.from("maintenance_logs").delete().eq("user_id", userId);
    if (e1) return json({ error: `Failed to delete maintenance_logs: ${e1.message}` }, 500);

    // 2. user_vehicle_maintenance_tasks
    const { error: e2 } = await adminClient.from("user_vehicle_maintenance_tasks").delete().eq("user_id", userId);
    if (e2) return json({ error: `Failed to delete user_vehicle_maintenance_tasks: ${e2.message}` }, 500);

    // 3. vehicle_mileage_history (joined via vehicle_id)
    if (vehicleIds.length > 0) {
      const { error: e3 } = await adminClient.from("vehicle_mileage_history").delete().in("vehicle_id", vehicleIds);
      if (e3) return json({ error: `Failed to delete vehicle_mileage_history: ${e3.message}` }, 500);
    }

    // 4. vehicle_wallet_documents
    const { error: e4 } = await adminClient.from("vehicle_wallet_documents").delete().eq("user_id", userId);
    if (e4) return json({ error: `Failed to delete vehicle_wallet_documents: ${e4.message}` }, 500);

    // 5. vehicles
    const { error: e5 } = await adminClient.from("vehicles").delete().eq("user_id", userId);
    if (e5) return json({ error: `Failed to delete vehicles: ${e5.message}` }, 500);

    // 6. property_maintenance_tasks (joined via property_id)
    if (propertyIds.length > 0) {
      const { error: e6 } = await adminClient.from("property_maintenance_tasks").delete().in("property_id", propertyIds);
      if (e6) return json({ error: `Failed to delete property_maintenance_tasks: ${e6.message}` }, 500);
    }

    // 7. properties
    const { error: e7 } = await adminClient.from("properties").delete().eq("user_id", userId);
    if (e7) return json({ error: `Failed to delete properties: ${e7.message}` }, 500);

    // 8. health_appointments
    const { error: e8 } = await adminClient.from("health_appointments").delete().eq("user_id", userId);
    if (e8) return json({ error: `Failed to delete health_appointments: ${e8.message}` }, 500);

    // 9. medications
    const { error: e9 } = await adminClient.from("medications").delete().eq("user_id", userId);
    if (e9) return json({ error: `Failed to delete medications: ${e9.message}` }, 500);

    // 10. family_members
    const { error: e10 } = await adminClient.from("family_members").delete().eq("user_id", userId);
    if (e10) return json({ error: `Failed to delete family_members: ${e10.message}` }, 500);

    // 11. health_profiles
    const { error: e11 } = await adminClient.from("health_profiles").delete().eq("user_id", userId);
    if (e11) return json({ error: `Failed to delete health_profiles: ${e11.message}` }, 500);

    // 12. notifications
    const { error: e12 } = await adminClient.from("notifications").delete().eq("user_id", userId);
    if (e12) return json({ error: `Failed to delete notifications: ${e12.message}` }, 500);

    // 13. promo_redemptions
    const { error: e13 } = await adminClient.from("promo_redemptions").delete().eq("user_id", userId);
    if (e13) return json({ error: `Failed to delete promo_redemptions: ${e13.message}` }, 500);

    // 14. profiles
    const { error: e14 } = await adminClient.from("profiles").delete().eq("user_id", userId);
    if (e14) return json({ error: `Failed to delete profiles: ${e14.message}` }, 500);

    // 15. Delete the auth user (requires service role)
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) return json({ error: `Failed to delete auth user: ${deleteAuthError.message}` }, 500);

    return json({ success: true });
  } catch (err: any) {
    console.error("[delete-account] Unexpected error:", err?.message ?? err);
    return json({ error: "Failed to delete account. Please try again." }, 500);
  }
});
