import { mkdirSync, mkdtempSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertUatOutPath,
  assertUatWebUrl,
  demoPeople,
  isLocalhostName,
  loopbackForLocalhost,
  parseArgs,
  parseDemoPassword,
  postJson,
  signInUat,
  storageState,
  uatStateDir,
} from "./demo-session.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outside = mkdtempSync(join(tmpdir(), "rabaed-demo-session-test-"));
afterAll(() => rmSync(outside, { recursive: true, force: true }));

describe("uatStateDir (RP-1199: the UAT session cookie lives outside the repo)", () => {
  it("is %LOCALAPPDATA%\\rabaed\\demo-sessions on Windows, under AppData\\Local of the home when it is unset", () => {
    expect(uatStateDir({ platform: "win32", env: { LOCALAPPDATA: "D:\\Local" }, home: "C:\\Users\\u" })).toBe(join("D:\\Local", "rabaed", "demo-sessions"));
    expect(uatStateDir({ platform: "win32", env: {}, home: "C:\\Users\\u" })).toBe(join("C:\\Users\\u", "AppData", "Local", "rabaed", "demo-sessions"));
  });

  it("is $XDG_STATE_HOME/rabaed/demo-sessions elsewhere, ~/.local/state when it is unset or blank", () => {
    expect(uatStateDir({ platform: "linux", env: { XDG_STATE_HOME: "/x/state" }, home: "/home/u" })).toBe(join("/x/state", "rabaed", "demo-sessions"));
    expect(uatStateDir({ platform: "darwin", env: {}, home: "/Users/u" })).toBe(join("/Users/u", ".local", "state", "rabaed", "demo-sessions"));
    expect(uatStateDir({ platform: "linux", env: { XDG_STATE_HOME: "  " }, home: "/home/u" })).toBe(join("/home/u", ".local", "state", "rabaed", "demo-sessions"));
  });
});

