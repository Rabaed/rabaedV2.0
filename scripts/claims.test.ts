import { describe, expect, it } from "vitest";
import { bodyText, claimCovers, fetchComments, flagMergedClaims, formatClaims, parseArgs, readClaims, type Comment } from "./claims.ts";

const at = (id: number, text: string): Comment => ({ id, created: `2026-10-${String(id - 14000).padStart(2, "0")}T10:00:00.000+0300`, text });

describe("readClaims", () => {
  it("reads the key, lane and files of a claim, and ignores other comments", () => {
    const claims = readClaims([
      at(14001, "CLAIM `app.work_item_actions` (a 5th column), apps/api/src/work-items/query.ts — Main 3, lane-3a, RP-658"),
      at(14002, "ASK planning/parallel-sessions.md — Main 1, lane-1d, RP-538 → Main 5"),
      at(14003, "NOTE for Main 1 about RP-640"),
    ]);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ id: 14001, key: "RP-658", lane: "lane-3a", releasedBy: undefined });
    expect(claims[0]?.files).toBe("app.work_item_actions (a 5th column), apps/api/src/work-items/query.ts");
  });

  it("takes the files from the next lines when the claim opens with the attribution", () => {
    const [claim] = readClaims([at(14001, "CLAIM — Main 3, lane-3d, RP-630 (SNAG-10). All additive:\n* `packages/ui/src/snag-list.tsx`\n* `apps/web/messages/en.json`")]);
    expect(claim).toMatchObject({ key: "RP-630", lane: "lane-3d" });
    expect(claim?.files).toContain("packages/ui/src/snag-list.tsx");
  });

  it("names the owner by the first key after Main, not an earlier or later key", () => {
    const [claim] = readClaims([at(14001, "CLAIM apps/api/src/work-items/query.ts — Main 4, lane-4c, RP-674 (INSP-11, spec RP-649). Removes RP-652's prefix.")]);
    expect(claim?.key).toBe("RP-674");
    expect(claim?.keys).toEqual(["RP-674", "RP-649"]);
  });

  it("a RELEASE naming the claim's key releases it", () => {
    const claims = readClaims([at(14001, "CLAIM scripts/screens*.ts — Main 1, lane-1b, RP-531"), at(14002, "RELEASE scripts/screens*.ts — RP-531 (PR #231, PR #233)")]);
    expect(claims[0]?.releasedBy).toBe(14002);
  });

  it("a RELEASE naming the claim's comment id releases it, whatever key it carries", () => {
    const claims = readClaims([
      at(14001, "CLAIM a.ts — Main 2, lane-2c, RP-155"),
      at(14002, "CLAIM b.ts — Main 2, lane-2c, RP-156"),
      at(14003, "RELEASE (claims 14001 and 14002), posted by Main 2 for its archived lanes"),
    ]);
    expect(claims.map((c) => c.releasedBy)).toEqual([14003, 14003]);
  });

  it("a RELEASE for a spec's key releases the claims posted under that spec", () => {
    const claims = readClaims([at(14001, "CLAIM notification kinds — Main 5, lane-5b, RP-640 (spec RP-631, integration branch)"), at(14002, "RELEASE, posted by Main 5. Spec RP-631 merged.")]);
    expect(claims[0]?.releasedBy).toBe(14002);
  });

  it("a RELEASE for another key leaves the claim open", () => {
    const claims = readClaims([at(14001, "CLAIM a.ts — Main 1, lane-1a, RP-100"), at(14002, "RELEASE a.ts — RP-101 (PR #1)")]);
    expect(claims[0]?.releasedBy).toBeUndefined();
  });

  it("a claim posted after a release of the same key is a new, open claim", () => {
    const claims = readClaims([
      at(14001, "CLAIM a.ts — Main 3, lane-3d, RP-629"),
      at(14002, "RELEASE a.ts — RP-629 (PR #292 closed unmerged)"),
      at(14003, "CLAIM b.ts — Main 3, lane-3d, RP-629"),
    ]);
    expect(claims.map((c) => c.releasedBy)).toEqual([14002, undefined]);
  });

  it("matches in comment order even when Jira returns them newest first", () => {
    const claims = readClaims([at(14002, "RELEASE a.ts — RP-531"), at(14001, "CLAIM a.ts — Main 1, lane-1b, RP-531")]);
    expect(claims[0]?.releasedBy).toBe(14002);
  });

  it("does not mistake a PR or ticket number for a comment id", () => {
    const claims = readClaims([at(14001, "CLAIM a.ts — Main 1, lane-1b, RP-531"), at(14002, "RELEASE a.ts — RP-999 (PR #14001)")]);
    expect(claims[0]?.releasedBy).toBeUndefined();
  });
});

