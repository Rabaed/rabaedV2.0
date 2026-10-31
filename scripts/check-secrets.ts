import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// No key, token or password is ever committed: the repo is public (CLAUDE.md).
// RP-1100: Jira's attachment upload hands back a curl with the API token inside,
// ready to be pasted into a script, doc or commit. This refuses the token shapes
// of the services Rabaed uses before the commit is made (.githooks/pre-commit).
// --range is for CI (secret-scan.yml's gitleaks job, beside gitleaks and its own,
// wider rules), so a commit made with the hook skipped or off is caught too.
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
  /** Global (g), so every match on a line is weighed. */
  pattern: RegExp;
  /** A match that is a documented example, not a secret. */
  allow?: (match: string) => boolean;
}

// A bare token assigned to a name (`JIRA_API_TOKEN=…`, `--token=…`): 20 or more token
// characters, at least one a digit, not followed by more of them or a call's "(", so
// `jiraToken = loadJiraToken()` and `token = someLongIdentifier` pass.
const assignedToken = (length: number) => String.raw`["']?(?=[A-Za-z_=-]*[0-9])[A-Za-z0-9_=-]{${length},}(?![A-Za-z0-9_=(-])`;
const assigned = (name: string, length = 20) => new RegExp(String.raw`${name}["']?\s*[:=]\s*${assignedToken(length)}`, "gi");

// AWS documents its example credentials; they end in EXAMPLE or EXAMPLEKEY.
const awsExample = (match: string) => /EXAMPLE(?:KEY)?$/.test(match);

/* eslint-disable rabaed/no-avoid-terms -- AWS's and HTTP's own names for the credentials ("access key", "header") */
export const SECRET_RULES: SecretRule[] = [
  // An Atlassian API token (id.atlassian.com) starts ATATT3; an older one is a bare
  // 24 characters, so it is caught only where it is assigned to a Jira or Atlassian name.
  { id: "atlassian-api-token", description: "Atlassian API token", pattern: /\bATATT3[A-Za-z0-9_=-]{40,}/g },
  { id: "atlassian-api-token", description: "Atlassian API token", pattern: assigned(String.raw`\b(?:JIRA|ATLASSIAN|CONFLUENCE)_?[A-Z_]*TOKEN`) },
  // Classic (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained tokens.
  { id: "github-token", description: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g },
  // Vercel's prefixed tokens (vcp_, vci_, vca_, vcr_, vck_), or an older bare one assigned to
  // a Vercel name or passed to the CLI's --token (as .github/workflows/deploy-uat.yml does from a variable).
  { id: "vercel-token", description: "Vercel token", pattern: /\bvc[pciark]_[A-Za-z0-9]{24,}/g },
  { id: "vercel-token", description: "Vercel token", pattern: assigned(String.raw`\bVERCEL_?[A-Z_]*TOKEN`, 24) },
  { id: "vercel-token", description: "Vercel token", pattern: new RegExp(String.raw`--token(?:=|\s+)${assignedToken(24)}`, "g") },
  { id: "aws-access-key-id", description: "AWS access key ID", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, allow: awsExample },
  // aws_secret_access_key, AWS_SECRET_ACCESS_KEY, secretAccessKey (SDK config), "SecretAccessKey" (STS JSON), and session tokens.
  { id: "aws-secret-access-key", description: "AWS secret access key", pattern: /secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+]{40}/gi, allow: awsExample },
  { id: "aws-secret-access-key", description: "AWS secret access key", pattern: /session_?token["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{100,}/gi },
  { id: "sendgrid-api-key", description: "SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
  // A literal Basic header, as in a copied curl: base64 of email:token. Code builds it at run time.
  { id: "basic-auth-header", description: "Basic auth header with credentials", pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+/]{16,}/gi },
  // PEM keys (RSA, EC, OPENSSH, ENCRYPTED, none) and PGP key blocks.
  { id: "private-key", description: "private key", pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
];
/* eslint-enable rabaed/no-avoid-terms */

const descriptions = new Map(SECRET_RULES.map((rule) => [rule.id, rule.description]));

/** The rule ids that match a line, each once; a match the rule allows does not hide a later one. */
export function findSecrets(line: string): string[] {
  const found = new Set<string>();
  for (const rule of SECRET_RULES) {
    for (const [match] of line.matchAll(rule.pattern)) {
      if (!rule.allow?.(match)) {
        found.add(rule.id);
        break;
      }
    }
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

const ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };

/** A path from a diff's "+++" line: git adds a tab after one with a space, and quotes one with a tab, quote or backslash (C escapes, octal bytes). */
function diffPath(text: string): string | undefined {
  const raw = text.replace(/\t$/, "");
  if (raw === "/dev/null") return undefined;
  let path = raw;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    const bytes: number[] = [];
    const inner = raw.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] !== "\\") {
        bytes.push(...Buffer.from(inner[i]!, "utf8"));
      } else if (/[0-7]{3}/.test(inner.slice(i + 1, i + 4))) {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        bytes.push(...Buffer.from(ESCAPES[inner[i + 1]!] ?? inner[i + 1]!, "utf8"));
        i += 1;
      }
    }
    path = Buffer.from(bytes).toString("utf8");
  }
  return path.replace(/^b\//, "");
}