describe("assertUatOutPath (RP-1199: --uat never writes inside a git checkout)", () => {
  it("accepts a path outside every checkout and returns it resolved", () => {
    const out = join(outside, "deep", "hafiz.uat.json");
    expect(assertUatOutPath(out)).toBe(out);
  });

  it.each([
    ["an absolute path in the repo", join(repoRoot, "hafiz.uat.json")],
    ["the old .demo-sessions folder", join(repoRoot, ".demo-sessions", "hafiz.uat.json")],
    ["a relative path (the working folder is the repo)", "hafiz.uat.json"],
    ["a .. path that comes back into the repo", join(repoRoot, "scripts", "..", "hafiz.uat.json")],
    ["a relative .. path that comes back into the repo", join("..", basename(repoRoot.replace(/[\\/]+$/, "")), "hafiz.uat.json")],
  ])("refuses %s", (_what, out) => {
    expect(() => assertUatOutPath(out)).toThrow(/--uat won't write the session cookie inside a git checkout/);
  });

  it("refuses a path through a link that leads into the repo", () => {
    const target = join(repoRoot, "node_modules", `.uat-out-target-${process.pid}`);
    const link = join(outside, "link");
    mkdirSync(target, { recursive: true });
    try {
      try {
        symlinkSync(target, link, "junction");
      } catch {
        return; // This machine allows no links: the other cases still hold.
      }
      try {
        expect(() => assertUatOutPath(join(link, "hafiz.uat.json"))).toThrow(/inside a git checkout/);
      } finally {
        unlinkSync(link);
      }
    } finally {
      rmdirSync(target);
    }
  });
});

describe("signInUat (RP-1199)", () => {
  const FAKE = "fake-uat-password";
  const email = demoPeople.saeed!;
  const ok = { status: 204, setCookies: ["rabaed_session=tok123; Path=/; HttpOnly; Secure; SameSite=Lax"] };

  type Post = (url: string, body: unknown) => Promise<{ status: number; setCookies: string[] }>;
  const recorder = (answer: { status: number; setCookies: string[] } | Error) => {
    const calls: { url: string; body: unknown }[] = [];
    const post: Post = async (url, body) => {
      calls.push({ url, body });
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { calls, post };
  };
  /** Runs signInUat and returns what it threw, or the state; nothing else may carry the password out. */
  const run = async (env: Record<string, string | undefined>, post: Post, webUrl?: string) => {
    const logged: string[] = [];
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((name) => {
      const original = console[name];
      console[name] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
      return () => (console[name] = original);
    });
    try {
      const state = await signInUat(email, { env, postJson: post, ...(webUrl ? { webUrl } : {}) });
      return { state, error: undefined as Error | undefined, logged };
    } catch (error) {
      return { state: undefined, error: error as Error, logged };
    } finally {
      for (const restore of spies) restore();
    }
  };

  it("posts the email and the password from UAT_DEMO_PASSWORD to the UAT web /api/v1/session and returns the storage state", async () => {
    const { calls, post } = recorder(ok);
    const result = await run({ UAT_DEMO_PASSWORD: FAKE }, post);
    expect(calls).toEqual([{ url: "https://rabaed-uat-web.vercel.app/api/v1/session", body: { email, password: FAKE } }]);
    expect(result.state?.cookies).toEqual([
      { name: "rabaed_session", value: "tok123", domain: "rabaed-uat-web.vercel.app", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    expect(JSON.stringify(result)).not.toContain(FAKE);
  });

  it("ignores WEB_URL and reads no other variable for the password", async () => {
    const { calls, post } = recorder(ok);
    await run({ UAT_DEMO_PASSWORD: FAKE, WEB_URL: "http://127.0.0.1:3000", DEMO_PASSWORD: "other" }, post);
    expect(calls.map((call) => call.url)).toEqual(["https://rabaed-uat-web.vercel.app/api/v1/session"]);
    expect((calls[0]!.body as { password: string }).password).toBe(FAKE);
  });

  it.each([undefined, "", "   "])("names only the variable when UAT_DEMO_PASSWORD is %j, and makes no request", async (value) => {
    const { calls, post } = recorder(ok);
    const result = await run({ UAT_DEMO_PASSWORD: value }, post);
    expect(result.error?.message).toMatch(/UAT_DEMO_PASSWORD is not set/);
    expect(calls).toEqual([]);
  });

  it.each([demoPeople.saeed!, "someone@betabuild.demo.rabaed.test", "a.b@x.y.demo.rabaed.test"])("signs in the demo Member %s", async (member) => {
    const { calls, post } = recorder(ok);
    const result = await signInUat(member, { env: { UAT_DEMO_PASSWORD: FAKE }, postJson: post });
    expect(result.cookies).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it.each([
    "mohamed.alhalees@rabaedapp.com",
    "someone@gmail.com",
    "saeed.alqahtani@tmc.demo.rabaed.test.evil.test",
    "saeed.alqahtani@demo.rabaed.test",
    "saeed.alqahtani@evil.test@tmc.demo.rabaed.test",
    "saeed.alqahtani",
    "",
  ])("refuses %j, which is not a demo Member, before reading the password or posting", async (notDemo) => {
    const { calls, post } = recorder(ok);
    const error = await signInUat(notDemo, { env: { UAT_DEMO_PASSWORD: FAKE }, postJson: post }).then(
      () => undefined,
      (caught: Error) => caught,
    );
    expect(error?.message).toMatch(/--uat signs in as a demo Member only: the email must end in \.demo\.rabaed\.test/);
    expect(error?.message).not.toContain(FAKE);
    expect(calls).toEqual([]);
  });

  it("refuses an --out inside a git checkout before reading the password or posting, and accepts one outside", async () => {
    const { calls, post } = recorder(ok);
    const env = { UAT_DEMO_PASSWORD: FAKE };
    const refused = await signInUat(email, { env, postJson: post, out: join(repoRoot, "hafiz.uat.json") }).then(
      () => undefined,
      (caught: Error) => caught,
    );
    expect(refused?.message).toMatch(/inside a git checkout/);
    expect(refused?.message).not.toContain(FAKE);
    // Blank password too: the --out refusal comes first.
    const first = await signInUat(email, { env: {}, postJson: post, out: "hafiz.uat.json" }).then(
      () => undefined,
      (caught: Error) => caught,
    );
    expect(first?.message).toMatch(/inside a git checkout/);
    expect(calls).toEqual([]);
    await signInUat(email, { env, postJson: post, out: join(outside, "hafiz.uat.json") });
    expect(calls).toHaveLength(1);
  });

  it("checks the host, then the email, then --out, then the password", async () => {
    const { calls, post } = recorder(ok);
    const inRepo = join(repoRoot, "x.json");
    const message = async (who: string, options: { webUrl?: string }) =>
      (await signInUat(who, { env: {}, postJson: post, out: inRepo, ...options }).then(() => undefined, (caught: Error) => caught))?.message;
    expect(await message("someone@gmail.com", { webUrl: "https://app.rabaed.com" })).toMatch(/production/);
    expect(await message("someone@gmail.com", {})).toMatch(/demo Member only/);
    expect(await message(email, {})).toMatch(/inside a git checkout/);
    expect(calls).toEqual([]);
  });

  it("refuses another host before reading the password or posting", async () => {
    const { calls, post } = recorder(ok);
    for (const webUrl of ["https://app.rabaed.com", "https://rabaed-uat-web.vercel.app.evil.test", "http://localhost:3000"]) {
      const result = await run({ UAT_DEMO_PASSWORD: FAKE }, post, webUrl);
      expect(result.error?.message).toMatch(/--uat signs in to the UAT web host only/);
      expect(JSON.stringify(result)).not.toContain(FAKE);
    }
    expect(calls).toEqual([]);
  });

  it("reports the status only for a refused sign-in, with no password and no body", async () => {
    for (const status of [401, 403, 500]) {
      const { post } = recorder({ status, setCookies: [] });
      const result = await run({ UAT_DEMO_PASSWORD: FAKE }, post);
      expect(result.error?.message).toContain(String(status));
      expect(JSON.stringify(result)).not.toContain(FAKE);
    }
  });

  it("says a 401 may mean the wrong password without printing it", async () => {
    const { post } = recorder({ status: 401, setCookies: [] });
    const result = await run({ UAT_DEMO_PASSWORD: FAKE }, post);
    expect(result.error?.message).toMatch(/UAT_DEMO_PASSWORD/);
    expect(result.error?.message).not.toContain(FAKE);
  });

  it("does not carry the password out in an unreachable-host error, even when the transport error holds it", async () => {
    const { post } = recorder(new Error(`connect failed, body was {"password":"${FAKE}"}`));
    const result = await run({ UAT_DEMO_PASSWORD: FAKE }, post);
    expect(result.error?.message).toMatch(/Could not reach https:\/\/rabaed-uat-web\.vercel\.app/);
    expect(JSON.stringify(result)).not.toContain(FAKE);
  });

  it("fails plainly when sign-in sets no cookie, without the password", async () => {
    const { post } = recorder({ status: 204, setCookies: [] });
    const result = await run({ UAT_DEMO_PASSWORD: FAKE }, post);
    expect(result.error?.message).toMatch(/no session cookie/);
    expect(JSON.stringify(result)).not.toContain(FAKE);
  });
});

describe("assertUatWebUrl (RP-1199: --uat signs in to the UAT web host only)", () => {
  it.each(["https://rabaed-uat-web.vercel.app", "https://rabaed-uat-web.vercel.app/", "https://RABAED-UAT-WEB.vercel.app", "https://rabaed-uat-web.vercel.app:443"])(
    "accepts %s and returns the plain origin",
    (url) => {
      expect(assertUatWebUrl(url)).toBe("https://rabaed-uat-web.vercel.app");
    },
  );

  it.each([
    ["http://rabaed-uat-web.vercel.app", "plain http"],
    ["https://rabaed-uat-web.vercel.app.evil.test", "a look-alike with a longer host"],
    ["https://evil.test/rabaed-uat-web.vercel.app", "the UAT host only in the path"],
    ["https://evil.test?rabaed-uat-web.vercel.app", "the UAT host only in the query"],
    ["https://rabaed-uat-web.vercel.app@evil.test", "userinfo that names the UAT host"],
    ["https://evil.test@rabaed-uat-web.vercel.app", "userinfo in front of the UAT host"],
    ["https://user:secret@rabaed-uat-web.vercel.app", "userinfo with a password"],
    ["https://evil-rabaed-uat-web.vercel.app", "a prefixed look-alike"],
    ["https://rabaed-uat-web.vercel.app.", "a trailing dot"],
    ["https://rabaed-uat-web.vercel.app:8443", "another port"],
    ["https://rabaed-uat-web.vercel.app/en/sign-in", "a path"],
    ["https://rabaed-uat-web.vercel.app/?next=x", "a query"],
    ["https://rabaed-uat-admin.vercel.app", "the UAT admin host"],
    ["https://rabaed-uat.vercel.app", "another UAT project"],
    ["http://localhost:3000", "localhost"],
    ["http://127.0.0.1:3000", "loopback"],
    ["http://lane2.localhost:3200", "a lane host"],
    ["rabaed-uat-web.vercel.app", "no scheme"],
    ["", "nothing"],
    ["https://rabaed-prod-web.vercel.app", "any other Vercel project: the allowlist is exact"],
  ])("refuses %s (%s) with the one reason", (url) => {
    expect(() => assertUatWebUrl(url)).toThrow(/--uat signs in to the UAT web host only/);
  });

  it.each(["https://app.rabaed.com", "https://rabaed.com", "https://www.rabaed.com", "https://rabaedapp.com", "https://app.rabaedapp.com"])(
    "refuses production %s by name, saying so",
    (url) => {
      expect(() => assertUatWebUrl(url)).toThrow(/production/);
      expect(() => assertUatWebUrl(url)).toThrow(/--uat signs in to the UAT web host only/);
    },
  );

  it("does not call another host production", () => {
    expect(() => assertUatWebUrl("https://rabaed-prod-web.vercel.app")).not.toThrow(/production/);
    expect(() => assertUatWebUrl("https://evil.test")).not.toThrow(/production/);
  });

  it("never repeats userinfo from the refused URL", () => {
    for (const url of ["https://user:fake-uat-password@evil.test", "https://user:fake-uat-password@rabaed-uat-web.vercel.app", "not a url fake-uat-password"]) {
      expect(() => assertUatWebUrl(url)).toThrow();
      try {
        assertUatWebUrl(url);
      } catch (error) {
        expect((error as Error).message).not.toContain("fake-uat-password");
      }
    }
  });
});

describe("parseArgs", () => {
  it("turns a short name into the demo email", () => {
    const args = parseArgs(["hafiz"]);
    expect(args.email).toBe("hafiz.hamdan@tmc.demo.rabaed.test");
    expect(args.out.replace(/\\/g, "/")).toMatch(/\/\.demo-sessions\/hafiz\.json$/);
  });

  it("takes a full email as it is, lowercased", () => {
    expect(parseArgs(["Nasser.AlDosari@betabuild.demo.rabaed.test"]).email).toBe("nasser.aldosari@betabuild.demo.rabaed.test");
  });

  it("takes --out in either form", () => {
    expect(parseArgs(["ali", "--out", "x.json"]).out).toBe("x.json");
    expect(parseArgs(["--out=y.json", "ali"]).out).toBe("y.json");
  });

  it("takes --uat as a switch, before or after the person, and writes <short>.uat.json outside the repo, in the user's state folder", () => {
    expect(parseArgs(["hafiz"]).uat).toBe(false);
    const where = { platform: "win32" as const, env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, home: "C:\\Users\\u" };
    for (const argv of [["--uat", "hafiz"], ["hafiz", "--uat"]]) {
      const args = parseArgs(argv, where);
      expect(args.uat).toBe(true);
      expect(args.email).toBe("hafiz.hamdan@tmc.demo.rabaed.test");
      expect(args.out).toBe(join(where.env.LOCALAPPDATA, "rabaed", "demo-sessions", "hafiz.uat.json"));
    }
    expect(parseArgs(["--uat", "ali", "--out", "x.json"], where)).toMatchObject({ uat: true, out: "x.json" });
    // The local mode keeps its place under the repo.
    expect(parseArgs(["hafiz"], where).out.replace(/\\/g, "/")).toMatch(/\/\.demo-sessions\/hafiz\.json$/);
  });

  it("puts the real default --uat file in no git checkout", () => {
    const out = parseArgs(["--uat", "hafiz"]).out;
    expect(out).toMatch(/hafiz\.uat\.json$/);
    expect(() => assertUatOutPath(out)).not.toThrow();
  });

  it("refuses no person, two people, an unknown name, an unknown option, a bare --out", () => {
    expect(() => parseArgs([])).toThrow(/Name a person/);
    expect(() => parseArgs(["ali", "omar"])).toThrow(/one person/);
    expect(() => parseArgs(["nobody"])).toThrow(/Unknown short name/);
    expect(() => parseArgs(["ali", "--force"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["ali", "--out"])).toThrow(/--out needs/);
  });
});

describe("parseDemoPassword", () => {
  it("reads the DEMO_PASSWORD line and ignores comments", () => {
    expect(parseDemoPassword("# note\nDEMO_PASSWORD=demo-abc\n")).toBe("demo-abc");
    expect(parseDemoPassword("# nothing here\n")).toBeUndefined();
  });
});

describe("isLocalhostName", () => {
  it("is true for localhost and names under it, false for anything else", () => {
    expect(isLocalhostName("localhost")).toBe(true);
    expect(isLocalhostName("lane2.localhost")).toBe(true);
    expect(isLocalhostName("Lane2.LOCALHOST.")).toBe(true);
    expect(isLocalhostName("127.0.0.1")).toBe(false);
    expect(isLocalhostName("notlocalhost")).toBe(false);
    expect(isLocalhostName("lane2.localhost.example.com")).toBe(false);
  });
});

describe("loopbackForLocalhost", () => {
  it("answers 127.0.0.1 for a lane host, in both the single and the all form", async () => {
    const one = await new Promise((done) => loopbackForLocalhost("lane2.localhost", {}, (_error, address, family) => done({ address, family })));
    expect(one).toEqual({ address: "127.0.0.1", family: 4 });
    const all = await new Promise((done) => loopbackForLocalhost("lane2.localhost", { all: true }, (_error, addresses) => done(addresses)));
    expect(all).toEqual([{ address: "127.0.0.1", family: 4 }]);
  });
});

describe("postJson", () => {
  it("reaches laneN.localhost on loopback and sends the lane host as Host", async () => {
    let seenHost: string | undefined;
    let seenBody = "";
    const server = createServer((req, res) => {
      seenHost = req.headers.host;
      req.on("data", (chunk: Buffer) => (seenBody += chunk.toString()));
      req.on("end", () => {
        res.writeHead(204, { "set-cookie": ["rabaed_session=tok123; Path=/; HttpOnly"] });
        res.end();
      });
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await postJson(`http://lane9.localhost:${port}/api/v1/session`, { email: "ali" });
      expect(response).toEqual({ status: 204, setCookies: ["rabaed_session=tok123; Path=/; HttpOnly"] });
      expect(seenHost).toBe(`lane9.localhost:${port}`);
      expect(JSON.parse(seenBody)).toEqual({ email: "ali" });
    } finally {
      server.close();
    }
  });
});

describe("storageState", () => {
  it("makes a Playwright cookie for the web host from the Set-Cookie header", () => {
    const state = storageState(["rabaed_session=tok123; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax"], "http://lane2.localhost:3200");
    expect(state.origins).toEqual([]);
    expect(state.cookies).toEqual([
      { name: "rabaed_session", value: "tok123", domain: "lane2.localhost", path: "/", expires: Date.parse("2026-10-21T07:28:00Z") / 1000, httpOnly: true, secure: false, sameSite: "Lax" },
    ]);
  });
});
