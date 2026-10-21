import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { commentBody, MARKER, overHttp, readAssembly, redact, reportOnPr, sensitiveChanges, summaryMarkdown, type PrComments, type Templates } from "./infra-diff-report.ts";

// The workflow lands in its own PR after this script (rule 3), so these wait for it to run the script.
const workflowPath = join(dirname(import.meta.filename), "..", ".github", "workflows", "infra-diff.yml");
const workflowSource = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
describe.skipIf(!workflowSource.includes("scripts/infra-diff-report.ts"))("infra-diff.yml", () => {
  const wf = parse(workflowSource || "jobs: {}") as { jobs: Record<string, { steps: { name?: string; id?: string; if?: string; run?: string; uses?: string }[] }> };
  const steps = Object.values(wf.jobs).flatMap((job) => job.steps);

  it("posts nothing with gh: the script decides whether the PR gets a comment", () => {
    expect(steps.some((step) => step.run?.includes("gh pr comment"))).toBe(false);
  });

  it("reports only when the diff ran, so a failed AWS sign-in posts nothing (the red job is enough, RP-1030)", () => {
    const report = steps.find((step) => step.run?.includes("scripts/infra-diff-report.ts"));
    expect(report?.if).toContain("steps.diff.outcome != 'skipped'");
  });
});

const role = (policy: string) => ({ Type: "AWS::IAM::Role", Properties: { Policies: [policy] } });
const bucket = { Type: "AWS::S3::Bucket", Properties: { BucketName: "b" }, DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" };
const alarm = (threshold: number) => ({ Type: "AWS::CloudWatch::Alarm", Properties: { Threshold: threshold } });

describe("sensitiveChanges", () => {
  it("finds nothing when the PR leaves IAM and stateful resources alone, whatever else changes", () => {
    const base: Templates = { "Rabaed-dev-App": { Resources: { Role: role("a"), Alarm: alarm(1) } } };
    const head: Templates = { "Rabaed-dev-App": { Resources: { Role: role("a"), Alarm: alarm(2), Other: alarm(3) } } };
    expect(sensitiveChanges(base, head)).toEqual([]);
  });

  it("names an IAM resource the PR adds, removes or changes", () => {
    const base: Templates = { S: { Resources: { Kept: role("a"), Gone: role("b") } } };
    const head: Templates = { S: { Resources: { Kept: role("a2"), New: role("c") } } };
    expect(sensitiveChanges(base, head)).toEqual([
      { stack: "S", logicalId: "Gone", type: "AWS::IAM::Role", change: "removed", why: ["IAM"] },
      { stack: "S", logicalId: "Kept", type: "AWS::IAM::Role", change: "modified", why: ["IAM"] },
      { stack: "S", logicalId: "New", type: "AWS::IAM::Role", change: "added", why: ["IAM"] },
    ]);
  });

  it("counts a resource policy as IAM: a bucket, topic or secret policy grants access too", () => {
    for (const type of ["AWS::S3::BucketPolicy", "AWS::SNS::TopicPolicy", "AWS::SecretsManager::ResourcePolicy", "AWS::Lambda::Permission"]) {
      const head: Templates = { S: { Resources: { P: { Type: type, Properties: {} } } } };
      expect(sensitiveChanges({}, head)).toMatchObject([{ logicalId: "P", why: ["IAM"] }]);
    }
  });

  it("names a stateful resource by its type, or by a Retain or Snapshot deletion policy", () => {
    const base: Templates = { S: { Resources: { Bucket: bucket, Secret: { Type: "AWS::SecretsManager::Secret", Properties: { A: 1 } } } } };
    const head: Templates = {
      S: {
        Resources: {
          Bucket: { ...bucket, Properties: { BucketName: "renamed" } },
          Secret: { Type: "AWS::SecretsManager::Secret", Properties: { A: 2 } },
          Kept: { Type: "AWS::Some::Thing", Properties: {}, DeletionPolicy: "Snapshot" },
        },
      },
    };
    expect(sensitiveChanges(base, head).map((change) => [change.logicalId, change.change, change.why])).toEqual([
      ["Bucket", "modified", ["stateful"]],
      ["Kept", "added", ["stateful"]],
      ["Secret", "modified", ["stateful"]],
    ]);
  });

  it("names a resource that stops being stateful: dropping Retain is the change that loses data", () => {
    const base: Templates = { S: { Resources: { Log: { Type: "AWS::Logs::LogGroup", Properties: {}, DeletionPolicy: "Retain" } } } };
    const head: Templates = { S: { Resources: { Log: { Type: "AWS::Logs::LogGroup", Properties: {}, DeletionPolicy: "Delete" } } } };
    expect(sensitiveChanges(base, head)).toMatchObject([{ logicalId: "Log", change: "modified", why: ["stateful"] }]);
  });

  it("ignores construct metadata and key order, which move without changing the resource", () => {
    const base: Templates = { S: { Resources: { Role: { Type: "AWS::IAM::Role", Properties: { A: 1, B: 2 }, Metadata: { "aws:cdk:path": "S/Old" } } } } };
    const head: Templates = { S: { Resources: { Role: { Type: "AWS::IAM::Role", Properties: { B: 2, A: 1 }, Metadata: { "aws:cdk:path": "S/New" } } } } };
    expect(sensitiveChanges(base, head)).toEqual([]);
  });

  it("still sees a property that happens to be named Metadata: only the resource's own Metadata is ignored", () => {
    const base: Templates = { S: { Resources: { Role: { Type: "AWS::IAM::Role", Properties: { Metadata: "a" } } } } };
    const head: Templates = { S: { Resources: { Role: { Type: "AWS::IAM::Role", Properties: { Metadata: "b" } } } } };
    expect(sensitiveChanges(base, head)).toMatchObject([{ logicalId: "Role", change: "modified" }]);
  });

  it("counts every resource of a new or removed stack", () => {
    expect(sensitiveChanges({}, { New: { Resources: { Role: role("a") } } })).toMatchObject([{ stack: "New", change: "added" }]);
    expect(sensitiveChanges({ Old: { Resources: { Bucket: bucket } } }, {})).toMatchObject([{ stack: "Old", change: "removed" }]);
  });
});

describe("readAssembly", () => {
  it("reads each stack's template from the cloud assembly's manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "infra-diff-"));
    writeFileSync(join(dir, "S.template.json"), JSON.stringify({ Resources: { Role: role("a") } }));
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ artifacts: { S: { type: "aws:cloudformation:stack", properties: { templateFile: "S.template.json" } }, Tree: { type: "cdk:tree", properties: { file: "tree.json" } } } }),
    );
    expect(readAssembly(dir)).toEqual({ S: { Resources: { Role: role("a") } } });
  });

  it("throws on a CDK Stage or a nested stack, whose templates it does not read, rather than report no change", () => {
    const stage = mkdtempSync(join(tmpdir(), "infra-diff-"));
    writeFileSync(join(stage, "manifest.json"), JSON.stringify({ artifacts: { Dev: { type: "cdk:cloud-assembly", properties: { directoryName: "assembly-Dev" } } } }));
    expect(() => readAssembly(stage)).toThrow("Stage");

    const nested = mkdtempSync(join(tmpdir(), "infra-diff-"));
    writeFileSync(join(nested, "S.template.json"), JSON.stringify({ Resources: { Child: { Type: "AWS::CloudFormation::Stack", Properties: {} } } }));
    writeFileSync(join(nested, "manifest.json"), JSON.stringify({ artifacts: { S: { type: "aws:cloudformation:stack", properties: { templateFile: "S.template.json" } } } }));
    expect(() => readAssembly(nested)).toThrow("nested stack, Child");
  });

  it("throws when there is no assembly, so a failed synth never reads as 'no changes'", () => {
    const dir = mkdtempSync(join(tmpdir(), "infra-diff-"));
    mkdirSync(join(dir, "empty"));
    expect(() => readAssembly(join(dir, "empty"))).toThrow();
  });
});

