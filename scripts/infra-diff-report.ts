/* eslint-disable rabaed/no-avoid-terms -- AWS resource types, the AWS account ID and GitHub's comment API, by their own names */
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The `cdk diff (dev)` report (RP-1018), run by .github/workflows/infra-diff.yml on a pull request
// after `cdk diff` against the deployed dev stacks.
//
// The whole diff goes to the job summary. The PR gets a comment only when the PR itself adds, removes
// or changes an IAM or stateful resource. That is found by comparing the PR's synthesized templates with
// its base's, not by reading the diff: dev lags main, so the diff against the deployed stacks shows main's
// undeployed changes on every PR (in October 2026, the same PermissionsBoundary change on every PR).
// The bot's comment on every PR woke every lane's Auto-fix for a report that asked for nothing.
//
// A later push edits the same comment, so a PR gets at most one. When the diff or a synth fails, the
// script posts nothing: the job's red status says it.
//
// Environment: DIFF_FILE (the diff's output), OUTCOME (the diff step's outcome), BASE_OUT and HEAD_OUT
// (the base's and the PR's cloud assemblies), ACCOUNT (the AWS account ID, redacted from the report),
// RUN_URL, PR, GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY.

/** The first line of the bot's comment, to find it again. */
export const MARKER = "<!-- infra-diff -->";

interface Resource {
  Type: string;
  Properties?: unknown;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Metadata?: unknown;
  [key: string]: unknown;
}

/** Each stack's CloudFormation template, by stack name. */
export type Templates = Record<string, { Resources?: Record<string, Resource> }>;

export type Why = "IAM" | "stateful";

export interface SensitiveChange {
  stack: string;
  logicalId: string;
  type: string;
  change: "added" | "removed" | "modified";
  why: Why[];
}

/** Resources that grant access without being in AWS::IAM: a resource policy is IAM too. */
const RESOURCE_POLICY_TYPES = new Set([
  "AWS::S3::BucketPolicy",
  "AWS::SNS::TopicPolicy",
  "AWS::SQS::QueuePolicy",
  "AWS::SecretsManager::ResourcePolicy",
  "AWS::Lambda::Permission",
  "AWS::Logs::ResourcePolicy",
  "AWS::ECR::RepositoryPolicy",
]);

/** Resources that hold data, whatever their deletion policy says. */
const STATEFUL_TYPES = new Set([
  "AWS::RDS::DBInstance",
  "AWS::RDS::DBCluster",
  "AWS::S3::Bucket",
  "AWS::KMS::Key",
  "AWS::SecretsManager::Secret",
  "AWS::ECR::Repository",
  "AWS::DynamoDB::Table",
  "AWS::EFS::FileSystem",
  "AWS::Cognito::UserPool",
  "AWS::SQS::Queue",
]);

/** The deletion policies CDK sets on a resource that keeps data (RemovalPolicy.RETAIN or SNAPSHOT). */
const KEEPS_DATA = new Set(["Retain", "RetainExceptOnCreate", "Snapshot"]);

function sensitivity(resource: Resource): Why[] {
  const why: Why[] = [];
  if (resource.Type.startsWith("AWS::IAM::") || RESOURCE_POLICY_TYPES.has(resource.Type)) why.push("IAM");
  if (STATEFUL_TYPES.has(resource.Type) || KEEPS_DATA.has(resource.DeletionPolicy ?? "") || KEEPS_DATA.has(resource.UpdateReplacePolicy ?? "")) why.push("stateful");
  return why;
}

/** JSON with sorted keys and without CDK's construct metadata, which moves without changing the resource. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "Metadata")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The IAM and stateful resources the head adds, removes or changes against the base, by stack then logical ID. */
export function sensitiveChanges(base: Templates, head: Templates): SensitiveChange[] {
  const changes: SensitiveChange[] = [];
  const stacks = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  for (const stack of stacks) {
    const before = base[stack]?.Resources ?? {};
    const after = head[stack]?.Resources ?? {};
    const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const logicalId of ids) {
      const old = before[logicalId];
      const now = after[logicalId];
      if (old && now && canonical(old) === canonical(now)) continue;
      const change = !old ? "added" : !now ? "removed" : "modified";
      // A resource that stops being stateful counts: dropping Retain is the change that loses data.
      const why = [...new Set([...(old ? sensitivity(old) : []), ...(now ? sensitivity(now) : [])])].sort();
      const type = (now ?? old)?.Type ?? "";
      if (why.length > 0) changes.push({ stack, logicalId, type, change, why });
    }
  }
  return changes;
}

/** Each stack's template in a cloud assembly (`cdk synth -o <dir>`); throws when the assembly is not there. */
export function readAssembly(dir: string): Templates {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    artifacts?: Record<string, { type: string; properties?: { templateFile?: string } }>;
  };
  const templates: Templates = {};
  for (const [name, artifact] of Object.entries(manifest.artifacts ?? {})) {
    if (artifact.type !== "aws:cloudformation:stack" || !artifact.properties?.templateFile) continue;
    templates[name] = JSON.parse(readFileSync(join(dir, artifact.properties.templateFile), "utf8")) as Templates[string];
  }
  return templates;
}

/** The text with the AWS account ID replaced: the repository and its run summaries are public (RP-244). */
export function redact(text: string, account: string): string {
  if (!/^\d{12}$/.test(account)) throw new Error("the AWS account ID could not be read, so the report cannot be redacted");
  return text.replaceAll(account, "<account>");
}

