import "server-only";
import type {
  CompanyInvitations,
  CompanyMembers,
  CompanyParticipations,
  DimensionValues,
  DocumentList,
  FormChoices,
  FormVersion,
  MemberVisibility,
  MyProjects,
  NotificationList,
  ParticipantMembers,
  ParticipantVisibility,
  ProjectInvitations,
  ProjectParticipants,
  ProjectSummary,
  Scopes,
  SignedInMember,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemList,
  OptionList,
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

/** The Authorized Person's Company's pending Participant Invitations; null for anyone else. */
export function getCompanyInvitations(): Promise<CompanyInvitations | null> {
  return apiGet<CompanyInvitations>("/v1/participant-invitations");
}

/** A Project's pending Participant Invitations, for its Project Admins; null for anyone else. */
export function getProjectInvitations(projectId: string): Promise<ProjectInvitations | null> {
  return apiGet<ProjectInvitations>(`/v1/projects/${encodeURIComponent(projectId)}/invitations`);
}

/** One of the signed-in Member's own Company's Participants and its Project Members; null otherwise. */
export function getParticipantMembers(participantId: string): Promise<ParticipantMembers | null> {
  return apiGet<ParticipantMembers>(`/v1/participants/${encodeURIComponent(participantId)}/members`);
}

/** A Project's Trades and Locations; null if it isn't one of the signed-in Member's Projects. */
export function getProjectDimensions(projectId: string): Promise<DimensionValues | null> {
  return apiGet<DimensionValues>(`/v1/projects/${encodeURIComponent(projectId)}/dimensions`);
}

/** A Project's Scopes and Sub-scopes; null if it isn't one of the signed-in Member's Projects. */
export function getProjectScopes(projectId: string): Promise<Scopes | null> {
  return apiGet<Scopes>(`/v1/projects/${encodeURIComponent(projectId)}/scopes`);
}

/** A Participant's Visibility, for its own Company and the Project Admins; null otherwise. */
export function getParticipantVisibility(participantId: string): Promise<ParticipantVisibility | null> {
  return apiGet<ParticipantVisibility>(`/v1/participants/${encodeURIComponent(participantId)}/visibility`);
}

/** A Project Member's Visibility, for their Participant's own Company; null otherwise. */
export function getMemberVisibility(participantId: string, memberId: string): Promise<MemberVisibility | null> {
  return apiGet<MemberVisibility>(
    `/v1/participants/${encodeURIComponent(participantId)}/members/${encodeURIComponent(memberId)}/visibility`,
  );
}

/** The values the signed-in Member covers on one of their Projects; null if it isn't one of theirs. */
export function getMyVisibility(projectId: string): Promise<DimensionValues | null> {
  return apiGet<DimensionValues>(`/v1/projects/${encodeURIComponent(projectId)}/visibility`);
}

/** The Work Items of a Project the signed-in Member can see, with Stage counts; null if it isn't one of theirs. */
export function getWorkItems(projectId: string): Promise<WorkItemList | null> {
  return apiGet<WorkItemList>(`/v1/projects/${encodeURIComponent(projectId)}/work-items`);
}

/** One Work Item; null if the signed-in Member can't see it (exactly as if it didn't exist). */
export function getWorkItem(workItemId: string): Promise<WorkItemDetail | null> {
  return apiGet<WorkItemDetail>(`/v1/work-items/${encodeURIComponent(workItemId)}`);
}

/** The Form Version a Work Item is pinned to; null if the signed-in Member can't see the item. */
export function getWorkItemForm(workItemId: string): Promise<FormVersion | null> {
  return apiGet<FormVersion>(`/v1/work-items/${encodeURIComponent(workItemId)}/form`);
}

/** The Form for a new item of a Type on one of the signed-in Member's Projects: its latest published Version. */
export function getNewWorkItemForm(projectId: string, typeCode: string): Promise<FormVersion | null> {
  return apiGet<FormVersion>(
    `/v1/projects/${encodeURIComponent(projectId)}/work-item-types/${encodeURIComponent(typeCode)}/form`,
  );
}

/** Who and which Companies the Member may choose in a new item's Form (only those they can see); null when hidden. */
export function getNewWorkItemFormChoices(projectId: string): Promise<FormChoices | null> {
  return apiGet<FormChoices>(`/v1/projects/${encodeURIComponent(projectId)}/form-choices`);
}

/** Who and which Companies the Member may choose in a visible item's Form; null when hidden. */
export function getWorkItemFormChoices(workItemId: string): Promise<FormChoices | null> {
  return apiGet<FormChoices>(`/v1/work-items/${encodeURIComponent(workItemId)}/form-choices`);
}

/**
 * The Option Lists, as they are now (Rabaed Defaults, readable by every Member), for Form fields that use one.
 * Empty when they can't be read, so a Form without them still shows.
 */
export async function getOptionLists(): Promise<OptionList[]> {
  return (await apiGet<{ optionLists: OptionList[] }>("/v1/option-lists"))?.optionLists ?? [];
}

/** A visible item's Documents, with whether the Member may change them now; null when hidden. */
export function getWorkItemDocuments(workItemId: string): Promise<DocumentList | null> {
  return apiGet<DocumentList>(`/v1/work-items/${encodeURIComponent(workItemId)}/documents`);
}

/** A Work Item's history as the signed-in Member may see it; null if they can't see the item. */
export function getWorkItemHistory(workItemId: string): Promise<WorkItemHistory | null> {
  return apiGet<WorkItemHistory>(`/v1/work-items/${encodeURIComponent(workItemId)}/history`);
}

/** The signed-in Member's notifications and unread count; null if signed out. */
export function getNotifications(): Promise<NotificationList | null> {
  return apiGet<NotificationList>("/v1/notifications");
}
