import type { TeamDetail, TeamSummary } from "@/types";
import { request } from "./httpClient";

export function fetchTeams(): Promise<TeamSummary[]> {
  return request<TeamSummary[]>("/api/teams");
}

export function fetchTeam(teamId: string): Promise<TeamDetail> {
  return request<TeamDetail>(`/api/teams/${teamId}`);
}

export function createTeam(name: string): Promise<TeamSummary> {
  return request<TeamSummary>("/api/teams", { method: "POST", body: { name } });
}

export function renameTeam(teamId: string, name: string): Promise<TeamSummary> {
  return request<TeamSummary>(`/api/teams/${teamId}`, { method: "PATCH", body: { name } });
}

export function deleteTeam(teamId: string): Promise<void> {
  return request<void>(`/api/teams/${teamId}`, { method: "DELETE" });
}

export function addTeamMember(teamId: string, userId: string): Promise<void> {
  return request<void>(`/api/teams/${teamId}/members`, { method: "POST", body: { userId } });
}

export function removeTeamMember(teamId: string, userId: string): Promise<void> {
  return request<void>(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
}
