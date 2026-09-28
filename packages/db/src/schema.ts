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
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
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
  action: "onboard_company";
  target_kind: string;
  target_id: string;
  reason: string;
  before: Json | null;
  after: Json | null;
  at: Generated<Timestamp>;
}

export interface Database {
  rabaed_engineer: RabaedEngineerTable;
  company: CompanyTable;
  member: MemberTable;
  credential: CredentialTable;
  invitation: InvitationTable;
  admin_action: AdminActionTable;
}
