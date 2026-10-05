import { describe, expect, it } from "vitest";
import { takeTransition } from "./check-migration-drift.fixtures.ts";
import { definedObjects, duplicateTimestamps, redefinitionDrift, staleOverloads } from "./check-migration-drift.ts";

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
