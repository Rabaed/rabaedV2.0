import { describe, expect, it } from "vitest";
import { argumentValue, idsIn, sweepProblems, type AllowEntry, type CatalogFunction, type ForbiddenId, type SweepCall } from "./id-sweep.ts";

// The pure parts of the seam-2 id sweep (RP-1166); the sweep itself is packages/db/test/id-sweep-rls.test.ts.

const OW = "0b6f2a43-0000-4000-8000-000000000001";
const K1_MEMBER = "0b6f2a43-0000-4000-8000-000000000002";
const forbidden: ForbiddenId[] = [
  { id: OW, kind: "participant", what: "OW's Participant" },
  { id: K1_MEMBER, kind: "member", what: "K1's Engineer" },
];

describe("idsIn", () => {
  it("finds a forbidden id in any column, nested value or array, with where it was", () => {
    const rows = [{ a: 1, holder: OW }, { list: [{ deep: { ids: ["x", K1_MEMBER] } }] }];
    expect(idsIn(rows, forbidden)).toEqual([
      { id: OW, kind: "participant", what: "OW's Participant", at: "[0].holder" },
      { id: K1_MEMBER, kind: "member", what: "K1's Engineer", at: "[1].list[0].deep.ids[1]" },
    ]);
  });

  it("finds an id inside text, such as an error's message, in any case", () => {
    expect(idsIn({ error: `no access to ${OW.toUpperCase()}` }, forbidden).map((h) => h.at)).toEqual(["error"]);
  });

  it("finds nothing in rows without them", () => {
    expect(idsIn([{ id: "0b6f2a43-0000-4000-8000-000000000003", n: null, b: true }], forbidden)).toEqual([]);
  });
});

const fn = (name: string, extra: Partial<CatalogFunction> = {}): CatalogFunction => ({ name, signature: `${name}(uuid)`, args: [{ name: "p_work_item_id", type: "uuid" }], ...extra });
const call = (name: string, hits: SweepCall["hits"] = [], world = "RP-598-1"): SweepCall => ({ name, signature: `${name}(uuid)`, world, viewer: "C1's PM", hits, error: null });
const hit = { id: OW, kind: "participant" as const, what: "OW's Participant", at: "[0].participant_id" };

describe("sweepProblems", () => {
  it("passes when every function was called and none gave a forbidden id", () => {
    expect(sweepProblems([fn("app.a"), fn("app.b")], [call("app.a"), call("app.b")], [])).toEqual([]);
  });

  it("names each forbidden id a function gave, with the world, the viewer and where", () => {
    expect(sweepProblems([fn("app.a")], [call("app.a", [hit])], [])).toEqual([
      "app.a(uuid) gave C1's PM OW's Participant (participant 0b6f2a43-0000-4000-8000-000000000001) at [0].participant_id, in scenario RP-598-1",
    ]);
  });

  it("fails a function neither swept nor on the allow list (the ratchet)", () => {
    expect(sweepProblems([fn("app.a"), fn("app.new")], [call("app.a")], [])).toEqual([
      "app.new(uuid) is neither swept nor on the allow list: sweep it, or add it to SWEEP_ALLOW in packages/db/test-support/id-sweep.ts with a reason",
    ]);
  });

  it("accepts a function the allow list skips, with its reason", () => {
    const allow: AllowEntry[] = [{ name: "app.new", skip: "it takes no argument a world can give" }];
    expect(sweepProblems([fn("app.a"), fn("app.new")], [call("app.a")], allow)).toEqual([]);
  });

  it("excuses an id kind on one function only, in the worlds the entry names", () => {
    const allow: AllowEntry[] = [{ name: "app.a", kinds: ["participant"], worlds: ["RP-598-1"], reason: "the map, V20" }];
    expect(sweepProblems([fn("app.a")], [call("app.a", [hit])], allow)).toEqual([]);
    expect(sweepProblems([fn("app.a")], [call("app.a", [hit], "RP-1166-1")], allow)).toHaveLength(2); // the hit, and the entry excusing nothing
  });

  it("excuses only the ids an entry's `whats` names, when it names some", () => {
    const allow: AllowEntry[] = [{ name: "app.a", kinds: ["participant"], whats: ["the Host Company's Participant"], reason: "V15" }];
    expect(sweepProblems([fn("app.a")], [call("app.a", [hit])], allow)).toHaveLength(2); // OW's Participant is not the Host's: the hit stays, the entry excuses nothing
    const host = { ...hit, what: "the Host Company's Participant" };
    expect(sweepProblems([fn("app.a")], [call("app.a", [host])], allow)).toEqual([]);
  });

  it("fails an allow entry for a function that no longer exists, or one that excuses nothing", () => {
    const allow: AllowEntry[] = [
      { name: "app.gone", skip: "was here" },
      { name: "app.a", kinds: ["member"], reason: "expected, pending RP-1139", pending: "RP-1139" },
    ];
    expect(sweepProblems([fn("app.a")], [call("app.a")], allow)).toEqual([
      "SWEEP_ALLOW names app.gone, which the app role cannot execute (or is gone): remove the entry",
      "SWEEP_ALLOW excuses member ids from app.a, but no call gave one (pending RP-1139 is fixed?): remove the entry",
    ]);
  });

  it("refuses an entry with no reason", () => {
    expect(sweepProblems([fn("app.a")], [call("app.a", [hit])], [{ name: "app.a", kinds: ["participant"], reason: " " }])).toContain(
      "SWEEP_ALLOW's entry for app.a gives no reason",
    );
  });
});

