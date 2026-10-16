import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fillRoute, markdownTable, parseArgs, plannedShots, rawUrl, repoSlug, screensBranch, setupApi, shotName, type EvaluatingPage, type Shot } from "./screens.ts";

const at = { root: "/repo", branch: "RP-531-pnpm-screens" };

describe("parseArgs", () => {
  it("takes routes and a person, short name or email, and defaults the folder and out dir from the branch", () => {
    const args = parseArgs(["/work-items/abc", "/home", "--as", "hafiz"], at);
    expect(args.routes).toEqual(["/work-items/abc", "/home"]);
    expect(args.email).toBe("hafiz.hamdan@tmc.demo.rabaed.test");
    expect(args.folder).toBe("RP-531");
    expect(args.out.replace(/\\/g, "/")).toMatch(/\/repo\/\.screens\/RP-531$/);
    expect(args.publish).toBe(false);
    expect(args.setup).toBeUndefined();
    expect(parseArgs(["/", "--as=Hafiz.Hamdan@tmc.demo.rabaed.test"], at).email).toBe("hafiz.hamdan@tmc.demo.rabaed.test");
  });

  it("takes --setup, --folder, --out and --publish", () => {
    const args = parseArgs(["/home", "--as", "ali", "--setup", "s.ts", "--folder=handover", "--out", "shots", "--publish"], at);
    expect(args).toMatchObject({ setup: "s.ts", folder: "handover", out: resolve("shots"), publish: true });
  });

  it("uses the branch name as the folder when it has no issue key", () => {
    expect(parseArgs(["/home", "--as", "ali"], { root: "/repo", branch: "prototype/uat" }).folder).toBe("prototype-uat");
  });

  it("refuses no route, no person, a route with a locale or without a slash, an unknown option, a bare value option", () => {
    expect(() => parseArgs(["--as", "ali"], at)).toThrow(/at least one route/);
    expect(() => parseArgs(["/home"], at)).toThrow(/--as/);
    expect(() => parseArgs(["/en/home", "--as", "ali"], at)).toThrow(/without the locale/);
    expect(() => parseArgs(["home", "--as", "ali"], at)).toThrow(/start with \//);
    expect(() => parseArgs(["/home", "--as", "ali", "--force"], at)).toThrow(/Unknown option --force/);
    expect(() => parseArgs(["/home", "--as"], at)).toThrow(/--as needs/);
    expect(() => parseArgs(["/home", "--as", "nobody"], at)).toThrow(/Unknown short name/);
  });

  it("refuses a folder that is not a plain name", () => {
    expect(() => parseArgs(["/home", "--as", "ali", "--folder", "../x"], at)).toThrow(/--folder/);
  });

  it("does not take the next option as a value", () => {
    expect(() => parseArgs(["/home", "--as", "ali", "--setup", "--publish"], at)).toThrow(/--setup needs/);
  });
});

describe("setupApi", () => {
  /** A page whose fetch answers `status` with `text`, and records each request it was asked to make. */
  function fakePage(status: number, text: string) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const page = {
      evaluate: async (_fn: unknown, arg: { method: string; path: string; body: unknown }) => {
        calls.push(arg);
        return { status, text };
      },
    } as unknown as EvaluatingPage;
    return { page, calls };
  }

  it("takes a Transition confirmed, with a fresh idempotencyKey, and returns the parsed body", async () => {
    const { page, calls } = fakePage(200, '{"ok":true}');
    const api = setupApi(page);
    expect(await api.transition("item-1", "send_for_review", { remarks: "x" })).toEqual({ status: 200, body: { ok: true } });
    await api.transition("item-1", "submit");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/work-items/item-1/transitions", body: { transition: "send_for_review", confirmed: true, remarks: "x" } });
    const keys = calls.map((call) => (call.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("stops with the status and body of a failed call, JSON or not", async () => {
    await expect(setupApi(fakePage(502, "<html>Bad gateway</html>").page).request("GET", "/projects")).rejects.toThrow(/GET \/projects failed with 502: <html>Bad gateway/);
  });

  it("returns a body that is not JSON as text", async () => {
    expect(await setupApi(fakePage(200, "plain").page).request("GET", "/x")).toEqual({ status: 200, body: "plain" });
  });
});

describe("fillRoute", () => {
  it("puts the setup's values into {name} placeholders", () => {
    expect(fillRoute("/work-items/{id}/history", { id: "abc" })).toBe("/work-items/abc/history");
  });

  it("refuses a placeholder the setup did not return", () => {
    expect(() => fillRoute("/work-items/{id}", {})).toThrow(/\{id\}/);
  });
});

describe("shotName", () => {
  it("names a route's shot after its path, width and locale", () => {
    expect(shotName("/work-items/abc", 1366, "en")).toBe("work-items-abc-1366-en.png");
    expect(shotName("/projects/x?tab=team", 1920, "ar")).toBe("projects-x-tab-team-1920-ar.png");
    expect(shotName("/", 1366, "ar")).toBe("home-1366-ar.png");
  });
});

describe("plannedShots", () => {
  it("is every route at 1366 and 1920, in English and Arabic: four per route", () => {
    const shots = plannedShots(["/home"]);
    expect(shots.map((s) => s.file)).toEqual(["home-1366-en.png", "home-1920-en.png", "home-1366-ar.png", "home-1920-ar.png"]);
    expect(plannedShots(["/a", "/b"])).toHaveLength(8);
  });

  it("refuses two routes that would be saved as the same file, and shoots a repeated route once", () => {
    expect(() => plannedShots(["/a-b", "/a/b"])).toThrow(/\/a-b and \/a\/b/);
    expect(plannedShots(["/a", "/a"])).toHaveLength(4);
  });
});

describe("publishing", () => {
  it("is on screens-<branch>", () => {
    expect(screensBranch("RP-531-pnpm-screens")).toBe("screens-RP-531-pnpm-screens");
    expect(screensBranch("prototype/uat")).toBe("screens-prototype-uat");
  });

  it("reads the GitHub repository from an https or ssh remote", () => {
    expect(repoSlug("https://github.com/Rabaed/rabaedV2.0.git")).toBe("Rabaed/rabaedV2.0");
    expect(repoSlug("https://github.com/Rabaed/rabaedV2.0")).toBe("Rabaed/rabaedV2.0");
    expect(repoSlug("git@github.com:Rabaed/rabaedV2.0.git")).toBe("Rabaed/rabaedV2.0");
    expect(() => repoSlug("https://gitlab.com/x/y.git")).toThrow(/GitHub/);
  });

  it("never prints a credential in the remote", () => {
    expect(() => repoSlug("https://bot:s3cr3t-token@gitlab.com/x/y.git")).toThrow(/https:\/\/gitlab\.com\/x\/y\.git/);
    try {
      repoSlug("https://bot:s3cr3t-token@gitlab.com/x/y.git");
    } catch (error) {
      expect(String(error)).not.toContain("s3cr3t-token");
    }
  });

  it("links the raw file at the published commit", () => {
    expect(rawUrl("Rabaed/rabaedV2.0", "c83dd470e", "RP-531/home-1366-en.png")).toBe("https://raw.githubusercontent.com/Rabaed/rabaedV2.0/c83dd470e/RP-531/home-1366-en.png");
  });

  it("prints one row per route and one column per width and locale", () => {
    const shots: Shot[] = plannedShots(["/work-items/abc", "/home"]);
    const table = markdownTable(shots, (file) => `https://x/${file}`);
    expect(table.split("\n")).toEqual([
      "| Page | English 1366 | English 1920 | Arabic 1366 | Arabic 1920 |",
      "|---|---|---|---|---|",
      "| `/work-items/abc` | ![](https://x/work-items-abc-1366-en.png) | ![](https://x/work-items-abc-1920-en.png) | ![](https://x/work-items-abc-1366-ar.png) | ![](https://x/work-items-abc-1920-ar.png) |",
      "| `/home` | ![](https://x/home-1366-en.png) | ![](https://x/home-1920-en.png) | ![](https://x/home-1366-ar.png) | ![](https://x/home-1920-ar.png) |",
    ]);
  });
});
