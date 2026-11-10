import { request } from "./httpClient";

export interface SecurityPolicy {
  require2fa: boolean;
}

export function fetchSecurityPolicy(): Promise<SecurityPolicy> {
  return request<SecurityPolicy>("/api/admin/settings/security");
}

export function saveSecurityPolicy(policy: SecurityPolicy): Promise<SecurityPolicy> {
  return request<SecurityPolicy>("/api/admin/settings/security", { method: "PUT", body: policy });
}
