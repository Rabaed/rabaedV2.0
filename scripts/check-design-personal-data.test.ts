import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Allow, formatFinding, loadAllow, scanDesignFile, scanText } from "./check-design-personal-data.ts";
import { claudeDesignExport, nestedPage } from "./claude-design-export.fixtures.ts";

// RP-1168: design/** is public and a Claude Design export can carry real people's
// emails and phone numbers (RP-579 caught two by luck). Every person, number and
// address below is made up; the ID numbers are built at run time from a made-up
// prefix, so this file holds no working identifier.

const here = import.meta.dirname;
const noAllow: Allow = { emailDomains: [], values: [], files: [] };
const kinds = (text: string, allow: Allow = noAllow) => scanText("design/x.html", text, allow).map((finding) => finding.kind);

/** A Luhn check digit appended to a made-up nine-digit prefix: the shape of a Saudi national ID or Iqama number. */
function withCheckDigit(prefix: string): string {
  let sum = 0;
  [...prefix].reverse().forEach((char, index) => {
    let digit = Number(char);
    if (index % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  });
  return prefix + String((10 - (sum % 10)) % 10);
}
const nationalId = withCheckDigit("109876543");
const iqama = withCheckDigit("234567891");
const card = withCheckDigit("453914880343646").replace(/(\d{4})(?=\d)/g, "$1 ");
const notACard = card.slice(0, -1) + String((Number(card.at(-1)) + 1) % 10);
const notAnId = nationalId.slice(0, 9) + String((Number(nationalId[9]) + 1) % 10);

describe("emails", () => {
  it("refuses an address on a real mail domain", () => {
    expect(kinds("<td>jane.doe@gmail.com</td>")).toEqual(["email"]);
    expect(kinds("mailto:Omar.Test+site@corp-mail.sa")).toEqual(["email"]);
  });

  it("lets the reserved placeholder domains through", () => {
    const allow = loadAllow();
    expect(kinds("a@example.com b@mail.example.org c@example.net d@rabaed.test e@x.invalid f@host.localhost", allow)).toEqual([]);
  });

  it("is not fooled by a lookalike of a placeholder domain", () => {
    const allow = loadAllow();
    expect(kinds("jane@notexample.com", allow)).toEqual(["email"]);
    expect(kinds("jane@example.com.evil.io", allow)).toEqual(["email"]);
  });

  it("does not take asset names, scopes, versions or at-rules for an address", () => {
    expect(kinds('<img src="logo@2x.png"> import "@fontsource/inter"; @media (min-width: 600px) {} pkg@1.2.3 sprite@3x.webp')).toEqual([]);
  });

  it("finds an address hidden by an escape", () => {
    expect(kinds("jane.doe\\u0040gmail.com")).toEqual(["email"]);
    expect(kinds("jane.doe&#64;gmail.com")).toEqual(["email"]);
    expect(kinds("jane.doe&#x40;gmail.com")).toEqual(["email"]);
    expect(kinds("jane.doe%40gmail.com")).toEqual(["email"]);
  });

  it("is not evaded by a file extension after the domain", () => {
    expect(kinds("jane.doe@gmail.com.png")).toEqual(["email"]);
  });
});

describe("phone numbers", () => {
  it.each([
    "+966 55 123 4567",
    "+966-55-123-4567",
    "+966 (0)55 123 4567",
    "00966551234567",
    "0551234567",
    "055 123 4567",
    "055-123-4567",
    "(055) 123 4567",
    "966 55 123 4567",
    "011 555 1234", // a Riyadh landline
    "+44 20 7946 0958",
    "+1 (202) 555-0143",
  ])("refuses %s", (phone) => {
    expect(kinds(`<span>Call ${phone} now</span>`)).toEqual(["phone"]);
  });

  it("reads Arabic-Indic digits too", () => {
    const arabic = "٠٥٥١٢٣٤٥٦٧";
    expect(kinds(`<span>${arabic}</span>`)).toEqual(["phone"]);
    expect(kinds("<span>۰۵۵۱۲۳۴۵۶۷</span>")).toEqual(["phone"]);
  });

  it("finds a number whose digits are escaped", () => {
    expect(kinds("&#48;&#53;&#53;1234567")).toEqual(["phone"]);
    expect(kinds("\\u0030551234567")).toEqual(["phone"]);
  });

  it("lets an obvious placeholder through", () => {
    expect(kinds("050 000 0000, +966 50 000 0000, 0555555555, +1 555 000 0000")).toEqual([]);
  });

  it("leaves ordinary numbers alone", () => {
    expect(kinds("width: 1366px; opacity: 0.05; --z: 100; v1.2.3; 2026-10-31; 10:30; 1,250,000.50; id=0x7f3a2b; rgba(5, 150, 105, .4)")).toEqual([]);
    expect(kinds("abc0551234567 and 0.0551234567")).toEqual([]);
  });
});

describe("national IDs, Iqama numbers and other identifiers", () => {
  it("refuses a ten-digit number with a valid ID check digit, starting 1 (citizen) or 2 (resident)", () => {
    expect(kinds(`<td>${nationalId}</td>`)).toEqual(["national-id"]);
    expect(kinds(`<td>${iqama}</td>`)).toEqual(["national-id"]);
    expect(kinds(`<td>${nationalId.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)))}</td>`)).toEqual(["national-id"]);
  });

  it("lets through a ten-digit number that is no ID, or part of a longer one", () => {
    expect(kinds(`<td>${notAnId}</td>`)).toEqual([]);
    expect(kinds(`<td>9${nationalId}</td>`)).toEqual([]);
    expect(kinds(`<td>${nationalId}9</td>`)).toEqual([]);
    expect(kinds(`<td>v${nationalId} ${nationalId}.5 #${nationalId}</td>`.replace("#", "x"))).toEqual([]);
  });

  it("lets a number inside a list of numbers through (a lookup table), but not one in a row of text", () => {
    expect(kinds(`[5,${nationalId},7,9]`)).toEqual([]);
    expect(kinds(`${nationalId}, 5, 7`)).toEqual([]);
    expect(kinds(`name,${nationalId},site`)).toEqual(["national-id"]);
  });

  it("lets an obvious placeholder through", () => {
    expect(kinds(`${withCheckDigit("100000000")} ${withCheckDigit("211111111")}`)).toEqual([]);
  });

  it("refuses a Commercial Registration number named as one", () => {
    expect(kinds("<td>CR No. 4030123456</td>")).toEqual(["commercial-registration"]);
    expect(kinds("<td>Commercial Registration: 1010123456</td>")).toEqual(["commercial-registration"]);
    expect(kinds('{"cr": "1010123456"}')).toEqual(["commercial-registration"]);
    expect(kinds("<td>السجل التجاري 2050123456</td>")).toEqual(["commercial-registration"]);
    expect(kinds("<td>سجل تجاري: ٤٠٣٠١٢٣٤٥٦</td>")).toEqual(["commercial-registration"]);
  });

  it("does not take an unlabelled ten-digit number, or the word 'cr' inside another, for a CR number", () => {
    expect(kinds("<td>4030123456</td> <td>score 4030123456</td> <td>acre 4030123456</td>".replace("4030123456", notAnId.replace(/^1/, "4")))).toEqual([]);
  });

  it("refuses a VAT registration number (fifteen digits, 3 first and last)", () => {
    expect(kinds("<td>VAT 310987654300003</td>")).toEqual(["vat-number"]);
    expect(kinds("<td>VAT 300000000000003</td>")).toEqual([]);
  });

  it("refuses an IBAN", () => {
    expect(kinds("<td>SA44 2000 0101 2345 6789 1234</td>")).toEqual(["iban"]);
    expect(kinds("<td>SA4420000101234567891234</td>")).toEqual(["iban"]);
  });

  it("refuses a payment card number", () => {
    expect(kinds(`<td>${card}</td>`)).toEqual(["payment-card"]);
    expect(kinds(`<td>${card.replaceAll(" ", "-")}</td>`)).toEqual(["payment-card"]);
    expect(kinds(`<td>${notACard}</td>`)).toEqual([]);
  });
});

describe("the allow list", () => {
  it("lets a listed value through, matched by its digits or its address", () => {
    const allow: Allow = {
      emailDomains: [],
      values: [
        { kind: "phone", value: "0551234567", reason: "The kit's sample contact; no one's number." },
        { kind: "email", value: "Jane.Doe@gmail.com", reason: "Made-up sample." },
      ],
      files: [],
    };
    expect(kinds("055 123 4567 +966 55 123 4567 jane.doe@gmail.com", allow)).toEqual([]);
    expect(kinds("055 123 4568 omar@gmail.com", allow)).toEqual(["email", "phone"]);
  });

  it("lets a listed file's kinds through, and no other file's", () => {
    const allow: Allow = { emailDomains: [], values: [], files: [{ path: "design/x.html", kinds: ["email"], reason: "A page about email parsing." }] };
    expect(kinds("jane@gmail.com 0551234567", allow)).toEqual(["phone"]);
    expect(scanText("design/y.html", "jane@gmail.com", allow).map((finding) => finding.kind)).toEqual(["email"]);
  });

  it("lets a listed folder's kinds through", () => {
    const allow: Allow = { emailDomains: [], values: [], files: [{ path: "design/reference/old/", kinds: ["email"], reason: "Old export, owner checked." }] };
    expect(scanText("design/reference/old/a/b.html", "jane@gmail.com", allow)).toEqual([]);
    expect(scanText("design/reference/older.html", "jane@gmail.com", allow)).toHaveLength(1);
  });

  it("refuses a bare public top-level domain", () => {
    const dir = mkdtempSync(join(tmpdir(), "rabaed-allow-"));
    try {
      const file = join(dir, "allow.json");
      writeFileSync(file, JSON.stringify({ emailDomains: [{ domain: "com", reason: "Everything on .com is fine." }], values: [], files: [] }));
      expect(() => loadAllow(file)).toThrow(/top-level domain/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an entry without a reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "rabaed-allow-"));
    try {
      const file = join(dir, "allow.json");
      const cases: object[] = [
        { emailDomains: [{ domain: "example.com" }], values: [], files: [] },
        { emailDomains: [], values: [{ kind: "phone", value: "0500000000", reason: " " }], files: [] },
        { emailDomains: [], values: [], files: [{ path: "design/a.html", kinds: ["email"] }] },
        { emailDomains: [], values: [{ kind: "nonsense", value: "x", reason: "why" }], files: [] },
      ];
      for (const allow of cases) {
        writeFileSync(file, JSON.stringify(allow));
        expect(() => loadAllow(file)).toThrow(/reason|kind/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the committed list gives a reason for every entry", () => {
    const allow = loadAllow();
    expect(allow.emailDomains.map((entry) => entry.domain)).toEqual(expect.arrayContaining(["example.com", "example.org", "example.net", "test", "invalid", "localhost"]));
    for (const entry of [...allow.emailDomains, ...allow.values, ...allow.files]) expect(entry.reason.trim().length).toBeGreaterThan(10);
  });
});

describe("Claude Design exports", () => {
  const exportWith = (entries: Record<string, ReturnType<typeof nestedPage>>) => claudeDesignExport(entries);
  const scan = (text: string) => scanDesignFile("design/reference/Board.html", text, loadAllow());

  it("finds an address in the export's own text, with its line", () => {
    const page = `<html>\n<body>\n<p>Owner: jane.doe@gmail.com</p>\n</body></html>\n`;
    expect(scan(page)).toEqual([{ file: "design/reference/Board.html", line: 3, kind: "email" }]);
  });

  it("decodes a gzipped page nested in the manifest, and one nested in that", () => {
    const inner = exportWith({ "inner-uuid": nestedPage("<p>Call 055 123 4567</p>") });
    const outer = exportWith({ "outer-uuid": nestedPage(inner), "plain-uuid": nestedPage("<p>jane.doe@gmail.com</p>", false) });
    const findings = scan(outer);
    expect(findings.map((finding) => finding.kind).sort()).toEqual(["email", "phone"]);
    expect(findings.map((finding) => finding.nested).sort()).toEqual(["outer-uuid > inner-uuid", "plain-uuid"]);
    expect(findings.every((finding) => finding.line >= 1)).toBe(true);
  });

  it("reads a JSON or script asset in the manifest, not only the pages", () => {
    const json = { mime: "application/json", data: Buffer.from('{"owner":"jane.doe@gmail.com"}').toString("base64") };
    expect(scan(claudeDesignExport({ "json-uuid": json }))).toEqual([expect.objectContaining({ kind: "email", nested: "json-uuid" })]);
  });

  it("leaves an image asset alone", () => {
    const image = { mime: "image/png", data: Buffer.from("jane.doe@gmail.com 0551234567").toString("base64") };
    expect(scan(claudeDesignExport({ "image-uuid": image }))).toEqual([]);
  });

  it("passes an export whose nested pages hold placeholders only", () => {
    expect(scan(exportWith({ "a-uuid": nestedPage("<p>sara@example.com, 050 000 0000</p>") }))).toEqual([]);
  });

  it("names a nested page that cannot be decoded: it cannot be shown to hold none", () => {
    const broken = { mime: "text/html", compressed: true, data: Buffer.from("not gzip").toString("base64") };
    expect(scan(exportWith({ "broken-uuid": broken }))).toEqual([expect.objectContaining({ kind: "undecodable-nested-page", nested: "broken-uuid" })]);
  });

  it("reads no binary file", () => {
    expect(scanDesignFile("design/a.png", "jane.doe@gmail.com\0\0", loadAllow())).toEqual([]);
  });
});

describe("a finding's line", () => {
  it("names the file, line and kind and never the value", () => {
    const [finding] = scanText("design/a.html", "x\ny jane.doe@gmail.com", noAllow);
    const line = formatFinding(finding!);
    expect(line).toContain("design/a.html:2");
    expect(line).toContain("email");
    expect(line).not.toContain("jane");
  });
});

// The scripts run by git itself in a throwaway repository.
describe("node scripts/check-design-personal-data.ts", () => {
  let repo: string;
  const author = ["-c", "user.name=test", "-c", "user.email=test@example.com"];
  const git = (...args: string[]) => execFileSync("git", [...author, ...args], { cwd: repo, encoding: "utf8" });
  const write = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(repo, path, ".."), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
  };
  const run = (...args: string[]) => spawnSync("node", [join(repo, "scripts", "check-design-personal-data.ts"), ...args], { cwd: repo, encoding: "utf8" });
  const output = (result: { stdout: string; stderr: string }) => result.stdout + result.stderr;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-design-pii-"));
    git("init", "-q", "-b", "main");
    mkdirSync(join(repo, "scripts"));
    for (const file of ["check-design-personal-data.ts", "check-no-fonts.ts", "design-personal-data-allow.json"]) copyFileSync(join(here, file), join(repo, "scripts", file));
    write({ "README.md": "# repo\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "start");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("--staged refuses a staged design page with a real-looking email, naming the file and line only", () => {
    write({ "design/reference/page.html": "<p>hi</p>\n<p>jane.doe@gmail.com</p>\n" });
    git("add", "-A");
    const result = run("--staged");
    expect(result.status).toBe(1);
    expect(output(result)).toContain("design/reference/page.html:2: email");
    expect(output(result)).not.toContain("jane.doe");
  });

  it("--staged passes a placeholder, and a file outside design/", () => {
    write({ "design/reference/page.html": "<p>sara@example.com 050 000 0000</p>\n", "docs/notes.md": "jane.doe@gmail.com\n" });
    git("add", "-A");
    const result = run("--staged");
    expect(result.status).toBe(0);
    expect(output(result)).toContain("No personal data");
  });

  it("--staged reads the staged version, not the working copy", () => {
    write({ "design/page.html": "<p>jane.doe@gmail.com</p>\n" });
    git("add", "-A");
    write({ "design/page.html": "<p>sara@example.com</p>\n" });
    expect(run("--staged").status).toBe(1);
  });

  it("--staged decodes a nested export", () => {
    write({ "design/reference/Board.html": claudeDesignExport({ "n-uuid": nestedPage("<p>0551234567</p>") }) });
    git("add", "-A");
    const result = run("--staged");
    expect(result.status).toBe(1);
    expect(output(result)).toContain("phone");
    expect(output(result)).toContain("n-uuid");
  });

  it("--tree reads every tracked file under design/", () => {
    write({ "design/a/b/page.html": "<p>0551234567</p>\n", "design/clean.html": "<p>ok</p>\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "design");
    const result = run("--tree");
    expect(result.status).toBe(1);
    expect(output(result)).toContain("design/a/b/page.html:1: phone");
    expect(output(result)).not.toContain("clean.html");
  });

  it("--range reads the design files a range changes, as they stand at its head", () => {
    write({ "design/old.html": "<p>0551234567</p>\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "old");
    const base = git("rev-parse", "HEAD").trim();
    write({ "design/new.html": "<p>jane.doe@gmail.com</p>\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "new");
    const result = run("--range", `${base}..HEAD`);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("design/new.html:1: email");
    expect(output(result)).not.toContain("old.html");
    // A single revision is that commit's whole design tree.
    expect(output(run("--range", "HEAD"))).toContain("design/old.html:1: phone");
  });

  it("--staged and --range fail only on a value the file did not already hold; --tree still lists it all", () => {
    write({ "design/legacy.html": "<p>0551234567</p>\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "legacy");
    const base = git("rev-parse", "HEAD").trim();
    // An unrelated edit to the file, the old value moved to another line: not new.
    write({ "design/legacy.html": "<h1>Title</h1>\n<p>0551234567</p>\n" });
    git("add", "-A");
    expect(run("--staged").status).toBe(0);
    git("commit", "-q", "--no-verify", "-m", "edit");
    expect(run("--range", `${base}..HEAD`).status).toBe(0);
    expect(run("--tree").status).toBe(1);
    // A second, new value in the same file fails, with only the new one named.
    write({ "design/legacy.html": "<h1>Title</h1>\n<p>0551234567</p>\n<p>jane.doe@gmail.com</p>\n" });
    git("add", "-A");
    const result = run("--staged");
    expect(result.status).toBe(1);
    expect(output(result)).toContain("design/legacy.html:3: email");
    expect(output(result)).not.toContain("phone");
  });

  it("--staged fails the old value copied into a new file", () => {
    write({ "design/legacy.html": "<p>0551234567</p>\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "legacy");
    write({ "design/copy.html": "<p>0551234567</p>\n" });
    git("add", "-A");
    expect(run("--staged").status).toBe(1);
  });

  it("--staged reads a design page whose name has spaces, brackets and non-ASCII letters", () => {
    write({ "design/reference/My Board (ص) copy.html": "<p>jane.doe@gmail.com</p>\n" });
    git("add", "-A");
    const result = run("--staged");
    expect(result.status).toBe(1);
    expect(output(result)).toContain(":1: email");
  });

  it("--range with three dots compares against where the branch left its base, not the base's tip", () => {
    write({ "design/page.html": "<p>hi</p>\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "page");
    git("checkout", "-q", "-b", "feature");
    write({ "design/page.html": "<p>hi</p>\n<p>0551234567</p>\n" });
    git("commit", "-q", "--no-verify", "-am", "feature adds a number");
    git("checkout", "-q", "main");
    // main gains the same number meanwhile: the feature still adds it relative to where it left main.
    write({ "design/page.html": "<p>hi</p>\n<p>0551234567</p>\n" });
    git("commit", "-q", "--no-verify", "-am", "main adds it too");
    git("checkout", "-q", "feature");
    expect(run("--range", "main...feature").status).toBe(1);
  });

  it("--range passes a range that changes no design file", () => {
    write({ "docs/a.md": "hello\n" });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "docs");
    expect(run("--range", "HEAD~1..HEAD").status).toBe(0);
  });

  it("asks for a mode", () => {
    expect(run().status).toBe(2);
    expect(run("--range").status).toBe(2);
  });

  it("the committed allow list is valid JSON the script loads", () => {
    JSON.parse(readFileSync(join(here, "design-personal-data-allow.json"), "utf8"));
    expect(run("--tree").status).toBe(0);
  });
});