describe("redact", () => {
  it("replaces the account ID everywhere", () => {
    expect(redact("arn:aws:iam::123456789012:role/x and 123456789012", "123456789012")).toBe("arn:aws:iam::<account>:role/x and <account>");
  });

  it("refuses anything but a 12-digit account ID: never post without knowing what to redact", () => {
    expect(() => redact("text", "")).toThrow();
    expect(() => redact("text", "1234")).toThrow();
  });
});

const change = { stack: "Rabaed-dev-Account", logicalId: "PermissionsBoundary2D0B48CC", type: "AWS::IAM::ManagedPolicy", change: "modified" as const, why: ["IAM" as const] };

describe("summaryMarkdown", () => {
  it("heads the report with the outcome, lists the PR's IAM and stateful changes, then the whole diff", () => {
    const text = summaryMarkdown({ outcome: "success", diff: "Stack Rabaed-dev-Account\n[~] AWS::IAM::ManagedPolicy", changes: [change] });
    expect(text).toMatch(/^### cdk diff \(dev\): success\n/);
    expect(text).toContain("| Rabaed-dev-Account | PermissionsBoundary2D0B48CC | AWS::IAM::ManagedPolicy | modified | IAM |");
    expect(text).toContain("[~] AWS::IAM::ManagedPolicy");
  });

  it("says so when the PR changes no IAM or stateful resource, and when it could not compare", () => {
    expect(summaryMarkdown({ outcome: "success", diff: "", changes: [] })).toContain("This PR changes no IAM or stateful resource");
    expect(summaryMarkdown({ outcome: "failure", diff: "", changes: undefined })).toContain("could not be compared");
  });

  it("fences the diff so its text cannot close the code block", () => {
    const text = summaryMarkdown({ outcome: "success", diff: "a ``` b ```` c", changes: [] });
    expect(text).toContain("`````\na ``` b ```` c\n`````");
  });

  it("keeps the end of a very long diff, under the job summary's size limit", () => {
    const text = summaryMarkdown({ outcome: "success", diff: `start${"x".repeat(900_000)}end`, changes: [] });
    expect(text.length).toBeLessThan(800_000);
    expect(text).toContain("end\n");
    expect(text).not.toContain("start");
  });
});

describe("commentBody", () => {
  it("starts with the marker, lists the changes, and links the job summary for the diff", () => {
    const body = commentBody([change], "https://github.com/o/r/actions/runs/1");
    expect(body.startsWith(`${MARKER}\n### cdk diff (dev): this PR changes IAM or a stateful resource`)).toBe(true);
    expect(body).toContain("| Rabaed-dev-Account | PermissionsBoundary2D0B48CC | AWS::IAM::ManagedPolicy | modified | IAM |");
    expect(body).toContain("https://github.com/o/r/actions/runs/1");
  });

  it("keeps a table cell to plain identifier characters", () => {
    expect(commentBody([{ ...change, type: "AWS::X|<b>`" }], "u")).toContain("| AWS::X__b__ |");
  });

});

function fakeComments(existing: { id: number; body: string; bot: boolean }[]) {
  const calls: string[] = [];
  const seam: PrComments = {
    list: async () => existing,
    create: async (body) => void calls.push(`create ${body.split("\n")[1]}`),
    update: async (id, body) => void calls.push(`update ${id} ${body.split("\n")[1]}`),
  };
  return { seam, calls };
}

describe("reportOnPr", () => {
  it("posts nothing on a PR with no IAM or stateful change and no earlier warning (the usual PR)", async () => {
    const { seam, calls } = fakeComments([{ id: 1, body: "### cdk diff (dev): success", bot: true }]);
    expect(await reportOnPr([], seam, "u")).toBe("none");
    expect(calls).toEqual([]);
  });

  it("posts once when the PR changes IAM, then edits that comment on later pushes instead of adding one", async () => {
    const first = fakeComments([]);
    expect(await reportOnPr([change], first.seam, "u")).toBe("created");
    expect(first.calls).toEqual(["create ### cdk diff (dev): this PR changes IAM or a stateful resource"]);

    const later = fakeComments([
      { id: 5, body: `${MARKER}\nold`, bot: true },
      { id: 6, body: `${MARKER}\nsomeone quoting it`, bot: false },
    ]);
    expect(await reportOnPr([change], later.seam, "u")).toBe("updated");
    expect(later.calls).toEqual(["update 5 ### cdk diff (dev): this PR changes IAM or a stateful resource"]);
  });

  it("leaves an earlier warning alone when a push removes the change: an edit can wake Auto-fix too", async () => {
    const { seam, calls } = fakeComments([{ id: 5, body: `${MARKER}\nold`, bot: true }]);
    expect(await reportOnPr([], seam, "u")).toBe("none");
    expect(calls).toEqual([]);
  });

  it("does not edit a comment it posted with the same changes again", async () => {
    const { seam, calls } = fakeComments([{ id: 5, body: commentBody([change], "u"), bot: true }]);
    expect(await reportOnPr([change], seam, "u")).toBe("none");
    expect(calls).toEqual([]);
  });

  it("never edits another bot comment, such as queue-drop-comment's (gh pr comment --edit-last did)", async () => {
    const { seam, calls } = fakeComments([{ id: 7, body: "<!-- queue-drop-comment -->\nThe merge queue removed this PR", bot: true }]);
    expect(await reportOnPr([change], seam, "u")).toBe("created");
    expect(calls).toEqual(["create ### cdk diff (dev): this PR changes IAM or a stateful resource"]);
  });

  it("posts nothing when the diffs could not be compared (a failed diff or synth): the job's status says it", async () => {
    const { seam, calls } = fakeComments([{ id: 5, body: `${MARKER}\nold`, bot: true }]);
    expect(await reportOnPr(undefined, seam, "u")).toBe("none");
    expect(calls).toEqual([]);
  });
});

describe("overHttp", () => {
  it("lists the PR's comments page by page, marks the Actions bot's, and creates or edits by id", async () => {
    const requests: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(url)}${init?.body ? ` ${String(init.body)}` : ""}`);
      const page = /[?&]page=(\d+)/.exec(String(url))?.[1];
      const body =
        page === "1"
          ? Array.from({ length: 100 }, (_, i) => ({ id: i, body: "x", user: { login: "someone", type: "User" } }))
          : page === "2"
            ? [{ id: 100, body: MARKER, user: { login: "github-actions[bot]", type: "Bot" } }]
            : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const seam = overHttp("o/r", "t", 9, fetcher);
    const comments = await seam.list();
    expect(comments).toHaveLength(101);
    expect(comments[100]).toEqual({ id: 100, body: MARKER, bot: true });
    expect(comments[0]?.bot).toBe(false);
    await seam.create("new");
    await seam.update(100, "edit");
    expect(requests).toEqual([
      "GET https://api.github.com/repos/o/r/issues/9/comments?per_page=100&page=1",
      "GET https://api.github.com/repos/o/r/issues/9/comments?per_page=100&page=2",
      'POST https://api.github.com/repos/o/r/issues/9/comments {"body":"new"}',
      'PATCH https://api.github.com/repos/o/r/issues/comments/100 {"body":"edit"}',
    ]);
  });

  it("throws on an error answer", async () => {
    const fetcher = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await expect(overHttp("o/r", "t", 9, fetcher).list()).rejects.toThrow("403");
  });
});
