import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from "react";
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        checkOnboarding(session.user.id);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        setIsLoading(true);
        checkOnboarding(session.user.id).finally(() => setIsLoading(false));
      } else {
        setOnboardingCompleted(false);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkOnboarding(userId: string) {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", userId)
        .single();
      setOnboardingCompleted(data?.onboarding_completed ?? false);
    } catch {
      setOnboardingCompleted(false);
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
