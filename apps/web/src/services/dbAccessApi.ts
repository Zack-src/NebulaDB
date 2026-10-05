import type { DbAccessGrant, DbAccessGrantInput, MyDbAccess, UserDbAccess } from "@athanordb/shared";
import { request } from "./httpClient";

/**
 * Database access for members — granted by an instance administrator, per
 * user or per team. The console itself (explorer, SQL) is `dbAdminApi.ts`,
 * whose routes check these grants on every request.
 */

/** The connections the signed-in user may query, with the level held on each. */
export function fetchMyDbAccess(): Promise<MyDbAccess> {
  return request<MyDbAccess>("/api/me/db-access");
}

export function fetchUserDbAccess(userId: string): Promise<UserDbAccess> {
  return request<UserDbAccess>(`/api/admin/users/${userId}/db-access`);
}

/** Replaces the user's own grants and database account names; their teams' grants are untouched. */
export function saveUserDbAccess(userId: string, grants: DbAccessGrantInput[]): Promise<UserDbAccess> {
  return request<UserDbAccess>(`/api/admin/users/${userId}/db-access`, { method: "PUT", body: { grants } });
}

export async function fetchTeamDbAccess(teamId: string): Promise<DbAccessGrant[]> {
  return (await request<{ grants: DbAccessGrant[] }>(`/api/admin/teams/${teamId}/db-access`)).grants;
}

export async function saveTeamDbAccess(teamId: string, grants: DbAccessGrantInput[]): Promise<DbAccessGrant[]> {
  return (
    await request<{ grants: DbAccessGrant[] }>(`/api/admin/teams/${teamId}/db-access`, {
      method: "PUT",
      body: { grants },
    })
  ).grants;
}