describe("claimCovers", () => {
  const claim = (text: string) => ({ text });
  it("finds a path, a directory, a glob and a function name", () => {
    expect(claimCovers(claim("CLAIM package.json (root scripts) — Main 1"), "package.json")).toBe(true);
    expect(claimCovers(claim("CLAIM apps/admin/workflows/ (new WIR.json)"), "apps/admin/workflows/WIR.json")).toBe(true);
    expect(claimCovers(claim("CLAIM scripts/check-migrations*.ts"), "scripts/check-migrations-days.ts")).toBe(true);
    expect(claimCovers(claim("CLAIM `app.take_transition`"), "app.take_transition")).toBe(true);
  });
  it("accepts Windows separators and a leading ./", () => {
    expect(claimCovers(claim("CLAIM apps/api/src/work-items/query.ts"), ".\\apps\\api\\src\\work-items\\query.ts")).toBe(true);
  });
  it("does not match another file, a glob that does not fit, or a longer name", () => {
    expect(claimCovers(claim("CLAIM scripts/check-migrations*.ts"), "scripts/queue-pr.ts")).toBe(false);
    expect(claimCovers(claim("CLAIM scripts/screens*.ts"), "scripts/sub/screens.ts")).toBe(false);
    expect(claimCovers(claim("CLAIM apps/api/package.json"), "package.json")).toBe(true); // a plain substring: the safe side of "is it claimed?"
    expect(claimCovers(claim("CLAIM apps/admin/workflows-old/x.json"), "apps/admin/workflows/x.json")).toBe(false);
  });
  it("reads Jira's escaped markdown glob (scripts/lanes\\*.ts)", () => {
    const [c] = readClaims([at(14001, "CLAIM scripts/lanes\\*.ts — Main 1, lane-1d, RP-605")]);
    expect(c && claimCovers(c, "scripts/lanes-prune.ts")).toBe(true);
  });
});

describe("flagMergedClaims", () => {
  const pr = (number: number, branch: string, mergedAt: string, title = "") => ({ number, branch, title, mergedAt });
  it("flags an open claim whose branch starts with its key and merged after the claim", () => {
    const claims = readClaims([at(14005, "CLAIM a.ts — Main 3, lane-3a, RP-658")]);
    flagMergedClaims(claims, [pr(331, "RP-658-participant-pick", "2026-10-19T00:00:00Z")]);
    expect(claims[0]?.mergedPrs).toEqual([331]);
    expect(formatClaims(claims)).toContain("MERGED PR #331, NO RELEASE");
  });
  it("flags the PR the claim names", () => {
    const claims = readClaims([at(14005, "CLAIM a.ts — Main 4, lane-4a, RP-577, PR #328 (not yet queued)")]);
    flagMergedClaims(claims, [pr(328, "other-branch", "2026-10-19T00:00:00Z")]);
    expect(claims[0]?.mergedPrs).toEqual([328]);
  });
  it("ignores a PR merged before the claim, another key's PR, and a released claim", () => {
    const claims = readClaims([at(14005, "CLAIM a.ts — Main 3, lane-3a, RP-658"), at(14006, "CLAIM b.ts — Main 3, lane-3a, RP-659"), at(14007, "RELEASE b.ts — RP-659")]);
    flagMergedClaims(claims, [pr(1, "RP-658-old", "2026-09-01T00:00:00Z"), pr(2, "RP-6580-x", "2026-10-19T00:00:00Z"), pr(3, "RP-659-x", "2026-10-19T00:00:00Z")]);
    expect(claims.map((c) => c.mergedPrs)).toEqual([[], []]);
  });
});

describe("formatClaims and parseArgs", () => {
  it("prints one short line per claim, marking the released ones", () => {
    const text = formatClaims(readClaims([at(14001, "CLAIM a.ts — Main 1, lane-1b, RP-531"), at(14002, "RELEASE a.ts — RP-531"), at(14003, "CLAIM b.ts — Main 2, lane-2a, RP-951")]));
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("released 14002");
    expect(text).toContain("OPEN");
  });
  it("truncates a long file list", () => {
    const [claim] = readClaims([at(14001, `CLAIM ${"x/y.ts, ".repeat(60)} — Main 1, lane-1b, RP-531`)]);
    expect(claim?.files.length).toBeLessThanOrEqual(70);
  });
  it("reads the flags and refuses the rest", () => {
    expect(parseArgs(["--open", "--file", "package.json"])).toEqual({ open: true, file: "package.json" });
    expect(parseArgs([])).toEqual({ open: false, file: undefined });
    expect(() => parseArgs(["--file"])).toThrow(/needs a path/);
    expect(() => parseArgs(["--all"])).toThrow(/usage/);
  });
});

describe("bodyText and fetchComments", () => {
  const doc = (...paragraphs: string[][]) => ({ type: "doc", content: paragraphs.map((texts) => ({ type: "paragraph", content: texts.map((text) => ({ type: "text", text })) })) });
  it("flattens an Atlassian document into lines", () => {
    expect(bodyText(doc(["CLAIM a.ts — ", "Main 1"], ["second line"]))).toBe("CLAIM a.ts — Main 1\nsecond line");
    expect(bodyText("already text")).toBe("already text");
  });
  it("pages through the comments and sends the credentials as basic auth", async () => {
    const seen: string[] = [];
    const page = (ids: number[], total: number) => ({ ok: true, status: 200, json: async () => ({ total, comments: ids.map((id) => ({ id: String(id), created: "2026-10-01T00:00:00.000+0000", body: doc([`CLAIM — Main 1, lane-1a, RP-${id}`]) })) }) }) as Response;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
      return url.includes("startAt=0") ? page([1, 2], 3) : page([3], 3);
    }) as unknown as typeof fetch;
    const comments = await fetchComments("a@b.c", "tok", fetchImpl);
    expect(comments.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain(`Basic ${Buffer.from("a@b.c:tok").toString("base64")}`);
  });
  it("names the status and nothing else when Jira refuses", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401, json: async () => ({ message: "secret detail" }) })) as unknown as typeof fetch;
    await expect(fetchComments("a@b.c", "tok", fetchImpl)).rejects.toThrow("answered 401");
  });
});
