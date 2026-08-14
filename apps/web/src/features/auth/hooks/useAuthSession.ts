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

  /**
   * Signing out clears the local session whatever the server says, and owns the
   * navigation back to the root.
   *
   * Both halves were bugs. The request's rejection used to propagate to three
   * call sites that invoked this as a floating promise, so a failed revoke left
   * the user sitting in an authenticated view with no error and no way to tell.
   * And each of those call sites did its own `pushState` *beside* the call, so
   * the URL changed even when the session did not.
   */
  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // A server-side revoke that fails must not strand the user in a signed-in
      // view. The cookie may survive until it expires; the UI must not.
    } finally {
      setSession(null);
      onLogout();
      window.history.pushState(null, "", "/");
    }
  };

  const updateDisplayName = async (name: string) => {
    setSession(await updateMyDisplayName(name));
  };

  return { session, setSession, logout, updateDisplayName };
}
