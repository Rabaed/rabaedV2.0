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
  action: "onboard_company" | "read_onboarding_leads" | "invite_authorized_person" | "close_onboarding_lead";
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
  owner_kind: OwnerKind;
  project_id: string | null;
  name: ColumnType<Bilingual, string, string>;
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
  kind: "send" | "submit" | "return" | "close" | "cancel";
  outcome: string | null;
  permission: string;
  sort: Generated<number>;
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
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkItemTable {
  id: Generated<string>;
  project_id: string;
  work_item_type_id: string;
  raised_by_participant_id: string;
  created_by_member_id: string;
  title: string;
  /** The Form answers; the MAR's `description` until the Form engine. */
  data: ColumnType<Record<string, unknown>, string, string>;
  workflow_version_id: string;
  document_number: string | null;
  current_step_id: string;
  current_stage_key: string;
  /** When it entered its current Step: Step Age inside the holding Participant only; read it through app.step_as_seen. */
  step_entered_at: Timestamp;
  /** When, and at which Step, it reached the holding Participant (set by a trigger on insert): Step Age for everyone else. */
  participant_entered_at: Generated<Timestamp>;
  participant_entered_step_id: Generated<string>;
  outcome: string | null;
  closed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkItemDimensionValueTable {
  work_item_id: string;
  project_id: string;
  dimension_id: string;
  dimension_value_id: string;
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
  stage: StageTable;
  workflow_definition: WorkflowDefinitionTable;
  workflow_version: WorkflowVersionTable;
  workflow_step: WorkflowStepTable;
  workflow_transition: WorkflowTransitionTable;
  work_item_type: WorkItemTypeTable;
  work_item: WorkItemTable;
  work_item_dimension_value: WorkItemDimensionValueTable;
  step_assignment: StepAssignmentTable;
  work_item_access: WorkItemAccessTable;
  work_item_event: WorkItemEventTable;
  position: PositionTable;
  position_permission: PositionPermissionTable;
  project_member_position: ProjectMemberPositionTable;
}
