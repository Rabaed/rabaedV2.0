import { describe, expect, it } from "vitest";
import { parseArgs, parseDemoPassword, storageState } from "./demo-session.ts";

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

describe("storageState", () => {
  it("makes a Playwright cookie for the web host from the Set-Cookie header", () => {
    const state = storageState(["rabaed_session=tok123; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax"], "http://lane2.localhost:3200");
    expect(state.origins).toEqual([]);
    expect(state.cookies).toEqual([
      { name: "rabaed_session", value: "tok123", domain: "lane2.localhost", path: "/", expires: Date.parse("2026-10-21T07:28:00Z") / 1000, httpOnly: true, secure: false, sameSite: "Lax" },
    ]);
  });
});
