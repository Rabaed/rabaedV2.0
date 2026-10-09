import type { ColumnType, Generated } from "kysely";

// Row types for Kysely, one per table, added as migrations land.
// Generated<T>: the database supplies a default on insert.

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Bilingual = { en: string; ar: string };
type Json = ColumnType<unknown, string, string>;

export interface RabaedEngineerTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  status: Generated<"active" | "deactivated">;
  /** Consecutive failed passwords or codes in Rabaed Admin. */
  failed_sign_ins: Generated<number>;
  locked_until: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** A Rabaed Admin sign-in waiting for its emailed code. */
export interface EngineerSignInCodeTable {
  id: Generated<string>;
  engineer_id: string;
  challenge_hash: Buffer;
  code_hash: Buffer;
  created_at: Timestamp;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  failed_attempts: Generated<number>;
}

export interface EngineerSessionTable {
  id: Generated<string>;
  token_hash: Buffer;
  engineer_id: string;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface EngineerDeviceTable {
  id: Generated<string>;
  engineer_id: string;
  device_hash: Buffer;
  first_seen_at: Timestamp;
}

export type EngineerSignInEvent =
  | "password_failed"
  | "locked_out"
  | "refused_while_locked"
  | "code_sent"
  | "code_rate_limited"
  | "code_failed"
  | "signed_in"
  | "new_device"
  | "signed_out"
  | "idle_signed_out";

export interface EngineerSignInEventTable {
  id: Generated<string>;
  engineer_id: string | null;
  email: string;
  event: EngineerSignInEvent;
  ip: string | null;
  user_agent: string | null;
  at: Timestamp;
}

export interface CompanyTable {
  id: Generated<string>;
  legal_name: ColumnType<Bilingual, string, string>;
  cr_number: string;
  vat_number: string;
  status: Generated<"active" | "suspended">;
  authorized_person_id: string | null;
  onboarded_by: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface MemberTable {
  id: Generated<string>;
  company_id: string;
  email: string;
  full_name: ColumnType<Bilingual, string, string>;
  phone: string | null;
  locale: Generated<"en" | "ar">;
  status: Generated<"invited" | "active" | "locked" | "deactivated">;
  can_create_projects: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface CredentialTable {
  id: Generated<string>;
  member_id: string | null;
  engineer_id: string | null;
  password_hash: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface InvitationTable {
  id: Generated<string>;
  member_id: string;
  token_hash: Buffer;
  invited_by_engineer_id: string | null;
  invited_by_member_id: string | null;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface AdminActionTable {
  id: Generated<string>;
  engineer_id: string;
  action:
    | "onboard_company"
    | "read_onboarding_leads"
    | "invite_authorized_person"
    | "close_onboarding_lead"
    | "create_option_list"
    | "add_option"
    | "rename_option"
    | "retire_option"
    | "restore_option"
    | "read_numbering"
    | "set_numbering_pattern"
    | "set_participant_code"
    | "set_numbering_counter_start"
    | "save_workflow_draft"
    | "publish_workflow";
  target_kind: string;
  /** Null for a read of a list. */
  target_id: string | null;
  reason: string;
  before: Json | null;
  after: Json | null;
  at: Generated<Timestamp>;
}

export type BaseRole = "contractor" | "consultant" | "owner" | "owner_representative";

export interface ProjectRoleTable {
  id: Generated<string>;
  owner_kind: "rabaed" | "project";
  project_id: string | null;
  base_role: BaseRole;
  name: ColumnType<Bilingual, string, string>;
  code: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ProjectTable {
  id: Generated<string>;
  host_company_id: string;
  project_number: number;
  code: string;
  name: ColumnType<Bilingual, string, string>;
  status: Generated<"active" | "closed">;
  closed_at: Timestamp | null;
  creator_member_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface CompanyProjectCounterTable {
  company_id: string;
  last_project_number: number;
}

export interface ParticipantTable {
  id: Generated<string>;
  project_id: string;
  company_id: string;
  project_role_id: string;
  /** Its place on the Project (1, 2, 3…), set by a trigger when it becomes Active. */
  ordinal: Generated<number | null>;
  /** The Participant Code (2–6 letters or digits, in capitals) set by a Project Admin; null until set. */
  code: string | null;
  /**
   * When a number was first built with the code, or a starting number set for a
   * counter whose key holds it, fixing it. Set with a null code, the position was
   * fixed: no code can be set.
   */
  code_locked_at: Timestamp | null;
  /**
   * Invited until its Authorized Person accepts (Active) or declines, or a
   * Project Admin withdraws the invitation (ADR 0009).
   */
  status: Generated<"invited" | "declined" | "invitation_withdrawn" | "active" | "withdrawn">;
  invited_by_member_id: string | null;
  invited_at: Timestamp | null;
  responded_at: Timestamp | null;
  withdrawn_at: Timestamp | null;
  withdrawn_by_member_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** A CR number a Project Admin invited that isn't on Rabaed; read only through Rabaed Admin. */
export interface OnboardingLeadTable {
  id: Generated<string>;
  cr_number: string;
  project_id: string;
  project_role_id: string;
  requested_by_member_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  /** Set, with participant_id, when Rabaed onboarded its Company and the lead became that invitation. */
  converted_at: Timestamp | null;
  participant_id: string | null;
  /** Set, with withdrawn_by_member_id, when a Project Admin withdrew it: off every list, never converted. */
  withdrawn_at: Timestamp | null;
  withdrawn_by_member_id: string | null;
  /** Set when Rabaed Admin closed it: off Rabaed's list only, the reason in admin_action. */
  closed_at: Timestamp | null;
}

export interface ProjectMemberTable {
  id: Generated<string>;
  project_id: string;
  participant_id: string;
  member_id: string;
  status: Generated<"active" | "removed">;
  removed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ProjectAdminTable {
  id: Generated<string>;
  project_id: string;
  member_id: string;
  appointed_by_member_id: string | null;
  appointed_by_engineer_id: string | null;
  created_at: Generated<Timestamp>;
}

export type DimensionKind = "trade" | "location" | "custom";

export interface VisibilityDimensionTable {
  id: Generated<string>;
  project_id: string;
  kind: DimensionKind;
  name: ColumnType<Bilingual, string, string>;
  required_on_work_items: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface DimensionValueTable {
  id: Generated<string>;
  project_id: string;
  dimension_id: string;
  parent_id: string | null;
  depth: number;
  level_name: ColumnType<Bilingual | null, string | null, string | null>;
  code: string;
  name: ColumnType<Bilingual, string, string>;
  sort: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface VisibilityGrantTable {
  id: Generated<string>;
  project_id: string;
  subject_kind: "participant" | "project_member";
  participant_id: string;
  project_member_id: string | null;
  dimension_id: string;
  is_all: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface VisibilityGrantValueTable {
  grant_id: string;
  project_id: string;
  dimension_id: string;
  dimension_value_id: string;
}

/** A Scope under a Trade (depth 1), or a Sub-scope under a Scope (depth 2). */
export interface ScopeTable {
  id: Generated<string>;
  project_id: string;
  trade_value_id: string;
  parent_id: string | null;
  depth: number;
  name: ColumnType<Bilingual, string, string>;
  status: Generated<"active" | "deactivated">;
  sort: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type ModuleKey = "submittals" | "inspections" | "snag_list" | "site_reports" | "drawings";
export type StageCategory = "draft" | "in_progress" | "closed_positive" | "closed_negative" | "cancelled";
type OwnerKind = "rabaed" | "project";

export interface StageTable {
  id: Generated<string>;
  owner_kind: OwnerKind;
  project_id: string | null;
  module_key: ModuleKey;
  key: string;
  name: ColumnType<Bilingual, string, string>;
  category: StageCategory;
  sort: number;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkflowDefinitionTable {
  id: Generated<string>;
  /** `company`: a Workflow in that Company's Library (RP-426, ADR 0016). */
  owner_kind: OwnerKind | "company";
  project_id: string | null;
  company_id: string | null;
  name: ColumnType<Bilingual, string, string>;
  /** The Work Item Type it is made for (RP-427); null only for test Workflows made before it. */
  work_item_type_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** A Member's change to a Workflow or a binding, append-only (RP-427). Not granted to the app role. */
export interface WorkflowEventTable {
  id: Generated<string>;
  workflow_definition_id: string | null;
  project_id: string | null;
  company_id: string | null;
  actor_member_id: string;
  type: "duplicated" | "draft_saved" | "published" | "bound" | "unbound";
  payload: Json;
  created_at: Generated<Timestamp>;
}

/** Which Workflow a Project's new items of a Type run; for one raising Participant only when it names one (RP-426). */
export interface WorkflowBindingTable {
  id: Generated<string>;
  project_id: string;
  work_item_type_id: string;
  raising_participant_id: string | null;
  workflow_definition_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkflowVersionTable {
  id: Generated<string>;
  workflow_definition_id: string;
  version_no: number;
  status: "draft" | "published";
  layout: Generated<Json>;
  published_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkflowStepTable {
  id: Generated<string>;
  workflow_version_id: string;
  key: string;
  name: ColumnType<Bilingual, string, string>;
  stage_key: string;
  actor_rule: Json;
  is_signing: Generated<boolean>;
  outcome_mode: Generated<"none" | "recommend_code" | "issue_code" | "inspection_result">;
  created_at: Generated<Timestamp>;
}

export interface WorkflowTransitionTable {
  id: Generated<string>;
  workflow_version_id: string;
  key: string;
  from_step_id: string;
  to_step_id: string;
  label: ColumnType<Bilingual, string, string>;
  kind: "send" | "submit" | "return" | "send_back" | "close" | "cancel";
  outcome: string | null;
  permission: string;
  sort: Generated<number>;
  /** Its Action Form: a Form schema, or null for none (RP-300). */
  action_form: ColumnType<unknown, string | null | undefined, string | null>;
  created_at: Generated<Timestamp>;
}

export interface WorkItemTypeTable {
  id: Generated<string>;
  owner_kind: OwnerKind;
  project_id: string | null;
  module_key: ModuleKey;
  code: string;
  name: ColumnType<Bilingual, string, string>;
  workflow_definition_id: string;
  outcome_kind: "review_code" | "inspection_result" | "none";
  /** Its Form; always set on a Rabaed Default. */
  form_definition_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface FormDefinitionTable {
  id: Generated<string>;
  owner_kind: OwnerKind;
  project_id: string | null;
  name: ColumnType<Bilingual, string, string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** Published Versions never change (a trigger refuses it); new Work Items use the latest. */
export interface FormVersionTable {
  id: Generated<string>;
  form_definition_id: string;
  version_no: number;
  status: "draft" | "published";
  /** The Form schema; parse it with the domain's formSchema. */
  schema: Json;
  published_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** A Rabaed Default Option List (form-engine.md §10). Written only by Rabaed Admin; the app role reads. */
export interface OptionListTable {
  id: Generated<string>;
  name: Json;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** An option of a list, at level 1 to 3. Its list, parent and value never change; it is never deleted. */
export interface OptionTable {
  id: Generated<string>;
  option_list_id: string;
  parent_id: string | null;
  /** Set from the parent by a trigger. */
  level: Generated<number>;
  value: string;
  label: Json;
  retired: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
}

/** A file attached to a Work Item (the documents migration). Written only through app.* functions. */
export interface DocumentTable {
  id: Generated<string>;
  project_id: string;
  work_item_id: string;
  file_name: string;
  /** bigint: pg returns it as a string. */
  size_bytes: ColumnType<string, number, number>;
  content_type: string;
  storage_key: string;
  uploaded_by_member_id: string;
  uploaded_by_participant_id: string;
  created_at: Generated<Timestamp>;
  confirmed_at: Timestamp | null;
  removed_at: Timestamp | null;
  removed_by_member_id: string | null;
  frozen_at: Timestamp | null;
  /** The `attachments`, `photos` or `checklist` field it belongs to; null for the Attachments System Field (the field_documents migration). */
  field_key: string | null;
  /** The checklist item a photo is evidence for, with that checklist's `field_key`; null for any other Document (the checklist migration). */
  item_key: string | null;
  /** When and where an image was taken, from its EXIF as the api read it at confirming; null when it records none (the photos migration). */
  taken_at: Timestamp | null;
  taken_latitude: number | null;
  taken_longitude: number | null;
  /** The item's `arrivals` when it was added (a trigger sets it): until the item leaves, only its holder sees it (RP-309). */
  arrival: Generated<number>;
}

export interface WorkItemTable {
  id: Generated<string>;
  project_id: string;
  work_item_type_id: string;
  raised_by_participant_id: string;
  created_by_member_id: string;
  title: string;
  /** The Form answers by field key, checked against form_version_id's schema. */
  data: ColumnType<Record<string, unknown>, string, string>;
  workflow_version_id: string;
  form_version_id: string;
  document_number: string | null;
  /** The Creation Date, set with the Document Number; the raiser's Participant only, through app.work_item_creation_date. */
  numbered_at: Timestamp | null;
  /** The Submission Date: the first Submit out of the raiser's Participant, never changed (ADR 0014). */
  submitted_at: Timestamp | null;
  /** How many times it has arrived at a Participant or closed (RP-309); never granted to the app role. */
  arrivals: Generated<number>;
  current_step_id: string;
  current_stage_key: string;
  /** When it entered its current Step: Step Age inside the holding Participant only; read it through app.step_as_seen. */
  step_entered_at: Timestamp;
  /** When, and at which Step, it reached the holding Participant (set by a trigger on insert): Step Age for everyone else. */
  participant_entered_at: Generated<Timestamp>;
  participant_entered_step_id: Generated<string>;
  outcome: string | null;
  closed_at: Timestamp | null;
  /** Its place in its chain of Revisions: 0 for the original (the create_revision migration). */
  revision_no: Generated<number>;
  /** The item it revises, and its chain's original (its own id for an original); never granted to the app role. */
  revision_of_id: string | null;
  root_id: Generated<string>;
  /** Set when a Draft Revision was discarded: nobody sees it again. */
  discarded_at: Timestamp | null;
  /** When the Draft was started: audit only, shown to nobody and never granted to the app role. */
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkItemDimensionValueTable {
  work_item_id: string;
  project_id: string;
  dimension_id: string;
  dimension_value_id: string;
}

/** A Work Item's Scopes and Sub-scopes, all under its Trade (RP-270). */
export interface WorkItemScopeTable {
  work_item_id: string;
  project_id: string;
  scope_id: string;
}

export interface StepAssignmentTable {
  id: Generated<string>;
  project_id: string;
  work_item_id: string;
  step_id: string;
  participant_id: string;
  assignee_member_id: string | null;
  status: "pooled" | "claimed" | "done" | "vacant" | "reassigned";
  claimed_at: Timestamp | null;
  done_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkItemAccessTable {
  work_item_id: string;
  project_id: string;
  participant_id: string;
  since: Timestamp;
  reason: "raised" | "handling" | "oversight";
}

/** Append-only: rabaed_app only reads it. */
export interface WorkItemEventTable {
  id: Generated<string>;
  project_id: string;
  work_item_id: string;
  seq: Generated<number>;
  type: string;
  actor_member_id: string | null;
  actor_engineer_id: string | null;
  actor_participant_id: string | null;
  transition_id: string | null;
  from_step_id: string | null;
  to_step_id: string | null;
  payload: ColumnType<Record<string, unknown>, string, never>;
  audience: "shared" | "internal";
  audience_participant_id: string | null;
  content_sha256: Buffer | null;
  prev_hash: Buffer | null;
  hash: Generated<Buffer>;
  created_at: Generated<Timestamp>;
}

/**
 * A Link from one Work Item to another in the same Project (RP-291). Written only
 * by app.* functions. The app role reads neither `to_id` nor
 * `created_by_member_id`: targets come from app.work_item_links (visibility.md E1).
 */
export interface WorkItemLinkTable {
  id: Generated<string>;
  project_id: string;
  from_id: string;
  to_id: string;
  kind: "related" | "relies_on" | "raised_from";
  /** Set for `relies_on`: the link question (`work_item_ref` field) that made it. */
  field_key: string | null;
  created_by_member_id: string;
  created_at: Generated<Timestamp>;
  /** The from item's `arrivals` when it was added (a trigger sets it); never granted to the app role (RP-309). */
  arrival: Generated<number>;
  /** Removed by the item's holder, still seen by everyone else until the item leaves; never granted to the app role (RP-309). */
  removed_at: Timestamp | null;
}

/** A Rabaed Default Position of one base role. */
export interface PositionTable {
  id: Generated<string>;
  owner_kind: "rabaed";
  base_role: "contractor" | "consultant" | "owner" | "owner_representative";
  key: string;
  name: ColumnType<Bilingual, string, string>;
  sort: number;
  created_at: Generated<Timestamp>;
}

export interface PositionPermissionTable {
  position_id: string;
  module_key: "submittals" | "inspections" | "snag_list" | "site_reports" | "drawings";
  permission: "view" | "create" | "submit" | "review" | "approve" | "assign" | "close" | "attach";
}

export interface ProjectMemberPositionTable {
  project_id: string;
  project_member_id: string;
  position_id: string;
  created_at: Generated<Timestamp>;
}

export interface Database {
  rabaed_engineer: RabaedEngineerTable;
  engineer_sign_in_code: EngineerSignInCodeTable;
  engineer_session: EngineerSessionTable;
  engineer_device: EngineerDeviceTable;
  engineer_sign_in_event: EngineerSignInEventTable;
  company: CompanyTable;
  member: MemberTable;
  credential: CredentialTable;
  invitation: InvitationTable;
  admin_action: AdminActionTable;
  project_role: ProjectRoleTable;
  project: ProjectTable;
  company_project_counter: CompanyProjectCounterTable;
  participant: ParticipantTable;
  onboarding_lead: OnboardingLeadTable;
  project_member: ProjectMemberTable;
  project_admin: ProjectAdminTable;
  visibility_dimension: VisibilityDimensionTable;
  dimension_value: DimensionValueTable;
  visibility_grant: VisibilityGrantTable;
  visibility_grant_value: VisibilityGrantValueTable;
  scope: ScopeTable;
  stage: StageTable;
  workflow_definition: WorkflowDefinitionTable;
  workflow_binding: WorkflowBindingTable;
  workflow_event: WorkflowEventTable;
  workflow_version: WorkflowVersionTable;
  workflow_step: WorkflowStepTable;
  workflow_transition: WorkflowTransitionTable;
  work_item_type: WorkItemTypeTable;
  form_definition: FormDefinitionTable;
  form_version: FormVersionTable;
  option_list: OptionListTable;
  option: OptionTable;
  work_item: WorkItemTable;
  work_item_dimension_value: WorkItemDimensionValueTable;
  work_item_scope: WorkItemScopeTable;
  step_assignment: StepAssignmentTable;
  work_item_access: WorkItemAccessTable;
  work_item_event: WorkItemEventTable;
  document: DocumentTable;
  work_item_link: WorkItemLinkTable;
  position: PositionTable;
  position_permission: PositionPermissionTable;
  project_member_position: ProjectMemberPositionTable;
}
