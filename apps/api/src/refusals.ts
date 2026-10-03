import type { FieldError } from "@rabaed/domain";
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
  parent_not_found: () => new HttpError(422, "parent_not_found"),
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
  reason_required: () => new HttpError(422, "reason_required"),
  idempotency_key_reused: () => new HttpError(422, "idempotency_key_reused"),
  // Form answers (RP-262): the body lists each field's error (answersRefusal).
  invalid_answers: () => new HttpError(422, "invalid_answers"),
  form_incomplete: () => new HttpError(422, "form_incomplete"),
  not_editable: () => new HttpError(409, "not_editable"),
  // A new Form Version, or new answers, arrived while the command ran: try again.
  form_version_not_latest: () => new HttpError(409, "form_version_not_latest"),
  form_not_checked: () => new HttpError(409, "form_not_checked"),
} satisfies Record<string, () => HttpError>;

export type RefusalReason = keyof typeof answers;

/** A refused result as the HTTP error to throw, with the per-field errors of refused answers. */
export function refusal(result: { reason: RefusalReason; errors?: FieldError[] }): HttpError {
  const error = answers[result.reason]();
  return result.errors ? new HttpError(error.statusCode, error.code, { fields: result.errors }) : error;
}
