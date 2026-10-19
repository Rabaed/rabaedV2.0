import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { screens as bulkScreens } from "./screens-examples/packages-bulk.ts";
import { found } from "./screens-examples/packages-seed.ts";
import { screens as submitScreens } from "./screens-examples/packages-submit.ts";
import {
  fillRoute,
  finishAnimations,
  trackRequests,
  unsettledWarning,
  locatorOf,
  markdownTable,
  parseArgs,
  parseScreens,
  plannedShots,
  rawUrl,
  repoSlug,
  runActions,
  screensBranch,
  setupApi,
  shotName,
  type ActionDriver,
  type EvaluatingPage,
  type Shot,
} from "./screens.ts";

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

  it("takes no route with --setup, whose screens may name them", () => {
    expect(parseArgs(["--as", "ali", "--setup", "s.ts"], at).routes).toEqual([]);
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

  it("acts as another demo person through the sign-in it is given", async () => {
    const other = setupApi(fakePage(200, "{}").page);
    const asked: string[] = [];
    const api = setupApi(fakePage(200, "{}").page, async (person) => {
      asked.push(person);
      return other;
    });
    expect(await api.as("hafiz")).toBe(other);
    expect(asked).toEqual(["hafiz"]);
    await expect(setupApi(fakePage(200, "{}").page).as("hafiz")).rejects.toThrow(/as\("hafiz"\)/);
  });

  it("uploads a file as the browser does: start, put to the signed URL, confirm", async () => {
    const calls: unknown[] = [];
    const answers = [
      { status: 201, text: '{"id":"doc-1","upload":{"url":"http://files/x","method":"PUT","headers":{"content-type":"application/pdf"}}}' },
      { status: 200, text: "" },
      { status: 200, text: "{}" },
    ];
    const page = {
      evaluate: async (_fn: unknown, arg: unknown) => {
        calls.push(arg);
        return answers[calls.length - 1];
      },
    } as unknown as EvaluatingPage;
    await setupApi(page).upload("item-1", "datasheet", { fileName: "d.pdf", contentType: "application/pdf", body: Buffer.from("%PDF") });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/work-items/item-1/documents", body: { fieldKey: "datasheet", fileName: "d.pdf", contentType: "application/pdf", sizeBytes: 4 } });
    expect(calls[1]).toEqual({ url: "http://files/x", method: "PUT", headers: { "content-type": "application/pdf" }, base64: Buffer.from("%PDF").toString("base64") });
    expect(calls[2]).toMatchObject({ method: "POST", path: "/work-items/item-1/documents/doc-1/confirm" });
  });

  it("stops when the file store refuses the file", async () => {
    let n = 0;
    const page = {
      evaluate: async () => (n++ === 0 ? { status: 201, text: '{"id":"d","upload":{"url":"http://files/x","method":"PUT","headers":{}}}' } : { status: 403, text: "denied" }),
    } as unknown as EvaluatingPage;
    await expect(setupApi(page).upload("i", "datasheet", { fileName: "d.pdf", contentType: "application/pdf", body: Buffer.from("x") })).rejects.toThrow(
      /file store answered 403 to d\.pdf: denied/,
    );
  });
});

