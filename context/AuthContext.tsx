import { createContext, useContext, useEffect, useState, useMemo, ReactNode, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (val: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // onAuthStateChange fires INITIAL_SESSION on subscription, so we don't
    // need a separate getSession() call. Using a single source of truth
    // ensures isLoading stays true until the profile check completes.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;
      setSession(session);

      if (event === "SIGNED_OUT") {
        setOnboardingCompleted(false);
        setIsLoading(false);
        return;
      }

      // Only re-check onboarding (and block navigation) on initial load or a new sign-in.
      // TOKEN_REFRESHED, USER_UPDATED, etc. just update the session silently.
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (session?.user) {
          setIsLoading(true);
          checkOnboarding(session.user.id).finally(() => {
            if (mountedRef.current) setIsLoading(false);
          });
        } else {
          setOnboardingCompleted(false);
          setIsLoading(false);
        }
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  async function checkOnboarding(userId: string) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", userId)
        .single();
      if (error) throw error;
      if (mountedRef.current) {
        setOnboardingCompleted(data?.onboarding_completed === true);
      }
    } catch {
      if (mountedRef.current) setOnboardingCompleted(false);
    }
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setOnboardingCompleted(false);
  }

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    isLoading,
    signUp,
    signIn,
    signOut,
    onboardingCompleted,
    setOnboardingCompleted,
  }), [session, isLoading, onboardingCompleted]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
