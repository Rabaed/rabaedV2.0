// A fixture the drift check's unit and git-replay tests share.

/** A migration `create or replace`-ing app.take_transition with these arguments; the comment tells copies apart. */
export const takeTransition = (comment: string, args = "p_work_item uuid, p_transition text") =>
  `-- ${comment}\ncreate or replace function app.take_transition(${args})\nreturns void language plpgsql as $$ begin null; end $$;\n`;

/** A migration rebuilding notification_kind_check to allow these kinds, as RP-643 and RP-155 each did (RP-963). */
export const kindCheck = (kinds: string[]) =>
  `alter table notification drop constraint notification_kind_check;\nalter table notification add constraint notification_kind_check\n  check (kind in (${kinds.map((kind) => `'${kind}'`).join(", ")}));\n`;