describe("parseScreens", () => {
  const submit = { en: "Submit Package", ar: "تقديم الحزمة" };

  it("reads named screens, each with its actions in the order given", () => {
    const screens = parseScreens(
      [
        { name: "submit-dialog", route: "/packages/{open}", actions: [{ click: "button", name: submit }, { waitFor: "dialog" }] },
        { name: "bulk", route: "/packages/{held}", actions: [{ check: "Corridor luminaires" }, { check: "PKG-001-MAR-002" }, { click: "button", name: "Approve · A" }] },
        { name: "plain", route: "/home" },
      ],
      "setup.ts",
    );
    expect(screens).toEqual([
      { name: "submit-dialog", route: "/packages/{open}", actions: [{ click: "button", name: submit }, { waitFor: "dialog" }] },
      { name: "bulk", route: "/packages/{held}", actions: [{ check: "Corridor luminaires" }, { check: "PKG-001-MAR-002" }, { click: "button", name: "Approve · A" }] },
      { name: "plain", route: "/home", actions: [] },
    ]);
  });

  it("refuses what is not a list of screens, naming the file, the screen and the action", () => {
    expect(() => parseScreens({}, "s.ts")).toThrow(/s\.ts: screens must be a list/);
    expect(() => parseScreens([{ route: "/home" }], "s.ts")).toThrow(/s\.ts: screen 1 needs a name/);
    expect(() => parseScreens([{ name: "../x", route: "/home" }], "s.ts")).toThrow(/screen 1 \("\.\.\/x"\).*plain name/);
    expect(() => parseScreens([{ name: "a", route: "home" }], "s.ts")).toThrow(/screen "a": its route must start with \//);
    expect(() => parseScreens([{ name: "a", route: "/en/home" }], "s.ts")).toThrow(/screen "a".*without the locale/);
    expect(() => parseScreens([{ name: "a", route: "/a" }, { name: "a", route: "/b" }], "s.ts")).toThrow(/two screens named "a"/);
    expect(() => parseScreens([{ name: "a", route: "/a", actions: [{ tap: "x" }] }], "s.ts")).toThrow(/screen "a", action 1: .*click, check or waitFor/);
    expect(() => parseScreens([{ name: "a", route: "/a", actions: [{ click: "button" }] }], "s.ts")).toThrow(/screen "a", action 1: click needs a name/);
    expect(() => parseScreens([{ name: "a", route: "/a", actions: [{ click: "button", name: { en: "Submit" } }] }], "s.ts")).toThrow(
      /screen "a", action 1: .*both en and ar/,
    );
    expect(() => parseScreens([{ name: "a", route: "/a", actions: [{ waitFor: "Dialog" }] }], "s.ts")).toThrow(/screen "a", action 1: "Dialog" is not an ARIA role/);
    expect(() => parseScreens([{ name: "a", route: "/a", actions: [{ check: "" }] }], "s.ts")).toThrow(/screen "a", action 1: check needs the text of its row/);
  });
});

describe("runActions", () => {
  /** A driver that records each call, and fails the one whose description is `failOn`. */
  function fakeDriver(failOn?: string) {
    const calls: string[] = [];
    const record = async (call: string) => {
      calls.push(call);
      if (call === failOn) throw new Error("locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button')");
    };
    const driver: ActionDriver = {
      run: (verb, target) => record(`${verb} ${"row" in target ? target.row : `${target.role}${target.name === undefined ? "" : ` ${target.name}`}`}`),
    };
    return { driver, calls };
  }

  const screen = parseScreens(
    [
      {
        name: "submit-dialog",
        route: "/packages/x",
        actions: [{ check: "PKG-001" }, { click: "button", name: { en: "Submit Package", ar: "تقديم الحزمة" } }, { waitFor: "dialog", name: { en: "Submit PKG-003", ar: "تقديم PKG-003" } }],
      },
    ],
    "s.ts",
  )[0]!;

  it("runs the actions in order, with the names of the page's language", async () => {
    const en = fakeDriver();
    await runActions(en.driver, screen, { locale: "en", width: 1366 });
    expect(en.calls).toEqual(["check PKG-001", "click button Submit Package", "waitFor dialog Submit PKG-003"]);
    const ar = fakeDriver();
    await runActions(ar.driver, screen, { locale: "ar", width: 1920 });
    expect(ar.calls).toEqual(["check PKG-001", "click button تقديم الحزمة", "waitFor dialog تقديم PKG-003"]);
  });

  it("stops at a failed action, naming the screen, the action and its locator, and runs none after it", async () => {
    const { driver, calls } = fakeDriver("click button تقديم الحزمة");
    const failure = runActions(driver, screen, { locale: "ar", width: 1366 });
    await expect(failure).rejects.toThrow(
      'Screen "submit-dialog" (ar, 1366): action 2 of 3, click button "تقديم الحزمة", failed at getByRole("button", { name: "تقديم الحزمة", exact: true }): locator.click: Timeout 10000ms exceeded.',
    );
    expect(calls).toHaveLength(2);
  });

  it("names a row's checkbox by the row's text", async () => {
    const { driver } = fakeDriver("check PKG-001");
    await expect(runActions(driver, screen, { locale: "en", width: 1366 })).rejects.toThrow(
      'Screen "submit-dialog" (en, 1366): action 1 of 3, check the row "PKG-001", failed at getByRole("row").filter({ hasText: "PKG-001" }).getByRole("checkbox"):',
    );
  });

  it("names a wait without a name by its role alone", () => {
    expect(locatorOf({ waitFor: "dialog" }, "en")).toBe('getByRole("dialog")');
  });
});

// Review fix 14 and 17: the wait for a click's requests, its warning, and its listeners.
describe("trackRequests", () => {
  function clocked() {
    let clock = 0;
    const page = new EventEmitter();
    const tracker = trackRequests(page as unknown as Parameters<typeof trackRequests>[0], {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    return { page, tracker, at: () => clock };
  }

  it("settles once no request has been in flight for half a second", async () => {
    const { page, tracker, at } = clocked();
    page.emit("request");
    page.emit("requestfinished");
    expect(await tracker.settle()).toBe(true);
    expect(at()).toBeGreaterThanOrEqual(500);
    expect(at()).toBeLessThan(1_000);
  });

  it("gives up unsettled after 10 s with a request still in flight", async () => {
    const { page, tracker, at } = clocked();
    page.emit("request");
    expect(await tracker.settle()).toBe(false);
    expect(at()).toBeGreaterThanOrEqual(10_000);
  });

  it("removes its listeners when stopped, as when an action throws, and when it settles", async () => {
    const stopped = clocked();
    expect(stopped.page.listenerCount("request")).toBe(1);
    stopped.tracker.stop();
    expect(["request", "requestfinished", "requestfailed"].map((event) => stopped.page.listenerCount(event))).toEqual([0, 0, 0]);
    const settled = clocked();
    await settled.tracker.settle();
    expect(settled.page.listenerCount("requestfinished")).toBe(0);
  });

  it("warns naming the screen, its language and width when it gave up", () => {
    expect(unsettledWarning({ name: "bulk", route: "/packages/p", actions: [] }, { locale: "ar", width: 1920 })).toBe(
      'Warning: screen "bulk" (ar, 1920): requests were still in flight 10 s after its last action; shot anyway.',
    );
  });
});

// Review fix 13: an infinite animation (a spinner) never finishes, and a slow one must not hold the shot.
describe("finishAnimations", () => {
  const animation = (endTime: number, finished: Promise<unknown>) => ({ finished, effect: { getComputedTiming: () => ({ endTime }) } });
  const never = new Promise(() => {});

  it("waits for the finite animations and skips infinite ones", async () => {
    expect(await finishAnimations(1_000, [animation(200, Promise.resolve()), animation(Infinity, never)] as unknown as Animation[])).toBe("done");
  });

  it("stops waiting after its timeout", async () => {
    expect(await finishAnimations(20, [animation(5_000, never)] as unknown as Animation[])).toBe("timed out");
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

  it("saves a named screen under its name, so one route can be shot in several states", () => {
    const dialog = { name: "submit-dialog", route: "/packages/p1", actions: [{ waitFor: "dialog" }] };
    const shots = plannedShots(["/packages/p1", dialog]);
    expect(shots.map((s) => s.file)).toEqual([
      "packages-p1-1366-en.png",
      "packages-p1-1920-en.png",
      "packages-p1-1366-ar.png",
      "packages-p1-1920-ar.png",
      "submit-dialog-1366-en.png",
      "submit-dialog-1920-en.png",
      "submit-dialog-1366-ar.png",
      "submit-dialog-1920-ar.png",
    ]);
    expect(shots[4]).toMatchObject({ route: "/packages/p1", screen: dialog });
    expect(() => plannedShots(["/submit-dialog", dialog])).toThrow('Route /submit-dialog and screen "submit-dialog" would be saved as the same file');
  });

  it("with --phone, is every route at 375 only, in English and Arabic (RP-630)", () => {
    expect(parseArgs(["/home", "--as", "ali"], at).phone).toBe(false);
    expect(parseArgs(["/home", "--as", "ali", "--phone"], at).phone).toBe(true);
    expect(plannedShots(["/home"], { phone: true }).map((s) => s.file)).toEqual(["home-375-en.png", "home-375-ar.png"]);
    expect(markdownTable(plannedShots(["/home"], { phone: true }), (file) => file).split("\n")[0]).toBe("| Page | English 375 | Arabic 375 |");
    expect(plannedShots([{ name: "bulk", route: "/p", actions: [] }], { phone: true }).map((s) => s.file)).toEqual(["bulk-375-en.png", "bulk-375-ar.png"]);
  });

  // Review fix 15: Windows file names ignore case, so /A and /a would overwrite each other.
  it("refuses two names that differ only in case", () => {
    expect(() => plannedShots(["/Packages", "/packages"])).toThrow("Routes /Packages and /packages would be saved as the same file");
    expect(() => plannedShots([{ name: "Bulk", route: "/a", actions: [] }, { name: "bulk", route: "/b", actions: [] }])).toThrow('Screens "Bulk" and "bulk"');
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

  it("names a named screen's row by its name and route", () => {
    const shots = plannedShots([{ name: "bulk", route: "/packages/p1", actions: [] }]);
    expect(markdownTable(shots, (file) => file).split("\n")[2]).toBe("| bulk: `/packages/p1` | ![](bulk-1366-en.png) | ![](bulk-1920-en.png) | ![](bulk-1366-ar.png) | ![](bulk-1920-ar.png) |");
  });
});

describe("the Packages examples (scripts/screens-examples)", () => {
  const root = resolve(import.meta.dirname, "..");
  /** Every { en, ar } pair in a JSON value, at any depth. */
  const pairs = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(pairs);
    if (typeof value !== "object" || value === null) return [];
    const record = value as Record<string, unknown>;
    const own = typeof record.en === "string" && typeof record.ar === "string" ? [`${record.en} | ${record.ar}`] : [];
    return [...own, ...Object.values(record).flatMap(pairs)];
  };
  const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown;
  /** The same key's text in both message files, as one "en | ar" pair each. */
  const messagePairs = (en: unknown, ar: unknown): string[] => {
    if (typeof en === "string" && typeof ar === "string") return [`${en} | ${ar}`];
    if (typeof en !== "object" || en === null || typeof ar !== "object" || ar === null) return [];
    return Object.keys(en).flatMap((key) => messagePairs((en as Record<string, unknown>)[key], (ar as Record<string, unknown>)[key]));
  };

  // Review fix 19: an Arabic name that isn't the app's own fails only in a browser, on the Arabic shot.
  it("names each control with the app's own English and Arabic words: its messages, or a Workflow's labels", () => {
    const known = new Set([
      ...messagePairs(json("apps/web/messages/en.json"), json("apps/web/messages/ar.json")),
      ...readdirSync(resolve(root, "apps/admin/workflows")).flatMap((file) => pairs(json(`apps/admin/workflows/${file}`))),
    ]);
    const names = parseScreens([...submitScreens, ...bulkScreens], "examples").flatMap((screen) =>
      screen.actions.flatMap((action) => ("name" in action && action.name !== undefined && typeof action.name !== "string" ? [`${action.name.en} | ${action.name.ar}`] : [])),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(known.has(name), name).toBe(true);
  });

  // Review fix 18: a demo without the row says which row, not "cannot read properties of undefined".
  it("names the demo row it could not find", () => {
    expect(found({ id: "p1" }, "Project TWR")).toEqual({ id: "p1" });
    expect(() => found(undefined, "Project TWR")).toThrow("The demo has no Project TWR: run the example on a fresh `pnpm demo`.");
  });
});