/**
 * Every line a unified diff adds (git diff or git log -p), with its file and line number in the new
 * version. A "+++" line is a file header only before the file's first hunk; inside a hunk, its counts
 * say how many lines are left, so an added line "++ x" (shown "+++ x") stays content.
 */
export function addedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  let next = 0;
  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("+")) {
        if (file !== undefined) added.push({ file, line: next, text: line.slice(1) });
        next++;
        newLeft--;
      } else if (line.startsWith("-")) oldLeft--;
      else if (line.startsWith(" ")) {
        next++;
        oldLeft--;
        newLeft--;
      }
      // "\ No newline at end of file" counts for neither side.
      continue;
    }
    if (line.startsWith("+++ ")) {
      file = diffPath(line.slice(4));
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      next = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
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

/**
 * The findings in the lines a range's commits add; a merge is read against its first parent. Read `commitsPerRead` commits at a
 * time: main's whole history (a push to main) is one range, and its `git log -p` passed 366 MB at 3,438 commits, near the
 * 512 MB one read can hold. A line a merge brings in again from its other parent is reported once.
 */
export function scanRange(repo: string, range: string, commitsPerRead = 200): Finding[] {
  const commits = git(repo, ["rev-list", range, "--"]).split("\n").filter(Boolean);
  const seen = new Map<string, Finding>();
  for (let start = 0; start < commits.length; start += commitsPerRead) {
    const diff = git(repo, ["log", "-p", "--no-walk=unsorted", "--format=", "--diff-merges=first-parent", ...DIFF_OPTIONS, ...commits.slice(start, start + commitsPerRead), "--"]);
    for (const finding of scanDiff(diff)) seen.set(`${finding.file}\0${finding.line}\0${finding.rule}`, finding);
  }
  return [...seen.values()];
}

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
  const modes: Record<string, { where: string; scan: () => Finding[] }> = {
    "--staged": { where: "in the staged changes", scan: () => scanStaged(repo) },
    "--range": { where: `in ${range}`, scan: () => scanRange(repo, range!) },
    "--tree": { where: "in the tracked tree", scan: () => scanTree(repo) },
  };
  const chosen = mode === undefined ? undefined : modes[mode];
  if (!chosen) {
    console.error("usage: node scripts/check-secrets.ts --staged | --range <revs> | --tree");
    process.exit(2);
  }
  const { where } = chosen;
  const findings = chosen.scan();
  if (findings.length > 0) {
    console.error(`A secret is ${where} (the repo is public):`);
    for (const finding of findings) console.error(formatFinding(finding));
    console.error("Remove it and read it from the environment instead (.env is gitignored; .env.example names the variable, no value).");
    console.error("If it was ever real, rotate it: a pushed commit stays readable.");
    process.exit(1);
  }
  console.log(`No secrets ${where}.`);
}
