// Shared auth helper for edge functions.
// Verifies a Supabase user JWT via auth.getUser() (real signature check).
// Throws AuthError on failure; caller should map to a 401 response.

import { createClient } from "npm:@supabase/supabase-js@2.98.0";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export interface AuthContext {
  userId: string;
  jwt: string;
}

/**
 * Extract and verify a user JWT from the Authorization header.
 * Uses Supabase auth.getUser() against the anon key, which verifies the
 * signature server-side. This is the only authoritative way to trust a JWT.
 */
export async function requireUser(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }
  const jwt = authHeader.replace("Bearer ", "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AuthError("Server auth misconfigured", 500);
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    throw new AuthError("Unauthorized: invalid or expired token");
  }
  return { userId: user.id, jwt };
}

/**
 * Check whether the request bears the internal edge-to-edge shared secret.
 * Returns true only when EDGE_FUNCTION_SECRET is set AND header matches.
 */
export function hasEdgeSecret(req: Request): boolean {
  const expected = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
  if (!expected) return false;
  const got = req.headers.get("x-edge-secret") ?? "";
  return got === expected;
}
