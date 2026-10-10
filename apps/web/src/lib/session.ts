import "server-only";
import type {
  ActivityFeed,
  ActivityFeedQuery,
  CompanyInvitations,
  CompanyMembers,
  CompanyParticipations,
  Dashboard,
  DimensionValues,
  DocumentList,
  FormChoices,
  FormToFill,
  LinkedFrom,
  MemberVisibility,
  MyProjects,
  NotificationList,
  NotificationSettingsView,
  NumberingSettings,
  NumberingCounters,
  ParticipantMembers,
  ParticipantVisibility,
  ProjectInvitations,
  ProjectParticipants,
  ProjectSummary,
  RevisionChain,
  Scopes,
  SignedInMember,
  WatchState,
  WorkItemDetail,
  WorkItemLinks,
  WorkItemHistory,
  WorkItemWorkflowMap,
  WorkItemBoard,
  WorkItemList,
  ModuleKey,
  WorkItemQuery,
  OptionList,
} from "@rabaed/domain";
import { activityFeedSearchParams, workItemSearchParams } from "@rabaed/domain";
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

/** A Project's Numbering Pattern and per-Type overrides, for its Project Members; null otherwise. */
export function getNumberingSettings(projectId: string): Promise<NumberingSettings | null> {
  return apiGet<NumberingSettings>(`/v1/projects/${encodeURIComponent(projectId)}/numbering`);
}

/** A Project's numbering counters, for its Project Admins only; null for anyone else (scenario 55). */
export function getNumberingCounters(projectId: string): Promise<NumberingCounters | null> {
  return apiGet<NumberingCounters>(`/v1/projects/${encodeURIComponent(projectId)}/numbering/counters`);
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

/** The API path of a Module's items on a Project, with `query`'s parameters. */
function moduleWorkItemsPath(projectId: string, module: ModuleKey, view: "" | "/kanban", query: WorkItemQuery): string {
  // The path names the Module.
  const params = workItemSearchParams({ ...query, module: undefined }).toString();
  return `/v1/projects/${encodeURIComponent(projectId)}/modules/${module}/work-items${view}${params ? `?${params}` : ""}`;
}

/**
 * One page of the work item query on a Module of a Project: the items the
 * signed-in Member can see that match `query`, with Stage counts; null if it
 * isn't one of their Projects or the Project has no Type in the Module.
 */
export function getWorkItems(projectId: string, module: ModuleKey, query: WorkItemQuery): Promise<WorkItemList | null> {
  return apiGet<WorkItemList>(moduleWorkItemsPath(projectId, module, "", query));
}

/** The Kanban of a Module of a Project for `query`; null as for the List. */
export function getWorkItemBoard(projectId: string, module: ModuleKey, query: WorkItemQuery): Promise<WorkItemBoard | null> {
  return apiGet<WorkItemBoard>(moduleWorkItemsPath(projectId, module, "/kanban", query));
}

/** A Project's Dashboard: Type cards over the items the signed-in Member can see; null if it isn't one of theirs. */
export function getDashboard(projectId: string): Promise<Dashboard | null> {
  return apiGet<Dashboard>(`/v1/projects/${encodeURIComponent(projectId)}/dashboard`);
}

/** A page of a Project's Activity Feed, as the signed-in Member may see it; null if the Project isn't one of theirs. */
export function getActivityFeed(projectId: string, query: Partial<ActivityFeedQuery> = {}): Promise<ActivityFeed | null> {
  const params = activityFeedSearchParams(query).toString();
  return apiGet<ActivityFeed>(`/v1/projects/${encodeURIComponent(projectId)}/activity${params ? `?${params}` : ""}`);
}

/** One Work Item; null if the signed-in Member can't see it (exactly as if it didn't exist). */
export function getWorkItem(workItemId: string): Promise<WorkItemDetail | null> {
  return apiGet<WorkItemDetail>(`/v1/work-items/${encodeURIComponent(workItemId)}`);
}

/** The Form Version a Work Item is pinned to; null if the signed-in Member can't see the item. */
export function getWorkItemForm(workItemId: string): Promise<FormToFill | null> {
  return apiGet<FormToFill>(`/v1/work-items/${encodeURIComponent(workItemId)}/form`);
}

/** The Form for a new item of a Type on one of the signed-in Member's Projects: its latest published Version. */
export function getNewWorkItemForm(projectId: string, typeCode: string): Promise<FormToFill | null> {
  return apiGet<FormToFill>(
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

/** A Work Item's Links as the signed-in Member may read them (E1); null if they can't see the item. */
export function getWorkItemLinks(workItemId: string): Promise<WorkItemLinks | null> {
  return apiGet<WorkItemLinks>(`/v1/work-items/${encodeURIComponent(workItemId)}/links`);
}

/** The Submitted items linking to a Work Item, hidden ones as number and Subject only (E3); null if the Member can't see the item. */
export function getLinkedFrom(workItemId: string): Promise<LinkedFrom | null> {
  return apiGet<LinkedFrom>(`/v1/work-items/${encodeURIComponent(workItemId)}/linked-from`);
}

/** The Revisions of a Work Item's chain the signed-in Member may see (the Revision drop-down); null if they can't see the item. */
export function getRevisionChain(workItemId: string): Promise<RevisionChain | null> {
  return apiGet<RevisionChain>(`/v1/work-items/${encodeURIComponent(workItemId)}/revisions`);
}

/** Whether the signed-in Member watches a Work Item (their own Watch only); null if they can't see it. */
export function getWatchState(workItemId: string): Promise<WatchState | null> {
  return apiGet<WatchState>(`/v1/work-items/${encodeURIComponent(workItemId)}/watch`);
}

/** A Work Item's history as the signed-in Member may see it; null if they can't see the item. */
export function getWorkItemHistory(workItemId: string): Promise<WorkItemHistory | null> {
  return apiGet<WorkItemHistory>(`/v1/work-items/${encodeURIComponent(workItemId)}/history`);
}

/** The item's Workflow map (RP-438): its pinned Version and where the item is, as the viewer may know; null if they can't read it. */
export function getWorkItemWorkflow(workItemId: string): Promise<WorkItemWorkflowMap | null> {
  return apiGet<WorkItemWorkflowMap>(`/v1/work-items/${encodeURIComponent(workItemId)}/workflow`);
}

/** The signed-in Member's notification settings and Project mutes; null if signed out. */
export function getNotificationSettings(): Promise<NotificationSettingsView | null> {
  return apiGet<NotificationSettingsView>("/v1/notification-settings");
}

/** The signed-in Member's notifications and unread count; null if signed out. */
export function getNotifications(): Promise<NotificationList | null> {
  return apiGet<NotificationList>("/v1/notifications");
}
