import type { SsoSettings, SsoSettingsInput } from "@nebuladb/shared";
import { request } from "./httpClient";

export interface SsoSettingsResponse {
  settings: SsoSettings;
  /** The address to register at the provider as the client's redirect URI. */
  redirectUri: string;
}

export function fetchSsoSettings(): Promise<SsoSettingsResponse> {
  return request<SsoSettingsResponse>("/api/admin/settings/sso");
}

export function saveSsoSettings(input: SsoSettingsInput): Promise<SsoSettingsResponse> {
  return request<SsoSettingsResponse>("/api/admin/settings/sso", { method: "PUT", body: input });
}

/** Reads the provider's discovery document with the settings as typed; throws when it cannot. */
export function testSsoSettings(input: SsoSettingsInput): Promise<{ authorizationEndpoint: string }> {
  return request<{ authorizationEndpoint: string }>("/api/admin/settings/sso/test", { method: "POST", body: input });
}

/** Where the login button goes: a plain navigation, the server answers with a redirect to the provider. */
export function ssoStartUrl(remember: boolean, next: string): string {
  return `/api/auth/sso/start?remember=${remember ? 1 : 0}&next=${encodeURIComponent(next)}`;
}
