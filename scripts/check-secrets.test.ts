import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addedLines, findSecrets, formatFinding, scanDiff, scanStaged, scanText, scanTree, SECRET_RULES } from "./check-secrets.ts";

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
  it("has a test token for every rule", () => {
    expect(new Set(Object.values(expectedRule))).toEqual(new Set(SECRET_RULES.map((rule) => rule.id)));
  });

  it("finds a real AWS key after the documented example on the same line", () => {
    expect(findSecrets(join2("AK", "IA", "IOSFODNN7", "EXAMPLE ", tokens.awsKeyId))).toEqual(["aws-access-key-id"]);
  });

  it("finds a PGP private key block", () => {
    expect(findSecrets(join2("-----BEGIN ", "PGP PRIVATE", " KEY BLOCK-----"))).toEqual(["private-key"]);
  });

  it("lets an assignment through whose value is a call or a plain identifier", () => {
    expect(findSecrets("const jiraToken = loadJiraTokenFromEnvironment();")).toEqual([]);
    expect(findSecrets("VERCEL_TOKEN = readVercelTokenFromSecretsManager()")).toEqual([]);
    expect(findSecrets("const jiraToken = environmentVariableValue;")).toEqual([]);
  });

  for (const [name, token] of Object.entries(tokens) as [keyof typeof tokens, string][]) {
    it(`finds a ${name} token`, () => {
      expect(findSecrets(`const x = "${token}";`)).toEqual([expectedRule[name]]);
    });
  }

  it("finds the token inside the curl Jira's upload hands back (the RP-1100 incident)", () => {
    const curl = join2("curl -", "u someone@example.com:", tokens.atlassian, " -X POST -H 'X-Atlassian-Token: no-check' -F file=@shot.png https://example.atlassian.net/rest/api/3/issue/RP-1/attachments");
    expect(findSecrets(curl)).toEqual(["atlassian-api-token"]);
  });

  it("finds a Jira token assigned in an env file", () => {
    expect(findSecrets(join2("JIRA_API", "_TOKEN=", chars(24)))).toEqual(["atlassian-api-token"]);
  });

  it("finds a bare Vercel token passed to the CLI's --token flag", () => {
    expect(findSecrets(join2("vercel deploy --prod --to", "ken=", chars(24)))).toEqual(["vercel-token"]);
    expect(findSecrets(join2("vercel pull --to", "ken '", chars(24), "'"))).toEqual(["vercel-token"]);
  });

  it("finds an AWS secret key in SDK config and credentials JSON, and a session token", () => {
    const secret = chars(40, "abcXYZ019/+");
    expect(findSecrets(join2("  secret", "AccessKey: \"", secret, "\","))).toEqual(["aws-secret-access-key"]);
    expect(findSecrets(join2("{\"Secret", "AccessKey\": \"", secret, "\"}"))).toEqual(["aws-secret-access-key"]);
    expect(findSecrets(join2("aws_session", "_token=", chars(120, "abcXYZ019/+=")))).toEqual(["aws-secret-access-key"]);
  });

  it("lets AWS's documented example key and secret through", () => {
    expect(findSecrets(join2("AK", "IA", "IOSFODNN7", "EXAMPLE"))).toEqual([]);
    expect(findSecrets(join2("aws_secret", "_access_key = ", "wJalrXUtnFEMI/K7MDENG/bPxRfiCY", "EXAMPLEKEY"))).toEqual([]);
  });

  it("lets the CLI's --token flag through when it reads a variable", () => {
    expect(findSecrets('vercel deploy --prod --token="$VERCEL_TOKEN"')).toEqual([]);
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
    expect(addedLines("--- /dev/null\n+++ b/docs/my notes.md\n@@ -0,0 +1 @@\n+hello")).toEqual([{ file: "docs/my notes.md", line: 1, text: "hello" }]);
  });

  it("reads a path git quotes (a tab or quote in the name)", () => {
    expect(addedLines('--- /dev/null\n+++ "b/docs/a\\tb \\"c\\".md"\n@@ -0,0 +1 @@\n+hello')).toEqual([{ file: 'docs/a\tb "c".md', line: 1, text: "hello" }]);
  });

  it("reads an added line that starts with ++ as content, not as a file header", () => {
    const diff = ["--- a/a.ts", "+++ b/a.ts", "@@ -0,0 +1,2 @@", "+++ counter;", "+next"].join("\n");
    expect(addedLines(diff)).toEqual([
      { file: "a.ts", line: 1, text: "++ counter;" },
      { file: "a.ts", line: 2, text: "next" },
    ]);
  });
});

describe("scanDiff", () => {
  it("finds a token only on added lines: removing one is how it gets fixed", () => {
    const diff = ["--- a/a.ts", "+++ b/a.ts", "@@ -1 +1,2 @@", `-const old = "${tokens.github}";`, "+const ok = 1;", `+const key = "${tokens.sendgrid}";`].join("\n");
    expect(scanDiff(diff)).toEqual([{ file: "a.ts", line: 2, rule: "sendgrid-api-key" }]);
  });
});

// CODING_STANDARDS.md › Tests: the input most likely to slip past the guard, from git itself.
describe("scanStaged on real git output", () => {
  it("finds tokens on a ++ line, under a path with a space, a tab or quotes, and after an example key", () => {
    const repo = mkdtempSync(join(tmpdir(), "rabaed-secrets-staged-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "counter.ts"), `let i = 0;\n++ i; // ${tokens.github}\nconst after = "${tokens.sendgrid}";\n`);
      writeFileSync(join(repo, "my notes.md"), `one\n${tokens.atlassian}\n`);
      execFileSync("git", ["add", "-A"], { cwd: repo });
      // Windows cannot name a file with quotes or a tab, so this one goes straight into the index.
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: `${join2("AK", "IA", "IOSFODNN7", "EXAMPLE")} ${tokens.awsKeyId}\n`, encoding: "utf8" }).trim();
      execFileSync("git", ["-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${blob},odd "name"\tx.md`], { cwd: repo });
      expect(scanStaged(repo).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)).toEqual([
        { file: "counter.ts", line: 2, rule: "github-token" },
        { file: "counter.ts", line: 3, rule: "sendgrid-api-key" },
        { file: "my notes.md", line: 2, rule: "atlassian-api-token" },
        { file: 'odd "name"\tx.md', line: 1, rule: "aws-access-key-id" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("scanTree", () => {
  it("reads every tracked text file whole, and skips binary and untracked ones", () => {
    const repo = mkdtempSync(join(tmpdir(), "rabaed-secrets-tree-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "clean.ts"), "const token = process.env.JIRA_API_TOKEN;\n");
      writeFileSync(join(repo, "leak.md"), `# notes\n\nkey ${tokens.github}\n`);
      writeFileSync(join(repo, "image.bin"), Buffer.concat([Buffer.from([0]), Buffer.from(tokens.github)]));
      execFileSync("git", ["add", "-A"], { cwd: repo });
      writeFileSync(join(repo, "untracked.ts"), tokens.sendgrid);
      expect(scanTree(repo)).toEqual([{ file: "leak.md", line: 3, rule: "github-token" }]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("formatFinding", () => {
  it("names the file, line and kind, never the token", () => {
    const [finding] = scanText("scripts/upload.sh", join2("curl -", "u me:", tokens.atlassian));
    const text = formatFinding(finding!);
    expect(text).toBe("  scripts/upload.sh:1: Atlassian API token (atlassian-api-token)");
    expect(text).not.toContain(tokens.atlassian.slice(0, 12));
  });
});
