import { describe, expect, it } from "vitest";
import { MEMBER_ID_ALLOW, memberIdGrantProblems } from "./member-id-grants.ts";

// The pure part of the Member id grant ratchet (RP-1258); the catalog read is packages/db/test/rp-1258-visibility-rls.test.ts.

describe("memberIdGrantProblems", () => {
  it("passes when every readable column and view is allowed and every entry names one", () => {
    expect(
      memberIdGrantProblems(
        [
          { table: "member", column: "id" },
          { table: "a_view", column: null, columns: ["id"] },
        ],
        [
          { column: "member.id", reason: "own Company" },
          { column: "a_view", reason: "no Member id", columns: ["id"] },
        ],
      ),
    ).toEqual([]);
  });

  it("fails a readable column or view that is not allowed", () => {
    expect(
      memberIdGrantProblems(
        [
          { table: "t", column: "checker_member_id" },
          { table: "a_view", column: null, columns: ["id"] },
        ],
        [],
      ),
    ).toEqual([
      "t.checker_member_id is a Member id column the app role may SELECT, and it is not on MEMBER_ID_ALLOW: revoke it from the app role, or add it to MEMBER_ID_ALLOW in packages/db/test-support/member-id-grants.ts with the reason no other Company reads it (visibility.md V14)",
      "a_view is a view the app role may SELECT, and it is not on MEMBER_ID_ALLOW: a view's columns carry no foreign key, so a Member id in it can't be found by its name alone; revoke it, or add it to MEMBER_ID_ALLOW in packages/db/test-support/member-id-grants.ts naming its columns (visibility.md V14)",
    ]);
  });

  it("fails an entry that names nothing readable, an entry with no reason and an entry given twice", () => {
    expect(
      memberIdGrantProblems(
        [{ table: "t", column: "member_id" }],
        [
          { column: "gone.member_id", reason: "revoked since" },
          { column: "t.member_id", reason: " " },
          { column: "t.member_id", reason: "own Member" },
        ],
      ),
    ).toEqual([
      "MEMBER_ID_ALLOW names gone.member_id, which the app role can't SELECT (or is gone): remove the entry",
      "MEMBER_ID_ALLOW's entry t.member_id gives no reason",
      "MEMBER_ID_ALLOW names t.member_id twice",
    ]);
  });
});

describe("memberIdGrantProblems on views", () => {
  it("passes an allowed view whose columns are the pinned ones, in order", () => {
    expect(
      memberIdGrantProblems([{ table: "a_view", column: null, columns: ["work_item_id", "scope_id"] }], [{ column: "a_view", reason: "no Member id", columns: ["work_item_id", "scope_id"] }]),
    ).toEqual([]);
  });

  it("fails an allowed view whose columns changed, naming the view, or that pins none", () => {
    expect(
      memberIdGrantProblems(
        [
          { table: "a_view", column: null, columns: ["work_item_id", "scope_id", "checker"] },
          { table: "b_view", column: null, columns: ["id"] },
        ],
        [
          { column: "a_view", reason: "no Member id", columns: ["work_item_id", "scope_id"] },
          { column: "b_view", reason: "no Member id" },
        ],
      ),
    ).toEqual([
      "a_view's columns are now (work_item_id, scope_id, checker), not the (work_item_id, scope_id) MEMBER_ID_ALLOW pins: re-check the view for Member ids, then pin its columns again",
      "b_view is a view on MEMBER_ID_ALLOW with no pinned columns: pin them (columns: [...]) so a column added later is caught",
    ]);
  });

  it("fails pinned columns on an entry that is a column, not a view", () => {
    expect(memberIdGrantProblems([{ table: "t", column: "member_id" }], [{ column: "t.member_id", reason: "own Member", columns: ["x"] }])).toEqual([
      "MEMBER_ID_ALLOW's entry t.member_id pins columns, but it is a column, not a view: remove them",
    ]);
  });
});

describe("MEMBER_ID_ALLOW", () => {
  it("never allows a column RP-1139 revoked because another Company read it", () => {
    const revoked = [
      "work_item_event.actor_member_id",
      "document.uploaded_by_member_id",
      "work_item.created_by_member_id",
      "numbering_pattern.set_by_member_id",
      "participant.invited_by_member_id",
      "participant.withdrawn_by_member_id",
      "project.creator_member_id",
    ];
    expect(MEMBER_ID_ALLOW.filter((a) => revoked.includes(a.column))).toEqual([]);
  });
});
