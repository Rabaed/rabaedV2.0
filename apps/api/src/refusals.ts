import { forbidden, HttpError, notFound } from "./http-error.ts";

// Every refusal the app.* functions answer with, as the API's HTTP answer.
// `not_found` is the Project or Participant itself: a plain 404, exactly like
// one that doesn't exist (visibility.md, "Direct URL or ID").
const answers = {
  forbidden,
  not_found: notFound,
  member_not_found: () => new HttpError(404, "member_not_found"),
  project_closed: () => new HttpError(409, "project_closed"),
  already_participant: () => new HttpError(409, "already_participant"),
  duplicate_code: () => new HttpError(409, "duplicate_code"),
  unknown_company: () => new HttpError(422, "unknown_company"),
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
  no_participant: () => new HttpError(409, "no_participant"),
  several_participants: () => new HttpError(409, "several_participants"),
  reason_required: () => new HttpError(422, "reason_required"),
  idempotency_key_reused: () => new HttpError(422, "idempotency_key_reused"),
} satisfies Record<string, () => HttpError>;

export type RefusalReason = keyof typeof answers;

/** A refused result as the HTTP error to throw. */
export function refusal(result: { reason: RefusalReason }): HttpError {
  return answers[result.reason]();
}
