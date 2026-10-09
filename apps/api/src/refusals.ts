import type { BilingualText, DefinitionIssue, FieldError, StageCopyProblem, WorkflowProblem } from "@rabaed/domain";
import { forbidden, HttpError, notFound } from "./http-error.ts";

// Every refusal the API's commands answer with, as the API's HTTP answer.
// `not_found` is the thing addressed itself (a Project, Participant, Work Item,
// or another Company's Member): a plain 404, exactly like one that doesn't
// exist (visibility.md, "Direct URL or ID").
const answers = {
  forbidden,
  not_found: notFound,
  member_not_found: () => new HttpError(404, "member_not_found"),
  // An email taken on the Instance (V17). Another Company's Member is never named.
  already_a_member: () => new HttpError(409, "already_a_member"),
  registered_with_another_company: () => new HttpError(409, "registered_with_another_company"),
  member_deactivated: () => new HttpError(409, "member_deactivated"),
  authorized_person: () => new HttpError(409, "authorized_person"),
  project_closed: () => new HttpError(409, "project_closed"),
  already_participant: () => new HttpError(409, "already_participant"),
  duplicate_code: () => new HttpError(409, "duplicate_code"),
  // Participant Codes (RP-314).
  invalid_code: () => new HttpError(422, "invalid_code"),
  code_in_use: () => new HttpError(409, "code_in_use"),
  parent_not_found: () => new HttpError(422, "parent_not_found"),
  parent_deactivated: () => new HttpError(409, "parent_deactivated"),
  trade_not_found: () => new HttpError(422, "trade_not_found"),
  too_deep: () => new HttpError(422, "too_deep"),
  value_not_found: () => new HttpError(422, "value_not_found"),
  exceeds_participant: () => new HttpError(422, "exceeds_participant"),
  type_not_found: () => new HttpError(422, "type_not_found"),
  trade_required: () => new HttpError(422, "trade_required"),
  outside_visibility: () => new HttpError(422, "outside_visibility"),
  position_not_found: () => new HttpError(422, "position_not_found"),
  item_closed: () => new HttpError(409, "item_closed"),
  not_holder: () => new HttpError(409, "not_holder"),
  already_claimed: () => new HttpError(409, "already_claimed"),
  transition_not_available: () => new HttpError(409, "transition_not_available"),
  no_step_pool: () => new HttpError(409, "no_step_pool"),
  next_step_unavailable: () => new HttpError(409, "next_step_unavailable"),
  // Transition rules (WF-7): the answers route to none, or to several, of the
  // Transitions sharing a label; a Validate rule refuses, with its message.
  no_route: () => new HttpError(409, "no_route"),
  // Transition actions (WF-8): a pick "Assign to" couldn't have offered (another
  // Company's Member, one who can't hold the next Step, a made-up id), and a set or
  // copy outside what the acting Participant fills at that Step; one answer each,
  // whatever the reason.
  assignee_not_offered: () => new HttpError(422, "assignee_not_offered"),
  action_not_allowed: () => new HttpError(409, "action_not_allowed"),
  // A Recommended Code the Transition doesn't offer (RP-433): not from a Step that
  // Recommends a Code, not to the same Participant's next reviewer, or not a closing
  // outcome of the Type's set; one answer whatever the reason.
  recommended_code_not_offered: () => new HttpError(422, "recommended_code_not_offered"),
  validation_failed: () => new HttpError(422, "validation_failed"),
  // A Transition's Action Form answers (RP-300): the body lists each field's error.
  invalid_action_form: () => new HttpError(422, "invalid_action_form"),
  idempotency_key_reused: () => new HttpError(422, "idempotency_key_reused"),
  // Every Transition is confirmed in its pop-up before it is taken (ADR 0017).
  not_confirmed: () => new HttpError(422, "not_confirmed"),
  // Form answers (RP-262): the body lists each field's error (answersRefusal).
  invalid_answers: () => new HttpError(422, "invalid_answers"),
  form_incomplete: () => new HttpError(422, "form_incomplete"),
  not_editable: () => new HttpError(409, "not_editable"),
  // A new Form Version, or new answers, arrived while the command ran: try again.
  form_version_not_latest: () => new HttpError(409, "form_version_not_latest"),
  form_not_checked: () => new HttpError(409, "form_not_checked"),
  // Documents (RP-269).
  file_too_large: () => new HttpError(422, "file_too_large"),
  content_type_not_allowed: () => new HttpError(422, "content_type_not_allowed"),
  not_uploaded: () => new HttpError(409, "not_uploaded"),
  upload_mismatch: () => new HttpError(409, "upload_mismatch"),
  document_frozen: () => new HttpError(409, "document_frozen"),
  // A Form's `attachments` field (RP-281).
  field_not_found: () => new HttpError(422, "field_not_found"),
  too_many_files: () => new HttpError(409, "too_many_files"),
  // Links (RP-291): an item Link search couldn't have offered, whatever the reason, made-up ids included.
  target_not_found: () => new HttpError(422, "target_not_found"),
  already_linked: () => new HttpError(409, "already_linked"),
  // Numbering Patterns (RP-313). The shape is checked by the request schema first, so
  // invalid_pattern answers only what slipped past it.
  invalid_pattern: () => new HttpError(422, "invalid_pattern"),
  shared_counter_not_accepted: () => new HttpError(422, "shared_counter_not_accepted"),
  // Starting numbers (RP-315): a value the pattern in effect counts by is missing,
  // or the counter has issued a number, so its starting number is locked.
  participant_required: () => new HttpError(422, "participant_required"),
  location_required: () => new HttpError(422, "location_required"),
  counter_used: () => new HttpError(409, "counter_used"),
  // Revisions (RP-316): one answer whatever the reason (not Code C, not the latest,
  // a Revision already open, a Member the Draft Step doesn't allow), so nobody
  // outside the raiser learns whether a Draft Revision is open.
  revision_not_allowed: () => new HttpError(409, "revision_not_allowed"),
  not_discardable: () => new HttpError(409, "not_discardable"),
  // Replacements (RP-435): one answer whatever the reason (the outcome offers none, one already
  // stands, a Member the Draft Step doesn't allow), so nobody outside the raiser learns whether one stands.
  replacement_not_allowed: () => new HttpError(409, "replacement_not_allowed"),
  // A Project's Stages (RP-428). The shapes are checked by the request schemas first;
  // a Stage's name that isn't English and Arabic is `invalid_name` (below).
  invalid_stage: () => new HttpError(422, "invalid_stage"),
  stage_exists: () => new HttpError(409, "stage_exists"),
  invalid_order: () => new HttpError(422, "invalid_order"),
  stage_in_use: () => new HttpError(409, "stage_in_use"),
  // A Type's outcome set on a Project (RP-429). The shapes are checked by the request schemas first.
  invalid_outcome: () => new HttpError(422, "invalid_outcome"),
  outcome_exists: () => new HttpError(409, "outcome_exists"),
  // Workflow authoring (RP-427): a name that isn't English and Arabic; a document that
  // isn't a definition (the body says where); a draft with an error (the body lists
  // every problem); nothing to publish; a Workflow with no published Version or made
  // for another Type; an exception's Workflow whose name names a Participant (V20).
  invalid_name: () => new HttpError(422, "invalid_name"),
  invalid_definition: () => new HttpError(422, "invalid_definition"),
  workflow_problems: () => new HttpError(422, "workflow_problems"),
  no_draft: () => new HttpError(409, "no_draft"),
  workflow_not_published: () => new HttpError(409, "workflow_not_published"),
  workflow_not_for_type: () => new HttpError(422, "workflow_not_for_type"),
  workflow_name_names_participant: () => new HttpError(422, "workflow_name_names_participant"),
  // A Workflow copied into a Project whose Module lacks one of its Stages (WF-5): `problems` names each.
  stage_missing: () => new HttpError(422, "stage_missing"),
  // A used outcome's code, closing or polarity (RP-429, decided 2026-10-09); the body has its message.
  outcome_in_use: () => new HttpError(409, "outcome_in_use"),
} satisfies Record<string, () => HttpError>;

export type RefusalReason = keyof typeof answers;

/**
 * A refused result as the HTTP error to throw, with what the body says of it: the
 * per-field errors of refused answers, else the message of a refused Validate rule;
 * where a Workflow document doesn't fit the format (`issues`) or every publish
 * problem of a Workflow draft, or each Stage a Workflow copied into a Project lacks (`problems`).
 */
export function refusal(result: {
  reason: RefusalReason;
  errors?: FieldError[];
  message?: BilingualText;
  issues?: DefinitionIssue[];
  problems?: (WorkflowProblem | StageCopyProblem)[];
}): HttpError {
  const error = answers[result.reason]();
  const details = {
    ...(result.errors ? { fields: result.errors } : result.message ? { message: result.message } : {}),
    ...(result.issues ? { issues: result.issues } : {}),
    ...(result.problems ? { problems: result.problems } : {}),
  };
  return Object.keys(details).length > 0 ? new HttpError(error.statusCode, error.code, details) : error;
}

/** Throws a refused command's HTTP answer (`refusal`); a done command passes. */
export function throwIfRefused(result: { ok: true } | ({ ok: false } & Parameters<typeof refusal>[0])): void {
  if (!result.ok) throw refusal(result);
}
