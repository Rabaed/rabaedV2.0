// A fixture the drift check's unit and git-replay tests share.

/** A migration `create or replace`-ing app.take_transition with these arguments; the comment tells copies apart. */
export const takeTransition = (comment: string, args = "p_work_item uuid, p_transition text") =>
  `-- ${comment}\ncreate or replace function app.take_transition(${args})\nreturns void language plpgsql as $$ begin null; end $$;\n`;
