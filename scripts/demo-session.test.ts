import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { isLocalhostName, loopbackForLocalhost, parseArgs, parseDemoPassword, postJson, storageState } from "./demo-session.ts";

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
