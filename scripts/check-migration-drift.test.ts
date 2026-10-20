import { describe, expect, it } from "vitest";
import { kindCheck, takeTransition } from "./check-migration-drift.fixtures.ts";
import { branchOrderDrift, definedObjects, driftMessage, duplicateTimestamps, orderMessage, redefinitionDrift, staleOverloads } from "./check-migration-drift.ts";

describe("duplicateTimestamps", () => {
  const files = [
    "20261103000000_answer_permission_speed.sql",
    "20261104000000_function_grants.sql",
    "20261104000000_numbering_after_answer_speed.sql",
    "20261104000100_numbering_admin.sql",
  ];

  it("names both files when the change adds a migration whose timestamp main already uses (RP-317 and the RP-311 fix-up)", () => {
    expect(duplicateTimestamps(files, ["20261104000000_numbering_after_answer_speed.sql"])).toEqual([
      ["20261104000000_function_grants.sql", "20261104000000_numbering_after_answer_speed.sql"],
    ]);
  });

  it("fails two added migrations sharing a timestamp", () => {
    expect(duplicateTimestamps(["20261105000000_a.sql", "20261105000000_b.sql"], ["20261105000000_a.sql", "20261105000000_b.sql"])).toEqual([
      ["20261105000000_a.sql", "20261105000000_b.sql"],
    ]);
  });

  it("passes a duplicate already on main: those files can no longer be renamed", () => {
    expect(duplicateTimestamps(files, ["20261104000100_numbering_admin.sql"])).toEqual([]);
  });

  it("passes unique timestamps, however close", () => {
    expect(duplicateTimestamps(["20261104000000_a.sql", "20261104000001_b.sql", "README.md"], ["20261104000001_b.sql"])).toEqual([]);
  });
});