/** A table cell kept to identifier characters: the templates come from the PR's code. */
const cell = (text: string) => text.replace(/[^\w:.-]/g, "_");

function table(changes: SensitiveChange[]): string {
  return [
    "| Stack | Resource | Type | Change | Why |",
    "| --- | --- | --- | --- | --- |",
    ...changes.map((c) => `| ${cell(c.stack)} | ${cell(c.logicalId)} | ${cell(c.type)} | ${c.change} | ${c.why.join(", ")} |`),
  ].join("\n");
}

/** The job summary's limit is 1 MiB a step; the end of the diff holds the last stacks and the count. */
const SUMMARY_DIFF_CHARS = 600_000;

/** A code fence longer than any run of backticks in the text, so the text cannot close it. */
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** The job summary: the outcome, what the PR changes in IAM and stateful resources, then the whole diff against dev. */
export function summaryMarkdown(input: { outcome: string; diff: string; changes: SensitiveChange[] | undefined }): string {
  const { outcome, diff, changes } = input;
  const verdict =
    changes === undefined
      ? "The PR's templates could not be compared with its base's (a diff or synth failed), so IAM and stateful changes are not listed."
      : changes.length === 0
        ? "This PR changes no IAM or stateful resource (its templates compared with its base's), so it gets no comment."
        : `This PR changes ${changes.length} IAM or stateful resource(s) (its templates compared with its base's):\n\n${table(changes)}`;
  const shown = diff.length > SUMMARY_DIFF_CHARS ? diff.slice(-SUMMARY_DIFF_CHARS) : diff;
  return [`### cdk diff (dev): ${outcome}`, "", verdict, "", "The diff against the deployed dev stacks, which also shows `main`'s undeployed changes:", "", fenced(shown), ""].join("\n");
}

/** The PR comment: the IAM and stateful changes, or, once a push removed them, that the earlier warning no longer holds. */
export function commentBody(changes: SensitiveChange[], runUrl: string): string {
  if (changes.length === 0) {
    return `${MARKER}\n### cdk diff (dev): no IAM or stateful change now\n\nThe latest push changes no IAM or stateful resource. The full diff is in the [job summary](${runUrl}).\n`;
  }
  return `${MARKER}\n### cdk diff (dev): this PR changes IAM or a stateful resource\n\n${table(changes)}\n\nThe full diff against dev is in the [job summary](${runUrl}).\n`;
}

export interface PrComments {
  /** The PR's comments, oldest first; `bot` marks the Actions bot's own. */
  list(): Promise<{ id: number; body: string; bot: boolean }[]>;
  create(body: string): Promise<void>;
  update(id: number, body: string): Promise<void>;
}

/**
 * Comments only when the PR changes IAM or a stateful resource, editing its earlier comment rather than
 * adding one. With no such change, it edits an earlier warning to say so and otherwise posts nothing;
 * with no comparison (`undefined`), it posts nothing.
 */
export async function reportOnPr(changes: SensitiveChange[] | undefined, comments: PrComments, runUrl: string): Promise<"created" | "updated" | "none"> {
  if (changes === undefined) return "none";
  const earlier = (await comments.list()).filter((comment) => comment.bot && comment.body.startsWith(MARKER)).at(-1);
  const body = commentBody(changes, runUrl);
  if (!earlier) {
    if (changes.length === 0) return "none";
    await comments.create(body);
    return "created";
  }
  if (earlier.body === body) return "none";
  await comments.update(earlier.id, body);
  return "updated";
}

export function overHttp(repository: string, token: string, pr: number, fetcher: typeof fetch = fetch): PrComments {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path} answered ${response.status}`);
    return response.json();
  };
  return {
    async list() {
      const comments: { id: number; body: string; bot: boolean }[] = [];
      for (let page = 1; ; page++) {
        const listed = (await call("GET", `issues/${pr}/comments?per_page=100&page=${page}`)) as { id: number; body?: string; user: { login: string; type: string } | null }[];
        comments.push(...listed.map((c) => ({ id: c.id, body: c.body ?? "", bot: c.user?.login === "github-actions[bot]" && c.user.type === "Bot" })));
        if (listed.length < 100) return comments;
      }
    },
    async create(body) {
      await call("POST", `issues/${pr}/comments`, { body });
    },
    async update(id, body) {
      await call("PATCH", `issues/comments/${id}`, { body });
    },
  };
}

async function main() {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must be set`);
    return value;
  };
  const outcome = env("OUTCOME");
  const account = env("ACCOUNT");
  const runUrl = env("RUN_URL");
  const diff = redact(readFileSync(env("DIFF_FILE"), "utf8"), account);
  let changes: SensitiveChange[] | undefined;
  if (outcome === "success") {
    try {
      changes = sensitiveChanges(readAssembly(env("BASE_OUT")), readAssembly(env("HEAD_OUT")));
    } catch (error) {
      console.error(`::warning::could not compare the PR's templates with its base's: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  appendFileSync(env("GITHUB_STEP_SUMMARY"), summaryMarkdown({ outcome, diff, changes }));
  const done = await reportOnPr(changes, overHttp(env("GITHUB_REPOSITORY"), env("GITHUB_TOKEN"), Number(env("PR"))), runUrl);
  console.log(`IAM or stateful changes: ${changes === undefined ? "not compared" : changes.length}; PR comment: ${done}.`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
