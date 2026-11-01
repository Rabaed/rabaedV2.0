import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { assertUatWebUrl, isLocalhostName, loopbackForLocalhost, parseArgs, parseDemoPassword, postJson, signInUat, storageState } from "./demo-session.ts";

describe("signInUat (RP-1199)", () => {
  const FAKE = "fake-uat-password";
  const email = "saeed.alqahtani@tmc.demo.rabaed.test";
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
  ])("refuses %s (%s) with the one reason", (url) => {
    expect(() => assertUatWebUrl(url)).toThrow(/--uat signs in to the UAT web host only/);
  });

  it.each(["https://app.rabaed.com", "https://rabaed.com", "https://www.rabaed.com", "https://rabaedapp.com", "https://app.rabaedapp.com", "https://rabaed-prod-web.vercel.app"])(
    "refuses production %s by name, saying so",
    (url) => {
      expect(() => assertUatWebUrl(url)).toThrow(/production/);
      expect(() => assertUatWebUrl(url)).toThrow(/--uat signs in to the UAT web host only/);
    },
  );

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

  it("takes --uat as a switch, before or after the person, and keeps the same --out default", () => {
    expect(parseArgs(["hafiz"]).uat).toBe(false);
    for (const argv of [["--uat", "hafiz"], ["hafiz", "--uat"]]) {
      const args = parseArgs(argv);
      expect(args.uat).toBe(true);
      expect(args.email).toBe("hafiz.hamdan@tmc.demo.rabaed.test");
      expect(args.out.replace(/\\/g, "/")).toMatch(/\/\.demo-sessions\/hafiz\.json$/);
    }
    expect(parseArgs(["--uat", "ali", "--out", "x.json"])).toMatchObject({ uat: true, out: "x.json" });
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
