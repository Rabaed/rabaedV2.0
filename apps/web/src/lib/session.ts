import "server-only";
import type {
  CompanyMembers,
  CompanyParticipations,
  MyProjects,
  ParticipantMembers,
  ProjectParticipants,
  ProjectSummary,
  SignedInMember,
} from "@rabaed/domain";
import { cookies } from "next/headers";
import { apiUrl } from "./api-url.ts";

/** GETs an API path with the browser's session cookie; null if signed out or it fails. */
async function apiGet<T>(path: string): Promise<T | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The signed-in Member, read from the API with the browser's session cookie; null if signed out. */
export function getMe(): Promise<SignedInMember | null> {
  return apiGet<SignedInMember>("/v1/me");
}

/** The signed-in Member's Company's Members; null if signed out. */
export function getMembers(): Promise<CompanyMembers | null> {
  return apiGet<CompanyMembers>("/v1/members");
}

/** The signed-in Member's Projects; null if signed out. */
export function getMyProjects(): Promise<MyProjects | null> {
  return apiGet<MyProjects>("/v1/projects");
}

/** One of the signed-in Member's Projects; null if it isn't one of theirs (or doesn't exist). */
export function getProject(projectId: string): Promise<ProjectSummary | null> {
  return apiGet<ProjectSummary>(`/v1/projects/${encodeURIComponent(projectId)}`);
}

/** The Participants of one of the signed-in Member's Projects; null if it isn't one of theirs. */
export function getProjectParticipants(projectId: string): Promise<ProjectParticipants | null> {
  return apiGet<ProjectParticipants>(`/v1/projects/${encodeURIComponent(projectId)}/participants`);
}

/** The Authorized Person's Company's Participants; null for anyone else. */
export function getCompanyParticipations(): Promise<CompanyParticipations | null> {
  return apiGet<CompanyParticipations>("/v1/participants");
}

/** One of the signed-in Member's own Company's Participants and its Project Members; null otherwise. */
export function getParticipantMembers(participantId: string): Promise<ParticipantMembers | null> {
  return apiGet<ParticipantMembers>(`/v1/participants/${encodeURIComponent(participantId)}/members`);
}
