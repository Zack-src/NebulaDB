import type { Session } from "@/types";
import { request } from "./httpClient";

export interface SetupStatus {
  /** True only while the instance has no account at all. */
  needsSetup: boolean;
  /** The operator set `NEBULADB_SETUP_TOKEN`: the setup must carry it. */
  tokenRequired: boolean;
}

export interface SetupPayload {
  email: string;
  displayName: string;
  password: string;
  token?: string;
}

export function fetchSetupStatus(): Promise<SetupStatus> {
  return request<SetupStatus>("/api/setup/status");
}

/** Creates the first administrator and signs them in (the server sets the session cookie). */
export function completeSetup(payload: SetupPayload): Promise<Session> {
  return request<Session>("/api/setup", { method: "POST", body: payload });
}
