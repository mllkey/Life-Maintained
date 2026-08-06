import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  ReactNode,
  useRef,
  useCallback,
} from "react";
import * as Sentry from '@sentry/react-native';
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/subscription";
import { checkAndResetScanCount } from "@/lib/subscription";
import { identify as identifyUser, resetAnalytics } from "@/lib/analytics";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  profileLoaded: boolean;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null; data?: any }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (val: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_SELECT =
  "onboarding_completed, subscription_tier, trial_started_at, trial_expires_at, subscription_expires_at, revenuecat_customer_id, push_token, monthly_scan_count, scan_count_reset_at";

export const getOnboardingKey = (userId: string) => `@onboarding_completed_${userId}`;
const getProfileKey = (userId: string) => `@profile_snapshot_${userId}`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  const mountedRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const userIdRef = useRef<string | null>(null);
  const hydrateRunIdRef = useRef(0);
  const profileFetchPromiseRef = useRef<Promise<Profile | null> | null>(null);
  const profileFetchUserIdRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const setOnboardingCacheTrue = useCallback(async (userId: string) => {
    try {
      await AsyncStorage.setItem(getOnboardingKey(userId), "true");
    } catch {}
  }, []);

  const clearOnboardingCache = useCallback(async (userId: string) => {
    try {
      await AsyncStorage.removeItem(getOnboardingKey(userId));
    } catch {}
  }, []);

  const readOnboardingCache = useCallback(async (userId: string): Promise<boolean> => {
    try {
      const scoped = await AsyncStorage.getItem(getOnboardingKey(userId));
      return scoped === "true";
    } catch {
      return false;
    }
  }, []);

  const applySignedOutState = useCallback(() => {
    if (!mountedRef.current) return;

    hydrateRunIdRef.current += 1;
    userIdRef.current = null;
    sessionRef.current = null;

    setSession(null);
    setProfile(null);
    setOnboardingCompleted(false);
    setProfileLoaded(false);
    setIsLoading(false);
  }, []);

  const buildProfile = useCallback(
    (userId: string, p: any): Profile => ({
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
    }),
    []
  );

  const writeProfileCache = useCallback(async (userId: string, p: Profile) => {
    try {
      await AsyncStorage.setItem(getProfileKey(userId), JSON.stringify(p));
    } catch {}
  }, []);

  const readProfileCache = useCallback(
    async (userId: string): Promise<Profile | null> => {
      try {
        const raw = await AsyncStorage.getItem(getProfileKey(userId));
        if (!raw) return null;
        return buildProfile(userId, JSON.parse(raw));
      } catch {
        return null;
      }
    },
    [buildProfile]
  );

  const clearProfileCache = useCallback(async (userId: string) => {
    try {
      await AsyncStorage.removeItem(getProfileKey(userId));
    } catch {}
  }, []);

  const fetchProfileFromDb = useCallback(
    async (userId: string, attempt = 0): Promise<Profile | null> => {
      if (profileFetchPromiseRef.current && profileFetchUserIdRef.current === userId) {
        return profileFetchPromiseRef.current;
      }

      const promise = (async () => {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select(PROFILE_SELECT)
            .eq("user_id", userId)
            .maybeSingle();

          if (error) throw error;
          if (!data) return null;

          return buildProfile(userId, data);
        } catch (error: any) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
            return fetchProfileFromDb(userId, 1);
          }
          throw error;
        }
      })();

      profileFetchPromiseRef.current = promise;
      profileFetchUserIdRef.current = userId;

      try {
        return await promise;
      } finally {
        if (profileFetchPromiseRef.current === promise) {
          profileFetchPromiseRef.current = null;
          profileFetchUserIdRef.current = null;
        }
      }
    },
    [buildProfile]
  );

  const hydrateFromSession = useCallback(
    async (
      nextSession: Session,
      options?: { showLoading?: boolean; quiet?: boolean; instant?: boolean }
    ) => {
      const showLoading = options?.showLoading ?? true;
      const quiet = options?.quiet ?? false;
      const instant = options?.instant ?? false;
      const runId = ++hydrateRunIdRef.current;

      if (!mountedRef.current) return;

      const userId = nextSession.user.id;
      sessionRef.current = nextSession;
      setSession(nextSession);
      userIdRef.current = userId;

      if (showLoading) setIsLoading(true);
      if (!quiet) setProfileLoaded(false);

      const isStale = () => !mountedRef.current || hydrateRunIdRef.current !== runId;

      // Reconcile against the authoritative DB profile. Updates state + cache.
      // Shared by the instant (background) and default (awaited) paths.
      const applyDbProfile = (fullProfile: Profile | null, cachedOnboarding: boolean) => {
        if (isStale()) return;
        if (fullProfile) {
          setProfile(fullProfile);
          writeProfileCache(userId, fullProfile).catch(() => {});
          identifyUser(userId, {
            subscription_tier: fullProfile.subscription_tier ?? null,
            onboarding_completed: !!fullProfile.onboarding_completed,
          });
          if (fullProfile.onboarding_completed) {
            setOnboardingCompleted(true);
            setOnboardingCacheTrue(userId).catch(() => {});
          } else {
            setOnboardingCompleted(false);
            clearOnboardingCache(userId).catch(() => {});
          }
          checkAndResetScanCount(userId, fullProfile).catch(() => {});
        } else if (!instant) {
          // Default path only: an authoritative empty result means no profile
          // row yet. Clear the stale snapshot so the next cold start does not
          // resurrect it; instant path keeps cached state rather than clobbering.
          setProfile(null);
          clearProfileCache(userId).catch(() => {});
          setOnboardingCompleted(cachedOnboarding);
        }
      };

      if (instant) {
        // COLD-START / OFFLINE-FIRST PATH.
        // Apply locally cached session + profile + onboarding synchronously so
        // routing and tier are correct with zero network on the critical path,
        // then reconcile from the DB in the background. This removes the
        // cold-start hang when the device is offline or the network is slow.
        let cachedOnboarding = false;
        let cachedProfile: Profile | null = null;
        try {
          [cachedOnboarding, cachedProfile] = await Promise.all([
            readOnboardingCache(userId),
            readProfileCache(userId),
          ]);
        } catch {
          // Cache read failed: fall back to defaults and still release the gates.
        }

        if (isStale()) {
          if (showLoading && mountedRef.current) setIsLoading(false);
          return;
        }

        if (cachedProfile) {
          setProfile(cachedProfile);
          setOnboardingCompleted(cachedProfile.onboarding_completed || cachedOnboarding);
        } else if (cachedOnboarding) {
          setOnboardingCompleted(true);
        }

        setProfileLoaded(true);
        if (showLoading) setIsLoading(false);

        fetchProfileFromDb(userId)
          .then((fullProfile) => applyDbProfile(fullProfile, cachedOnboarding))
          .catch((e) => {
            console.error("[AUTH] background profile refresh failed:", e);
          });
        return;
      }

      // DEFAULT PATH (fresh sign-in, token refresh, manual refresh): await the
      // DB so routing reflects the authoritative profile, exactly as before.
      const cachedOnboarding = await readOnboardingCache(userId);

      if (isStale()) {
        if (showLoading && mountedRef.current) setIsLoading(false);
        return;
      }

      if (cachedOnboarding) setOnboardingCompleted(true);

      try {
        const fullProfile = await fetchProfileFromDb(userId);
        applyDbProfile(fullProfile, cachedOnboarding);
        if (!isStale()) setProfileLoaded(true);
      } catch (e) {
        console.error("[AUTH] hydrateFromSession profile fetch failed:", e);
        if (isStale()) {
          if (showLoading && mountedRef.current) setIsLoading(false);
          return;
        }
        if (cachedOnboarding) setOnboardingCompleted(true);
        setProfileLoaded(true);
      } finally {
        if (mountedRef.current && hydrateRunIdRef.current === runId && showLoading) {
          setIsLoading(false);
        }
      }
    },
    [
      clearOnboardingCache,
      clearProfileCache,
      fetchProfileFromDb,
      readOnboardingCache,
      readProfileCache,
      setOnboardingCacheTrue,
      writeProfileCache,
    ]
  );

  const refreshProfile = useCallback(async () => {
    if (!userIdRef.current || !sessionRef.current) return;
    await hydrateFromSession(sessionRef.current, { showLoading: false, quiet: true });
  }, [hydrateFromSession]);

  useEffect(() => {
    mountedRef.current = true;

    const bootstrap = async () => {
      try {
        setIsLoading(true);

        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (existingSession?.user) {
          void hydrateFromSession(existingSession, { showLoading: false, quiet: false, instant: true });
        } else {
          applySignedOutState();
        }
      } catch (e) {
        console.error("[AUTH] bootstrap getSession failed:", e);
        applySignedOutState();
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mountedRef.current) return;

      if (event === "INITIAL_SESSION") return;

      if (event === "SIGNED_OUT") {
        applySignedOutState();
        return;
      }

      if (!nextSession?.user) {
        return;
      }

      if (event === "SIGNED_IN") {
        setTimeout(() => {
          Sentry.addBreadcrumb({ category: "freeze-trace", message: "auth hydrate deferred (SIGNED_IN)", level: "info" });
          hydrateFromSession(nextSession, { showLoading: false, quiet: false }).catch((e) => {
            console.error("[AUTH] SIGNED_IN hydrate failed:", e);
          });
        }, 0);
        return;
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        setTimeout(() => {
          Sentry.addBreadcrumb({ category: "freeze-trace", message: "auth hydrate deferred (refresh)", level: "info" });
          hydrateFromSession(nextSession, { showLoading: false, quiet: true }).catch((e) => {
            console.error(`[AUTH] ${event} hydrate failed:`, e);
          });
        }, 0);
      }
    });

    const appStateSub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      const currentSession = sessionRef.current;
      if (nextState === "active" && prev !== "active" && currentSession?.user) {
        hydrateFromSession(currentSession, { showLoading: false, quiet: true }).catch((e) => {
          console.error("[AUTH] app active hydrate failed:", e);
        });
      }
    });

    bootstrap();

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [applySignedOutState, hydrateFromSession]);

  async function signUp(email: string, password: string) {
    const { error, data } = await supabase.auth.signUp({ email, password });
    return { error, data };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut() {
    const userIdToClear = sessionRef.current?.user?.id ?? userIdRef.current;
    if (userIdToClear) {
      await clearOnboardingCache(userIdToClear);
      await clearProfileCache(userIdToClear);
    }

    hydrateRunIdRef.current += 1;
    userIdRef.current = null;
    sessionRef.current = null;

    setProfile(null);
    setOnboardingCompleted(false);
    setProfileLoaded(false);
    setSession(null);

    resetAnalytics();
    await supabase.auth.signOut();
    setIsLoading(false);
  }

  const value = useMemo(
    () => ({
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
    }),
    [session, isLoading, profileLoaded, profile, refreshProfile, onboardingCompleted]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
