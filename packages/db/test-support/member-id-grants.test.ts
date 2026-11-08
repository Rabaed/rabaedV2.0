import { describe, expect, it } from "vitest";
import { MEMBER_ID_ALLOW, memberIdGrantProblems } from "./member-id-grants.ts";

// The pure part of the Member id grant ratchet (RP-1258); the catalog read is packages/db/test/rp-1258-visibility-rls.test.ts.

describe("memberIdGrantProblems", () => {
  it("passes when every readable column and view is allowed and every entry names one", () => {
    expect(
      memberIdGrantProblems(
        [
          { table: "member", column: "id" },
          { table: "a_view", column: null },
        ],
        [
          { column: "member.id", reason: "own Company" },
          { column: "a_view", reason: "no Member id" },
        ],
      ),
    ).toEqual([]);
  });

  it("fails a readable column or view that is not allowed", () => {
    expect(
      memberIdGrantProblems(
        [
          { table: "t", column: "checker_member_id" },
          { table: "a_view", column: null },
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
