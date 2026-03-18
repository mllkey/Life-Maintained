import { createContext, useContext, useEffect, useState, useMemo, ReactNode, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/subscription";
import { checkAndResetScanCount } from "@/lib/subscription";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  profileLoaded: boolean;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (val: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_SELECT =
  "onboarding_completed, subscription_tier, trial_started_at, trial_expires_at, subscription_expires_at, revenuecat_customer_id, push_token, monthly_scan_count, scan_count_reset_at";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const mountedRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const userIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string, attempt = 0) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", userId)
        .single();

      if (error) {
        // PGRST116 = no rows returned. Expected for brand-new users who haven't
        // completed onboarding yet — the profile row is created by complete.tsx upsert.
        // For any other error (network, auth, RLS), retry once before giving up.
        const isNoRows = (error as any)?.code === "PGRST116";
        if (!isNoRows && attempt === 0 && mountedRef.current) {
          console.warn("[AUTH] fetchProfile transient error (attempt 0), retrying in 1.5s...", error.message);
          await new Promise(r => setTimeout(r, 1500));
          if (mountedRef.current) return fetchProfile(userId, 1);
          return;
        }
        throw error;
      }

      if (!mountedRef.current) return;
      console.log("[AUTH] fetchProfile result:", JSON.stringify(data));
      console.log("[AUTH] onboarding_completed from DB:", (data as any)?.onboarding_completed);
      const p = data as any;
      const fullProfile: Profile = {
        user_id: userId,
        onboarding_completed: p?.onboarding_completed ?? false,
        subscription_tier: p?.subscription_tier ?? "trial",
        trial_started_at: p?.trial_started_at ?? null,
        trial_expires_at: p?.trial_expires_at ?? null,
        subscription_expires_at: p?.subscription_expires_at ?? null,
        revenuecat_customer_id: p?.revenuecat_customer_id ?? null,
        push_token: p?.push_token ?? null,
        monthly_scan_count: p?.monthly_scan_count ?? 0,
        scan_count_reset_at: p?.scan_count_reset_at ?? null,
      };
      setProfile(fullProfile);
      setOnboardingCompleted(fullProfile.onboarding_completed === true);
      if (fullProfile.onboarding_completed) {
        AsyncStorage.setItem("@onboarding_completed", "true").catch(() => {});
      } else {
        AsyncStorage.removeItem("@onboarding_completed").catch(() => {});
      }
      setProfileLoaded(true);
      checkAndResetScanCount(userId, fullProfile).catch(() => {});
    } catch (e) {
      console.error("[AUTH] fetchProfile error (attempt", attempt, "):", e);
      if (mountedRef.current) {
        // Do NOT reset onboardingCompleted here — preserve whatever value it already has.
        // For the initial load this means it stays false, which safely redirects to /(auth).
        setProfileLoaded(true);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (userIdRef.current) {
      await fetchProfile(userIdRef.current);
    }
  }, [fetchProfile]);

  useEffect(() => {
    mountedRef.current = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;
      setSession(session);

      if (event === "SIGNED_OUT") {
        userIdRef.current = null;
        setProfile(null);
        setOnboardingCompleted(false);
        setProfileLoaded(false);
        setIsLoading(false);
        return;
      }

      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (session?.user) {
          userIdRef.current = session.user.id;
          setIsLoading(true);

          // Fast local check — prevents onboarding redirect if network fails
          // Uses .then() to avoid async/await inside non-async callback
          AsyncStorage.getItem("@onboarding_completed")
            .then((cached) => {
              if (cached === "true" && mountedRef.current) {
                setOnboardingCompleted(true);
              }
            })
            .catch(() => {});

          fetchProfile(session.user.id).finally(() => {
            if (mountedRef.current) setIsLoading(false);
          });
        } else {
          userIdRef.current = null;
          setProfile(null);
          setOnboardingCompleted(false);
          setProfileLoaded(false);
          setIsLoading(false);
        }
      }
    });

    const appStateSub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && prev !== "active" && userIdRef.current) {
        fetchProfile(userIdRef.current).catch(() => {});
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [fetchProfile]);

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut() {
    await AsyncStorage.removeItem("@onboarding_completed");
    userIdRef.current = null;
    setProfile(null);
    await supabase.auth.signOut();
    setOnboardingCompleted(false);
  }

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    isLoading,
    profileLoaded,
    profile,
    refreshProfile,
    signUp,
    signIn,
    signOut,
    onboardingCompleted,
    setOnboardingCompleted,
  }), [session, isLoading, profileLoaded, profile, refreshProfile, onboardingCompleted]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