describe("definedObjects", () => {
  it("finds app functions created, replaced or dropped, in any case and spacing", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION app.Take_Transition(p uuid) returns void as $$ $$;
      create function
        app."issue_document_number"(p uuid) returns text as $$ $$;
      drop function app.work_item_history(uuid);
    `;
    expect(definedObjects(sql)).toEqual(["function app.take_transition", "function app.issue_document_number", "function app.work_item_history"]);
  });

  it("finds app views and row-level security policies", () => {
    const sql = `
      create or replace view app.visible_work_item as select 1;
      drop policy member_reads_own_project_members on project_member;
      create policy member_reads_own_project_members on public.project_member using (true);
    `;
    expect(definedObjects(sql)).toEqual(["view app.visible_work_item", "policy member_reads_own_project_members on project_member"]);
  });

  it("finds table constraints dropped or added, by name and table, in single and multi-clause alter table (RP-963)", () => {
    const sql = `
      alter table notification drop constraint notification_kind_check;
      ALTER TABLE notification ADD CONSTRAINT Notification_Kind_Check
        check (kind in ('step_reached', 'record_ready'));
      alter table if exists only app."numbering_pattern"
        drop constraint if exists numbering_pattern_shape,
        add constraint numbering_pattern_shape check (follows_project or app.is_numbering_pattern(segments, seq_scope)),
        add column x int;
    `;
    expect(definedObjects(sql)).toEqual([
      "constraint notification_kind_check on notification",
      "constraint numbering_pattern_shape on numbering_pattern",
    ]);
  });

  it("ignores constraints declared inside create table: a new table is no rebuild", () => {
    expect(definedObjects("create table package (id uuid, constraint package_kind_check check (kind in ('a')));")).toEqual([]);
  });

  // Review fix 8: one table, however it is written.
  it("names a constraint's table the same, quoted, schema-qualified or bare", () => {
    for (const table of ['"public"."notification"', "public.notification", "notification", '"notification"', 'public."notification"']) {
      expect(definedObjects(`alter table ${table} drop constraint notification_kind_check;`), table).toEqual(["constraint notification_kind_check on notification"]);
    }
  });

  // Review fix 9: a `--` in a string is not a comment, and one statement never reaches into the next.
  it("does not cut a statement at a -- or ; inside a string literal", () => {
    const sql = `
      alter table note add constraint note_body_check check (body <> '--' and body <> ';'), add constraint note_title_check check (title <> 'it''s -- not');
    `;
    expect(definedObjects(sql)).toEqual(["constraint note_body_check on note", "constraint note_title_check on note"]);
  });

  it("does not let an alter table without its ; take the next one's constraints", () => {
    const sql = `
      alter table note add column x int
      alter table notification drop constraint notification_kind_check;
    `;
    expect(definedObjects(sql)).toEqual(["constraint notification_kind_check on notification"]);
  });

  // Review fix 10: a function body runs when called, not when the migration runs.
  it("ignores an alter table inside a function body, but not inside a do block", () => {
    const sql = `
      create or replace function app.fix_later() returns void language plpgsql as $body$
      begin
        alter table notification drop constraint notification_kind_check;
      end $body$;
      do $$ begin alter table note drop constraint note_body_check; end $$;
    `;
    expect(definedObjects(sql)).toEqual(["function app.fix_later", "constraint note_body_check on note"]);
  });

  it("ignores commented-out SQL and functions outside app", () => {
    const sql = `
      -- create or replace function app.take_transition() was here
      create or replace function public.helper() returns int as $$ select 1 $$;
    `;
    expect(definedObjects(sql)).toEqual([]);
  });
});


// The RP-311 case (PR #113): RP-312 redefined app.take_transition on the
// branch; main then brought RP-299's migrations redefining it from their older
// copy, which sort later and so replaced the branch's body.
const mainBefore = { name: "20261020000000_link_search.sql", sql: takeTransition("main before the branch") };
const mainLater = [
  { name: "20261030000100_take_transition_sections.sql", sql: takeTransition("RP-299") },
  { name: "20261102000000_review_fixes.sql", sql: takeTransition("RP-299 review") },
  { name: "20261103000000_answer_permission_speed.sql", sql: takeTransition("RP-299 speed") },
];
const forkPoint = [mainBefore.name];
const afterMergingMain = [mainBefore.name, ...mainLater.map((m) => m.name)];
const numberingPattern = { name: "20261026100000_numbering_pattern.sql", sql: takeTransition("RP-312"), seen: forkPoint };

describe("redefinitionDrift", () => {
  it("fails the RP-311 case: a branch redefines a function, then merges a main that redefines it later", () => {
    expect(redefinitionDrift([mainBefore, ...mainLater], [numberingPattern])).toEqual([
      {
        object: "function app.take_transition",
        branch: ["20261026100000_numbering_pattern.sql"],
        main: mainLater.map((m) => m.name),
      },
    ]);
  });

  it("passes once the branch adds a later migration redefining the function, after merging main", () => {
    const fixUp = { name: "20261104000000_numbering_after_answer_speed.sql", sql: takeTransition("fix-up"), seen: afterMergingMain };
    expect(redefinitionDrift([mainBefore, ...mainLater], [numberingPattern, fixUp])).toEqual([]);
  });

  it("fails when the branch's later definition was written before main's arrived, though it sorts last", () => {
    const writtenEarly = { name: "20261104000000_numbering_after_answer_speed.sql", sql: takeTransition("before merging"), seen: forkPoint };
    expect(redefinitionDrift([mainBefore, ...mainLater], [writtenEarly])).toEqual([
      { object: "function app.take_transition", branch: [writtenEarly.name], main: mainLater.map((m) => m.name) },
    ]);
  });

  it("passes when only main redefined the function, or only the branch", () => {
    const otherFunction = { name: "20261027000000_other.sql", sql: "create or replace function app.other() returns int language sql as $$ select 1 $$;", seen: forkPoint };
    expect(redefinitionDrift([mainBefore, ...mainLater], [otherFunction])).toEqual([]);
    expect(redefinitionDrift([mainBefore], [numberingPattern])).toEqual([]);
  });

  it("fails when the branch redefines a function with an older timestamp than main's definition", () => {
    const oldTimestamp = { name: "20261001000000_late_but_old.sql", sql: takeTransition("old timestamp"), seen: afterMergingMain };
    expect(redefinitionDrift([mainBefore, ...mainLater], [oldTimestamp])).toEqual([
      { object: "function app.take_transition", branch: [oldTimestamp.name], main: [mainBefore.name, ...mainLater.map((m) => m.name)] },
    ]);
  });
});

// RP-963: RP-643 (Packages, on the branch) and RP-155 (Documental Record, on
// main) each rebuilt notification_kind_check from only the kinds they knew; the
// later-sorting one dropped the other's kind. 20270820 rebuilt it with both.
describe("redefinitionDrift of a table constraint", () => {
  const kinds = ["step_reached", "watched_event"];
  const handover = { name: "20270112000000_handover.sql", sql: kindCheck(kinds) };
  const recordChecks = { name: "20270805000000_record_checks.sql", sql: kindCheck([...kinds, "record_ready"]) };
  const packageSubmit = { name: "20270816000000_package_submit_notification.sql", sql: kindCheck([...kinds, "package_submitted"]), seen: [handover.name] };
  const object = "constraint notification_kind_check on notification";

  it("fails a check constraint the branch and main both rebuilt, naming both migrations", () => {
    expect(redefinitionDrift([handover, recordChecks], [packageSubmit])).toEqual([{ object, branch: [packageSubmit.name], main: [recordChecks.name] }]);
  });

  it("passes a check constraint only the branch rebuilt", () => {
    expect(redefinitionDrift([handover], [packageSubmit])).toEqual([]);
  });

  it("passes once a later migration, written after merging main, rebuilds it with both sides' kinds", () => {
    const reconcile = {
      name: "20270820000000_notification_kinds_package_and_record.sql",
      sql: kindCheck([...kinds, "record_ready", "package_submitted"]),
      seen: [handover.name, recordChecks.name, packageSubmit.name],
    };
    expect(redefinitionDrift([handover, recordChecks], [packageSubmit, reconcile])).toEqual([]);
  });

  it("says which constraint, both migrations and the rule 11.1 fix: a new later migration with both sides", () => {
    const [problem, fix] = driftMessage({ object, branch: [packageSubmit.name], main: [recordChecks.name] });
    expect(problem).toBe(
      "constraint notification_kind_check on notification is redefined on this branch (20270816000000_package_submit_notification.sql) and on main (20270805000000_record_checks.sql).",
    );
    expect(fix).toBe(
      "  Merge main, then rebuild it in a new migration that sorts after all of these, with both sides' change: for a check constraint, every value either side allows (planning/parallel-sessions.md rule 11.1).",
    );
  });

  it("keeps the function fix text for a function, and names rule 11.1", () => {
    expect(driftMessage({ object: "function app.take_transition", branch: ["b.sql"], main: ["m.sql"] })[1]).toBe(
      "  Merge main, then redefine it in a new migration that sorts after all of these: start from the newest body and re-apply this branch's change (planning/parallel-sessions.md rule 11.1).",
    );
  });

  it("tells constraints of the same name on different tables apart", () => {
    const otherTable = { name: "20270805000000_other.sql", sql: "alter table outbox drop constraint notification_kind_check;" };
    expect(redefinitionDrift([handover, otherTable], [packageSubmit])).toEqual([]);
  });
});

// RP-457: two implementers build in parallel and each redefine app.take_transition
// from the same old body; the later-sorting one silently replaces the other.
describe("branchOrderDrift", () => {
  const wf7 = { name: "20270201000000_wf7.sql", sql: takeTransition("WF-7"), seen: forkPoint };
  const unrelated = { name: "20270202000000_other.sql", sql: "create or replace function app.other() returns int language sql as $$ select 1 $$;", seen: forkPoint };

  it("fails two branch migrations redefining a function from the same base, naming both", () => {
    const wf8 = { name: "20270203000000_wf8.sql", sql: takeTransition("WF-8"), seen: forkPoint };
    expect(branchOrderDrift([wf7, wf8])).toEqual([{ object: "function app.take_transition", earlier: wf7.name, later: wf8.name }]);
  });

  it("passes a sequential chain, each built on the previous", () => {
    const wf8 = { name: "20270203000000_wf8.sql", sql: takeTransition("WF-8"), seen: [...forkPoint, wf7.name] };
    const wf9 = { name: "20270204000000_wf9.sql", sql: takeTransition("WF-9"), seen: [...forkPoint, wf7.name, wf8.name] };
    expect(branchOrderDrift([wf7, wf8, wf9])).toEqual([]);
  });

  it("judges each migration against the previous one that defines the object, in name order", () => {
    const wf8 = { name: "20270203000000_wf8.sql", sql: takeTransition("WF-8"), seen: [...forkPoint, wf7.name] };
    const wf9 = { name: "20270204000000_wf9.sql", sql: takeTransition("WF-9"), seen: [...forkPoint, wf7.name, unrelated.name] };
    expect(branchOrderDrift([wf9, unrelated, wf8, wf7])).toEqual([{ object: "function app.take_transition", earlier: wf8.name, later: wf9.name }]);
  });

  it("passes migrations that define different objects, however unseen", () => {
    expect(branchOrderDrift([wf7, unrelated])).toEqual([]);
  });

  // Review fix 11: a constraint has no body to start from.
  it("words the fix for a constraint as a rebuild with both migrations' values, and for a function as before", () => {
    const [problem, fix] = orderMessage({ object: "constraint notification_kind_check on notification", earlier: "a.sql", later: "b.sql" });
    expect(problem).toBe("constraint notification_kind_check on notification is redefined by b.sql without its seeing a.sql, the previous migration on this branch that defines it; the later one replaces the earlier one's change.");
    expect(fix).toBe(
      "  Add a new migration that sorts after both, written with both in the tree, that rebuilds it with both migrations' change: for a check constraint, every value either allows.",
    );
    expect(orderMessage({ object: "function app.take_transition", earlier: "a.sql", later: "b.sql" })[1]).toBe(
      "  Add a new migration that sorts after both, written with both in the tree: start from b.sql's body and re-apply a.sql's change.",
    );
  });
});

// The RP-312 case: main's RP-300 dropped app.take_transition's `p_reason text`
// signature for `p_answers jsonb`; RP-312, written against the older copy,
// `create or replace`d the `p_reason` one. A different signature is a second
// function, so the stale one came back beside main's (main dropped it again in
// 20261108000000_drop_stale_take_transition).
const oldArgs = "p_work_item_id uuid, p_transition_key text, p_reason text, p_internal_note text, p_checked_data_sha256 bytea, p_idempotency_key uuid, p_now timestamptz";
const newArgs = "p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea, p_idempotency_key uuid, p_now timestamptz";
const answersHistory = { name: "20261019000000_answers_history.sql", sql: takeTransition("main with p_reason", oldArgs) };
const actionForms = {
  name: "20261026000000_action_forms.sql",
  sql: `drop function app.take_transition(uuid, text, text, text, bytea, uuid, timestamptz);\n${takeTransition("RP-300", newArgs).replace("or replace ", "")}`,
};
const stalePattern = { name: "20261026100000_numbering_pattern.sql", sql: takeTransition("RP-312 from the older copy", oldArgs), seen: [answersHistory.name] };

describe("staleOverloads", () => {
  it("fails the RP-312 case: the branch re-creates a signature main dropped", () => {
    expect(staleOverloads([answersHistory, actionForms], [stalePattern])).toEqual([
      {
        signature: "app.take_transition(uuid, text, text, text, bytea, uuid, timestamptz)",
        branch: [stalePattern.name],
        main: [actionForms.name],
      },
    ]);
  });

  it("fails a new overload beside a function main redefined out of the branch's sight", () => {
    const mainLater = { name: "20261030000000_sections.sql", sql: takeTransition("main moved on", newArgs) };
    const newOverload = { name: "20261031000000_shortcut.sql", sql: takeTransition("branch", "p_work_item_id uuid"), seen: [answersHistory.name, actionForms.name] };
    expect(staleOverloads([answersHistory, actionForms, mainLater], [newOverload])).toEqual([
      { signature: "app.take_transition(uuid)", branch: [newOverload.name], main: [mainLater.name] },
    ]);
  });

  it("passes a branch that changes the signature itself: it drops the old one", () => {
    const changed = {
      name: "20261031000000_change_signature.sql",
      sql: `drop function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz);\n${takeTransition("branch", "p_work_item_id uuid")}`,
      seen: [answersHistory.name],
    };
    expect(staleOverloads([answersHistory, actionForms], [changed])).toEqual([]);
  });

  it("passes the branch's own overload of a function main has not touched since the branch saw it", () => {
    const overload = { name: "20261031000000_overload.sql", sql: takeTransition("branch", "p_work_item_id uuid"), seen: [answersHistory.name, actionForms.name] };
    expect(staleOverloads([answersHistory, actionForms], [overload])).toEqual([]);
  });

  it("matches a signature however its types are written: names, modes, defaults, aliases and OUT arguments don't count", () => {
    const main = [{ name: "20261020000000_a.sql", sql: takeTransition("main", "p_n integer, p_at timestamp with time zone default now(), p_tag character varying(20) = 'x'") }];
    const branch = [{ name: "20261021000000_b.sql", sql: takeTransition("branch", 'in "n" int4, timestamptz, varchar, out p_result text'), seen: [] }];
    expect(staleOverloads(main, branch)).toEqual([]);
  });

  it("finds a stale overload with a function that has no arguments", () => {
    const main = [
      { name: "20261020000000_a.sql", sql: takeTransition("main", "") },
      { name: "20261021000000_b.sql", sql: `drop function if exists app.take_transition();\n${takeTransition("main", "p_n integer")}` },
    ];
    const branch = [{ name: "20261022000000_c.sql", sql: takeTransition("branch from the old copy", ""), seen: [main[0]!.name] }];
    expect(staleOverloads(main, branch)).toEqual([{ signature: "app.take_transition()", branch: [branch[0]!.name], main: [main[1]!.name] }]);
  });
});
