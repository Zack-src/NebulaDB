import { useEffect, useState } from "react";
import * as authApi from "@/services/authApi";
import { updateMyDisplayName } from "@/services/usersApi";
import type { Session } from "@/types";

export interface AuthSessionHandle {
  session: Session | null | "loading";
  setSession: (session: Session | null) => void;
  logout: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
}

/** Bootstraps the logged-in session once at mount, and exposes the auth actions that mutate it. */
export function useAuthSession(onLogout: () => void): AuthSessionHandle {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    // A 401 here is the expected "not signed in" answer, not a failure worth
    // surfacing — it resolves to the login screen either way.
    authApi
      .fetchCurrentSession()
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  const logout = async () => {
    await authApi.logout();
    setSession(null);
    onLogout();
  };

  const updateDisplayName = async (name: string) => {
    setSession(await updateMyDisplayName(name));
  };

  return { session, setSession, logout, updateDisplayName };
}
