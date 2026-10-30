import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// No key, token or password is ever committed: the repo is public (CLAUDE.md).
// RP-1100: Jira's attachment upload hands back a curl with the API token inside,
// ready to be pasted into a script, doc or commit. This refuses the token shapes
// of the services Rabaed uses before the commit is made (.githooks/pre-commit),
// and CI runs it again on a pull request's commits, so a skipped hook is caught.
// gitleaks (secret-scan.yml) runs beside it with its own, wider rules.
//
// Only added lines count: removing a token is how a finding is fixed. A finding
// names the file, line and kind, never the token. Tests build their fake tokens
// from parts at run time (check-secrets.test.ts), so no file holds one.
//
// Usage: node scripts/check-secrets.ts --staged          the lines staged for the next commit
//        node scripts/check-secrets.ts --range <revs>    the lines those commits add (base..head)
//        node scripts/check-secrets.ts --tree            every tracked text file, whole

export interface SecretRule {
  id: string;
  description: string;
  pattern: RegExp;
  /** A match that is a documented example, not a secret. */
  allow?: (match: string) => boolean;
}

/* eslint-disable rabaed/no-avoid-terms -- AWS's and HTTP's own names for the credentials ("access key", "header") */
export const SECRET_RULES: SecretRule[] = [
  // An Atlassian API token (id.atlassian.com) starts ATATT3; an older one is a bare
  // 24 characters, so it is caught only where it is assigned to a Jira or Atlassian name.
  { id: "atlassian-api-token", description: "Atlassian API token", pattern: /\bATATT3[A-Za-z0-9_=-]{40,}/ },
  { id: "atlassian-api-token", description: "Atlassian API token", pattern: /\b(?:JIRA|ATLASSIAN|CONFLUENCE)_[A-Z_]*TOKEN["']?\s*[:=]\s*["']?[A-Za-z0-9_=-]{20,}/i },
  // Classic (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained tokens.
  { id: "github-token", description: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  // Vercel's prefixed tokens (vcp_, vci_, vca_, vcr_, vck_), or an older bare one assigned to a Vercel name.
  { id: "vercel-token", description: "Vercel token", pattern: /\bvc[pciark]_[A-Za-z0-9]{24,}/ },
  { id: "vercel-token", description: "Vercel token", pattern: /\bVERCEL_[A-Z_]*TOKEN["']?\s*[:=]\s*["']?[A-Za-z0-9]{24,}/i },
  { id: "aws-access-key-id", description: "AWS access key ID", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/, allow: (match) => match.endsWith("EXAMPLE") },
  { id: "aws-secret-access-key", description: "AWS secret access key", pattern: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+]{40}/i },
  { id: "sendgrid-api-key", description: "SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  // A literal Basic header, as in a copied curl: base64 of email:token. Code builds it at run time.
  { id: "basic-auth-header", description: "Basic auth header with credentials", pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+/]{16,}/i },
  { id: "private-key", description: "private key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
];
/* eslint-enable rabaed/no-avoid-terms */

const descriptions = new Map(SECRET_RULES.map((rule) => [rule.id, rule.description]));

/** The rule ids that match a line, each once. */
export function findSecrets(line: string): string[] {
  const found = new Set<string>();
  for (const rule of SECRET_RULES) {
    const match = rule.pattern.exec(line);
    if (match && !rule.allow?.(match[0])) found.add(rule.id);
  }
  return [...found];
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** Every line a unified diff adds (git diff or git log -p), with its file and line number in the new version. */
export function addedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | undefined;
  let next = 0;
  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("+++ ")) {
      const path = line.slice(4);
      file = path === "/dev/null" ? undefined : path.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (file === undefined) continue;
    if (line.startsWith("+")) added.push({ file, line: next++, text: line.slice(1) });
    else if (line.startsWith(" ")) next++;
  }
  return added;
}

/** The findings on the lines a diff adds. */
export function scanDiff(diff: string): Finding[] {
  return addedLines(diff).flatMap(({ file, line, text }) => findSecrets(text).map((rule) => ({ file, line, rule })));
}

/** The findings in a whole file's text. */
export function scanText(file: string, text: string): Finding[] {
  return text.split("\n").flatMap((line, index) => findSecrets(line).map((rule) => ({ file, line: index + 1, rule })));
}

/** One finding as a line of output: never the token itself. */
export const formatFinding = ({ file, line, rule }: Finding) => `  ${file}:${line}: ${descriptions.get(rule) ?? rule} (${rule})`;

const git = (repo: string, args: string[]) => execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

// No context lines, no colour, no external diff tool; text only (a binary file shows no lines).
const DIFF_OPTIONS = ["-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"];

/** The findings in the lines staged for the next commit. */
export const scanStaged = (repo: string) => scanDiff(git(repo, ["diff", "--cached", ...DIFF_OPTIONS]));

/** The findings in the lines a range's commits add; a merge is read against its first parent. */
export const scanRange = (repo: string, range: string) => scanDiff(git(repo, ["log", "-p", "--format=", "--diff-merges=first-parent", ...DIFF_OPTIONS, range, "--"]));

/** The findings in every tracked text file. */
export function scanTree(repo: string): Finding[] {
  return git(repo, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .flatMap((file) => {
      let text: string;
      try {
        text = readFileSync(join(repo, file), "utf8");
      } catch {
        return []; // deleted in the working tree, or a submodule
      }
      return text.includes("\0") ? [] : scanText(file, text);
    });
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const repo = process.cwd();
  const [mode, range] = process.argv.slice(2);
  if (mode === "--range" && (!range || range.startsWith("-"))) {
    console.error("--range needs the revisions to check, such as <base sha>..<head sha> or HEAD.");
    process.exit(2);
  }
  if (mode !== "--staged" && mode !== "--range" && mode !== "--tree") {
    console.error("usage: node scripts/check-secrets.ts --staged | --range <revs> | --tree");
    process.exit(2);
  }
  const where = mode === "--staged" ? "in the staged changes" : mode === "--range" ? `in ${range}` : "in the tracked tree";
  const findings = mode === "--staged" ? scanStaged(repo) : mode === "--range" ? scanRange(repo, range!) : scanTree(repo);
  if (findings.length > 0) {
    console.error(`A secret is ${where} (the repo is public):`);
    for (const finding of findings) console.error(formatFinding(finding));
    console.error("Remove it and read it from the environment instead (.env is gitignored; .env.example names the variable, no value).");
    console.error("If it was ever real, rotate it: a pushed commit stays readable.");
    process.exit(1);
  }
  console.log(`No secrets ${where}.`);
}