describe("argumentValue", () => {
  const world = {
    item: "11111111-0000-4000-8000-000000000001",
    projectId: "22222222-0000-4000-8000-000000000002",
    typeCode: "DAR",
    title: "Earthing",
    named: { p_definition_id: "33333333-0000-4000-8000-000000000003" },
  };
  const viewer = { member: "44444444-0000-4000-8000-000000000004", participant: "55555555-0000-4000-8000-000000000005", company: "66666666-0000-4000-8000-000000000006", email: "a@rabaed.test" };
  const value = (name: string, type: string) => argumentValue({ name, type }, world, viewer);

  it("gives the world's item, Project and named ids by the argument's name", () => {
    expect(value("p_work_item_id", "uuid")).toBe(world.item);
    expect(value("p_closed_item_id", "uuid")).toBe(world.item);
    expect(value("p_project_id", "uuid")).toBe(world.projectId);
    expect(value("p_definition_id", "uuid")).toBe(world.named.p_definition_id);
    expect(value("p_work_item_ids", "uuid[]")).toEqual([world.item]);
    expect(value("p_project_ids", "uuid[]")).toEqual([world.projectId]);
  });

  it("gives the viewer's own Member, Participant and Company", () => {
    expect(value("p_member_id", "uuid")).toBe(viewer.member);
    expect(value("p_participant_id", "uuid")).toBe(viewer.participant);
    expect(value("p_company_id", "uuid")).toBe(viewer.company);
    expect(value("p_email", "text")).toBe(viewer.email);
  });

  it("gives a plain value of the type for anything else", () => {
    expect(value("p_type_code", "text")).toBe("DAR");
    expect(value("p_q", "text")).toBe("Earthing");
    expect(value("p_reason", "text")).toBe("x");
    expect(value("p_now", "timestamp with time zone")).toBeInstanceOf(Date);
    expect(value("p_answers", "jsonb")).toBe("{}");
    expect(value("p_lock", "boolean")).toBe(false);
    expect(value("p_limit", "integer")).toBe(50);
    expect(value("p_keys", "text[]")).toEqual([]);
    expect(value("p_token_hash", "bytea")).toEqual(Buffer.from([0]));
    expect(value("p_window", "interval")).toBe("1 day");
    expect(typeof value("p_idempotency_key", "uuid")).toBe("string");
  });

  it("gives null for a type it has no value for", () => {
    expect(value("p_point", "point")).toBeNull();
  });
});
