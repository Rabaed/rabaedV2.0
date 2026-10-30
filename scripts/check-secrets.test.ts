import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addedLines, findSecrets, formatFinding, scanDiff, scanText } from "./check-secrets.ts";

// RP-1100. Every fake token here is built from parts at run time, so no file in
// the repo holds anything shaped like a token: not this scan, gitleaks, nor a
// reader copying one out. `chars(n)` is filler of the right alphabet and length.
const chars = (n: number, alphabet = "aB3dE5gH7kM9pQ2sT4") => alphabet.repeat(Math.ceil(n / alphabet.length)).slice(0, n);
const join2 = (...parts: string[]) => parts.join("");

const tokens = {
  atlassian: join2("ATA", "TT3", chars(180), "=", chars(8, "0A1B2C3D")),
  github: join2("gh", "p_", chars(36)),
  githubFineGrained: join2("github", "_pat_", chars(22), "_", chars(59)),
  vercel: join2("vc", "p_", chars(40)),
  vercelAssigned: join2("VERCEL", "_TOKEN=", chars(24)),
  awsKeyId: join2("AK", "IA", chars(16, "QWERTYUIOP2345678")),
  awsSecret: join2("aws_secret", "_access_key = ", chars(40, "abcXYZ019/+")),
  sendgrid: join2("S", "G.", chars(22), ".", chars(43)),
  basicAuth: join2("Authorization: ", "Basic ", chars(40)),
  privateKey: join2("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
};

const expectedRule: Record<keyof typeof tokens, string> = {
  atlassian: "atlassian-api-token",
  github: "github-token",
  githubFineGrained: "github-token",
  vercel: "vercel-token",
  vercelAssigned: "vercel-token",
  awsKeyId: "aws-access-key-id",
  awsSecret: "aws-secret-access-key",
  sendgrid: "sendgrid-api-key",
  basicAuth: "basic-auth-header",
  privateKey: "private-key",
};

describe("findSecrets", () => {
  for (const [name, token] of Object.entries(tokens) as [keyof typeof tokens, string][]) {
    it(`finds a ${name} token`, () => {
      expect(findSecrets(`const x = "${token}";`)).toEqual([expectedRule[name]]);
    });
  }

  it("finds the token inside the curl Jira's upload hands back (the RP-1100 incident)", () => {
    const curl = join2("curl -u someone@example.com:", tokens.atlassian, " -X POST -H 'X-Atlassian-Token: no-check' -F file=@shot.png https://example.atlassian.net/rest/api/3/issue/RP-1/attachments");
    expect(findSecrets(curl)).toEqual(["atlassian-api-token"]);
  });

  it("finds a Jira token assigned in an env file", () => {
    expect(findSecrets(join2("JIRA_API", "_TOKEN=", chars(24)))).toEqual(["atlassian-api-token"]);
  });

  it("lets AWS's documented example key through", () => {
    expect(findSecrets(join2("AK", "IA", "IOSFODNN7", "EXAMPLE"))).toEqual([]);
  });

  it("lets ordinary code through: env reads, header builders, workflow secrets, short prefixes", () => {
    const code = [
      "const token = process.env.JIRA_API_TOKEN;",
      "const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString(\"base64\")}` };",
      "JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}",
      "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
      "SENDGRID_API_KEY=",
      "// A GitHub token starts gh" + "p_, a SendGrid key S" + "G., an Atlassian one ATA" + "TT3.",
      "const vcr_cassette = load();",
      "const id = 'AKIA';",
    ].join("\n");
    expect(scanText("example.ts", code)).toEqual([]);
  });

  it("lets .env.example through: names only, local placeholders", () => {
    const envExample = readFileSync(join(import.meta.dirname, "..", ".env.example"), "utf8");
    expect(scanText(".env.example", envExample)).toEqual([]);
  });

  it("lets its own source through: the patterns are not tokens", () => {
    const source = readFileSync(join(import.meta.dirname, "check-secrets.ts"), "utf8");
    expect(scanText("scripts/check-secrets.ts", source)).toEqual([]);
  });
});

describe("addedLines", () => {
  it("reads the added lines of a diff with their file and line number", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,0 +5,2 @@",
      "+first",
      "+second",
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -3 +3 @@",
      "-before",
      "+after",
    ].join("\n");
    expect(addedLines(diff)).toEqual([
      { file: "a.ts", line: 5, text: "first" },
      { file: "a.ts", line: 6, text: "second" },
      { file: "b.ts", line: 3, text: "after" },
    ]);
  });

  it("reads a file path with spaces", () => {
    expect(addedLines("+++ b/docs/my notes.md\n@@ -0,0 +1 @@\n+hello")).toEqual([{ file: "docs/my notes.md", line: 1, text: "hello" }]);
  });
});

describe("scanDiff", () => {
  it("finds a token only on added lines: removing one is how it gets fixed", () => {
    const diff = ["+++ b/a.ts", "@@ -1 +1,2 @@", `-const old = "${tokens.github}";`, "+const ok = 1;", `+const key = "${tokens.sendgrid}";`].join("\n");
    expect(scanDiff(diff)).toEqual([{ file: "a.ts", line: 2, rule: "sendgrid-api-key" }]);
  });
});

describe("formatFinding", () => {
  it("names the file, line and kind, never the token", () => {
    const [finding] = scanText("scripts/upload.sh", `curl -u me:${tokens.atlassian}`);
    const text = formatFinding(finding!);
    expect(text).toBe("  scripts/upload.sh:1: Atlassian API token (atlassian-api-token)");
    expect(text).not.toContain(tokens.atlassian.slice(0, 12));
  });
});
