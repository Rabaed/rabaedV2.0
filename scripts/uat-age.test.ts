import { describe, expect, it } from "vitest";
import type { AgeCandidate } from "../packages/db/dev-tools/index.ts";
import { ageChanges, describeChange, parseAgeArgs } from "./uat-age.ts";

// `uat:age`'s pure part (RP-922, test 2): its arguments, and the plan it makes from the items whose
// Document Number or Subject come close to what was asked. `--weeks N` leaves each item at Step Age N
// (the dots its holder reads, 1 to 4+), every one of its times moved back by the same amount.

const WEEK = 7 * 24 * 3_600_000;
const HOUR = 3_600_000;
const now = new Date("2026-10-31T09:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const item = (documentNumber: string | null, subject: string, more: Partial<AgeCandidate> = {}): AgeCandidate => ({
  id: `id-${documentNumber ?? subject}`,
  documentNumber,
  subject,
  closed: false,
  stepEnteredAt: ago(2 * HOUR),
  participantEnteredAt: ago(3 * HOUR),
  ...more,
});

const slab = item("TWR-MAR-01-0004", "Slab rebar shop drawings");
const column = item("TWR-MAR-01-0005", "Column formwork");
const columnAgain = item("TWR-WIR-01-0002", "column formwork");
const candidates = [slab, column, columnAgain];

describe("parseAgeArgs", () => {
  const env = { COMPOSE_PROJECT_NAME: "rabaed-lane42" };

  it("reads the items, the weeks and --dry-run; the lane comes from the .env", () => {
    expect(parseAgeArgs(["--item", "TWR-MAR-01-0004", "--item", "Column formwork", "--weeks", "4", "--dry-run"], env)).toEqual({
      target: { kind: "lane", lane: 42 },
      items: ["TWR-MAR-01-0004", "Column formwork"],
      weeks: 4,
      dryRun: true,
    });
  });

  it("takes --lane over the .env's, and --uat for UAT (the GitHub Action)", () => {
    expect(parseAgeArgs(["--lane", "43", "--item", "x", "--weeks", "1"], env)).toMatchObject({ target: { kind: "lane", lane: 43 }, dryRun: false });
    expect(parseAgeArgs(["--uat", "--item", "x", "--weeks", "1"], {})).toMatchObject({ target: { kind: "uat" } });
    expect(parseAgeArgs(["--uat", "--lane", "42", "--item", "x", "--weeks", "1"], env)).toEqual({ error: "--lane and --uat are two targets: give one" });
  });

  it("refuses --weeks outside 1 to 52, or not a whole number", () => {
    for (const weeks of ["0", "53", "2.5", "four", "-1"]) {
      expect(parseAgeArgs(["--item", "x", "--weeks", weeks], env)).toEqual({ error: "--weeks is a whole number from 1 to 52" });
    }
    expect(parseAgeArgs(["--item", "x"], env)).toEqual({ error: "--weeks is a whole number from 1 to 52" });
  });

  it("refuses no item, an unknown option, and no lane anywhere", () => {
    expect(parseAgeArgs(["--weeks", "4"], env)).toEqual({ error: "give at least one --item (a Document Number or an exact Subject)" });
    expect(parseAgeArgs(["--item", "x", "--weeks", "4", "--force"], env)).toEqual({ error: "unknown option --force" });
    expect(parseAgeArgs(["--item", "x", "--weeks", "4"], {})).toEqual({ error: "no lane: this worktree's .env has no lane; give --lane <n> (or --uat)" });
  });
});

describe("ageChanges", () => {
  const plan = (items: string[], weeks = 4, list = candidates) => ageChanges({ items, weeks }, list, now);

  it("finds an item by its Document Number, any case, and moves its times so it reads Step Age N", () => {
    const result = plan(["twr-mar-01-0004"]);
    if ("errors" in result) throw new Error(result.errors.join("; "));
    const [aged] = result.items;
    expect(aged).toMatchObject({ id: slab.id, documentNumber: "TWR-MAR-01-0004", subject: "Slab rebar shop drawings" });
    // Into its fourth week by an hour: 3 weeks and 1 hour at its Step, so it reads 4 for the next week.
    expect(aged!.shiftMs).toBe(3 * WEEK + HOUR - 2 * HOUR);
    expect(aged!.stepAge).toEqual({ own: { from: 1, to: 4 }, others: { from: 1, to: 4 } });
  });

  it("finds an item by its exact Subject, any case and spaces around it", () => {
    const result = plan(["  slab REBAR shop drawings "]);
    expect("errors" in result ? result.errors : result.items.map((i) => i.id)).toEqual([slab.id]);
  });

  it("other Companies' Step Age moves by the same amount, from when the item reached them", () => {
    const reached = item("TWR-MAR-01-0009", "Reached K1 a week earlier", { stepEnteredAt: ago(2 * HOUR), participantEnteredAt: ago(WEEK + 2 * HOUR) });
    const result = plan(["TWR-MAR-01-0009"], 4, [reached]);
    if ("errors" in result) throw new Error(result.errors.join("; "));
    expect(result.items[0]!.stepAge).toEqual({ own: { from: 1, to: 4 }, others: { from: 2, to: 5 } });
  });

  it("refuses a text that matches no item, listing those that come close", () => {
    expect(plan(["Slab"])).toEqual({ errors: ['"Slab" matches no item by Document Number or exact Subject. Close: TWR-MAR-01-0004 "Slab rebar shop drawings"'] });
    expect(plan(["Roof"])).toEqual({ errors: ['"Roof" matches no item by Document Number or exact Subject'] });
  });

  it("refuses a Subject that several items share, listing them, and never guesses", () => {
    expect(plan(["Column formwork"])).toEqual({
      errors: ['"Column formwork" matches 2 items; give one of their Document Numbers: TWR-MAR-01-0005 "Column formwork", TWR-WIR-01-0002 "column formwork"'],
    });
  });

  it("refuses an item with no Step Age: a Draft or a closed item", () => {
    const draft = item(null, "Draft lintel");
    const closed = item("TWR-MAR-01-0001", "Closed one", { closed: true });
    expect(plan(["Draft lintel", "TWR-MAR-01-0001"], 4, [draft, closed])).toEqual({
      errors: ['"Draft lintel" is a Draft: a Draft has no Step Age (ADR 0020)', "TWR-MAR-01-0001 is closed: a closed item has no Step Age"],
    });
  });

  it("refuses an item already at Step Age N or more: it only moves times back", () => {
    const old = item("TWR-MAR-01-0007", "Old one", { stepEnteredAt: ago(5 * WEEK), participantEnteredAt: ago(5 * WEEK) });
    expect(plan(["TWR-MAR-01-0007"], 4, [old])).toEqual({ errors: ["TWR-MAR-01-0007 already reads Step Age 6: the tool moves times back only, so give --weeks above 6"] });
  });

  it("refuses one item named twice", () => {
    expect(plan(["TWR-MAR-01-0004", "Slab rebar shop drawings"])).toEqual({ errors: ["TWR-MAR-01-0004 is named twice"] });
  });

  it("reports every refusal at once, and plans nothing then", () => {
    const result = plan(["Roof", "Column formwork", "TWR-MAR-01-0004"]);
    expect(result).toEqual({ errors: [expect.stringContaining('"Roof"'), expect.stringContaining('"Column formwork"')] });
  });
});

describe("inside the GitHub job: the log is public (Orchestrator, 2026-10-31)", () => {
  // Texts no Document Number holds, so finding one in the output means item text leaked.
  const secret = ["Hidden lintel", "Private pour", "Quiet mast", "Covert slab", "Level-3-Slab"];
  const list = [
    item("TWR-MAR-01-0020", "Hidden lintel"),
    item("TWR-MAR-01-0021", "Private pour"),
    item("TWR-WIR-01-0022", "private pour"),
    item(null, "Quiet mast"),
    item("TWR-MAR-01-0023", "Covert slab", { closed: true }),
    item("TWR-MAR-01-0024", "Covert slab extra"),
    // A Subject shaped like a Document Number (Main 6, Note 1): it must never match by its Subject.
    item("TWR-MAR-01-0025", "Level-3-Slab"),
  ];
  const leaks = (lines: string[]) => lines.filter((line) => secret.some((text) => line.toLowerCase().includes(text.toLowerCase())));

  it("takes Document Numbers only, and refuses anything else without echoing it (Main 6)", () => {
    const actions = { GITHUB_ACTIONS: "true" };
    expect(parseAgeArgs(["--uat", "--item", "TWR-MAR-01-0002", "--item", "TWR-MAR-01-0003 Rev 1", "--weeks", "4"], actions)).toMatchObject({
      items: ["TWR-MAR-01-0002", "TWR-MAR-01-0003 Rev 1"],
    });
    const refused = parseAgeArgs(["--uat", "--item", "TWR-MAR-01-0002", "--item", "Hidden lintel", "--weeks", "4"], actions);
    expect(refused).toEqual({ error: "--item 2 is not a Document Number: in the GitHub job give its Document Number" });
    expect(leaks([JSON.stringify(refused)])).toEqual([]);
    // On a lane a Subject is fine.
    expect(parseAgeArgs(["--item", "Hidden lintel", "--weeks", "4"], { COMPOSE_PROJECT_NAME: "rabaed-lane42" })).toMatchObject({ items: ["Hidden lintel"] });
  });

  it("matches by Document Number only, never by Subject, and names items by number or --item <n> in every refusal", () => {
    const result = ageChanges({ items: ["TWR-MAR-01", "Level-3-Slab", "Hidden lintel", "TWR-MAR-01-0023", "TWR-MAR-01-0020", "twr-mar-01-0020"], weeks: 4 }, list, now, { itemText: false });
    if (!("errors" in result)) throw new Error("expected refusals");
    expect(result.errors).toEqual([
      "--item 1 matches no item by Document Number",
      "--item 2 matches no item by Document Number",
      "--item 3 matches no item by Document Number",
      "TWR-MAR-01-0023 is closed: a closed item has no Step Age",
      "TWR-MAR-01-0020 is named twice",
    ]);
    expect(leaks(result.errors)).toEqual([]);
  });

  it("prints a change by Document Number and Step Age only", () => {
    const result = ageChanges({ items: ["TWR-MAR-01-0020"], weeks: 4 }, list, now, { itemText: false });
    if ("errors" in result) throw new Error(result.errors.join("; "));
    const line = describeChange(result.items[0]!, { itemText: false });
    expect(line).toMatch(/^TWR-MAR-01-0020: Step Age 1 → 4 for its holder's Company/);
    expect(leaks([line])).toEqual([]);
  });

  it("still quotes Subjects on a lane", () => {
    const result = ageChanges({ items: ["Hidden lintel"], weeks: 4 }, list, now);
    if ("errors" in result) throw new Error(result.errors.join("; "));
    expect(describeChange(result.items[0]!)).toContain('TWR-MAR-01-0020 "Hidden lintel"');
  });
});
