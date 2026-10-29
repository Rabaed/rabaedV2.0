import { documentalRecordPrefix, snagReportPrefix } from "@rabaed/db/storage-keys";
import { iamPatternMatches } from "@rabaed/db/test-support/iam-pattern";
import { describe, expect, it } from "vitest";
import { environments, stackNames } from "../src/config.ts";
import { constructId, environmentTemplates, objectKey, references, render, type Resource, type StackPart } from "./support.ts";

// Every IAM role the stacks define, and what each may do in S3: which actions, on which bucket and
// key prefix. The expected list below is written out by hand, so any grant that is added, widened
// or moved fails here and has to be argued for in review (RP-1104, after RP-1084 found the api
// allowed to overwrite records only the worker writes). The second half checks the list against
// the keys the code builds, so it is no wider than the code needs.

const env = environmentTemplates();
const parts = Object.keys(stackNames(environments.dev)) as StackPart[];
const API = "rabaed-dev-api-task";
const WORKER = "rabaed-dev-worker-task";
const DEPLOY = "rabaed-dev-github-deploy";

type Statement = {
  Effect: "Allow" | "Deny";
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: unknown;
  NotResource?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
};
type PolicyDocument = { Statement: Statement[] };

// A role's name: its RoleName, or for one CDK names itself, `<stack part>/<construct ID>`.
const roleName = (part: StackPart, logicalId: string, role: Resource) => String(role.Properties?.RoleName ?? `${part}/${constructId(logicalId)}`);

/** Every role the stacks define, by name. */
const roles = new Map<string, { part: StackPart; role: Resource }>();
for (const part of parts) {
  for (const [logicalId, role] of Object.entries(env.template(part).findResources("AWS::IAM::Role")) as [string, Resource][]) {
    roles.set(roleName(part, logicalId, role), { part, role });
  }
}

// The role a policy's `Roles` entry names: a Ref in its own stack, or a name from another stack.
function attachedRole(entry: unknown, part: StackPart): string {
  if (typeof entry === "string") return entry;
  const { logicalId, resource } = env.resolve(entry, part);
  return roleName(part, logicalId, resource);
}

/**
 * Every policy statement each role gets: inline, attached (`AWS::IAM::Policy`) or customer-managed,
 * with the stack it is written in (a stack may grant a role another stack defines, by name).
 */
function statementsByRole(): Map<string, { part: StackPart; statement: Statement }[]> {
  const byRole = new Map<string, { part: StackPart; statement: Statement }[]>([...roles.keys()].map((name) => [name, []]));
  const add = (name: string, part: StackPart, statements: Statement[]) => {
    // A role no stack defines (a typo, or one made outside the stacks) is listed too, so it must be expected.
    if (!byRole.has(name)) byRole.set(name, []);
    byRole.get(name)!.push(...statements.map((statement) => ({ part, statement })));
  };
  for (const [name, { part, role }] of roles) {
    for (const policy of (role.Properties?.Policies ?? []) as { PolicyDocument: PolicyDocument }[]) add(name, part, policy.PolicyDocument.Statement);
  }
  for (const part of parts) {
    for (const type of ["AWS::IAM::Policy", "AWS::IAM::ManagedPolicy"]) {
      for (const policy of Object.values(env.template(part).findResources(type)) as Resource[]) {
        const statements = (policy.Properties?.PolicyDocument as PolicyDocument).Statement;
        for (const entry of (policy.Properties?.Roles ?? []) as unknown[]) add(attachedRole(entry, part), part, statements);
      }
    }
  }
  return byRole;
}

// The buckets: logical ID → construct ID (ProjectFiles, BuildAssets, Logs).
const buckets = new Map<string, string>();
for (const part of parts) {
  for (const logicalId of Object.keys(env.template(part).findResources("AWS::S3::Bucket"))) buckets.set(logicalId, constructId(logicalId));
}

// A statement's resource as `<bucket>/<key pattern>` for objects, `<bucket>` for the bucket itself,
// or as written when it names no bucket of ours (`*` among them).
function s3Resource(resource: unknown, part: StackPart): string {
  if (typeof resource === "string") return resource;
  const bucket = references(resource)
    .map((ref) => env.tryResolve(ref, part)?.logicalId)
    .map((logicalId) => (logicalId ? buckets.get(logicalId) : undefined))
    .find(Boolean);
  if (!bucket) return String(render(resource));
  const key = objectKey(resource);
  return key === "" ? bucket : `${bucket}/${key}`;
}

// Whether an action pattern could match an S3 action: `s3:…`, or a wildcard over every service.
const mayBeS3 = (action: string) => action === "*" || action.toLowerCase().startsWith("s3:");

/**
 * One S3 permission a role's policies state: an effect, one action and one resource. A NotAction or
 * NotResource statement reaches everything it does not name, so it is kept apart (`notAction`, `notResource`).
 */
type Grant = { effect: "Allow" | "Deny"; action: string; resource: string; condition?: string; notAction?: true; notResource?: true };

/** How a grant reads in the expected list: `Allow s3:GetObject ProjectFiles/projects/*`, ` if s3:prefix fonts/*` when a condition narrows it. */
const grantLine = (g: Grant) =>
  `${g.effect} ${g.notAction ? "NotAction " : ""}${g.action} ${g.notResource ? "NotResource " : ""}${g.resource}${g.condition ? ` if ${g.condition}` : ""}`;

const conditionText = (condition: Record<string, Record<string, unknown>>) =>
  Object.values(condition)
    .flatMap((byKey) => Object.entries(byKey).map(([key, value]) => `${key} ${[render(value)].flat().join(",")}`))
    .join(" and ");

/** Each role's S3 grants, one per effect, action and resource. */
function s3Grants(): Map<string, Grant[]> {
  const grants = new Map<string, Grant[]>();
  for (const [name, statements] of statementsByRole()) {
    const found: Grant[] = [];
    for (const { part, statement } of statements) {
      const condition = statement.Condition ? conditionText(statement.Condition) : undefined;
      const actions = statement.NotAction ? [statement.NotAction].flat() : [statement.Action ?? []].flat().filter(mayBeS3);
      if (actions.length === 0) continue;
      const resources = statement.NotResource ? [JSON.stringify(render(statement.NotResource))] : [statement.Resource].flat().map((r) => s3Resource(r, part));
      for (const action of actions) {
        for (const resource of resources) {
          found.push({
            effect: statement.Effect,
            action,
            resource,
            ...(condition ? { condition } : {}),
            ...(statement.NotAction ? { notAction: true as const } : {}),
            ...(statement.NotResource ? { notResource: true as const } : {}),
          });
        }
      }
    }
    grants.set(name, found);
  }
  return grants;
}

// Managed policies AWS defines: their content isn't in the templates, so each one used is named here
// with why it grants no S3.
const AWS_MANAGED_POLICIES: Record<string, string> = {
  // CloudWatch Logs only: the custom resource that empties the VPC's default security group.
  "arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole": "logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents",
};

// What each role may do in S3, and nothing more. A new role starts with [] here.
const EXPECTED: Record<string, string[]> = {
  // The api stores Documents and register imports under projects/, and Signatures, logos and
  // Stamps under members/ and companies/ (apps/api/src/identity, RP-951), signing short-lived PUT
  // and GET links for them; it reads but never writes or deletes what only the worker writes
  // (RP-1084), and lists the bucket so a missing file answers 404, not 403 (RP-269).
  [API]: [
    "Allow s3:DeleteObject ProjectFiles/companies/*/logo/*",
    "Allow s3:DeleteObject ProjectFiles/companies/*/stamp/*",
    "Allow s3:DeleteObject ProjectFiles/members/*/signatures/*",
    "Allow s3:DeleteObject ProjectFiles/projects/*/register-imports/*",
    "Allow s3:DeleteObject ProjectFiles/projects/*/work-items/*/documents/*",
    "Allow s3:GetObject ProjectFiles/companies/*/logo/*",
    "Allow s3:GetObject ProjectFiles/companies/*/stamp/*",
    "Allow s3:GetObject ProjectFiles/members/*/signatures/*",
    "Allow s3:GetObject ProjectFiles/projects/*/register-imports/*",
    "Allow s3:GetObject ProjectFiles/projects/*/snag-reports/*",
    "Allow s3:GetObject ProjectFiles/projects/*/work-items/*/documental-record/*",
    "Allow s3:GetObject ProjectFiles/projects/*/work-items/*/documents/*",
    "Allow s3:ListBucket ProjectFiles",
    "Allow s3:PutObject ProjectFiles/companies/*/logo/*",
    "Allow s3:PutObject ProjectFiles/companies/*/stamp/*",
    "Allow s3:PutObject ProjectFiles/members/*/signatures/*",
    "Allow s3:PutObject ProjectFiles/projects/*/register-imports/*",
    "Allow s3:PutObject ProjectFiles/projects/*/work-items/*/documents/*",
    "Deny s3:DeleteObject* ProjectFiles/projects/*/snag-reports/*",
    "Deny s3:DeleteObject* ProjectFiles/projects/*/work-items/*/documental-record/*",
    "Deny s3:PutObject* ProjectFiles/projects/*/snag-reports/*",
    "Deny s3:PutObject* ProjectFiles/projects/*/work-items/*/documental-record/*",
  ],
  // The worker reads Documents, its own records and the images a record prints, writes only
  // Documental Records and Snag reports (RP-620, RP-650, RP-677), and reads the fonts and sealing certificate.
  [WORKER]: [
    "Allow s3:GetObject BuildAssets/fonts/*",
    "Allow s3:GetObject BuildAssets/sealing/*",
    "Allow s3:GetObject ProjectFiles/companies/*/logo/*",
    "Allow s3:GetObject ProjectFiles/companies/*/stamp/*",
    "Allow s3:GetObject ProjectFiles/members/*/signatures/*",
    "Allow s3:GetObject ProjectFiles/projects/*/work-items/*/documental-record/*",
    "Allow s3:GetObject ProjectFiles/projects/*/work-items/*/documents/*",
    "Allow s3:ListBucket BuildAssets if s3:prefix fonts/*",
    "Allow s3:PutObject ProjectFiles/projects/*/snag-reports/*",
    "Allow s3:PutObject ProjectFiles/projects/*/work-items/*/documental-record/*",
  ],
  // The deploy workflow builds the images with the licensed fonts.
  [DEPLOY]: ["Allow s3:GetObject BuildAssets/fonts/*", "Allow s3:ListBucket BuildAssets if s3:prefix fonts/*"],
  "rabaed-dev-github-diff": [],
  "rabaed-dev-admin-task": [],
  "rabaed-dev-rotation": [],
  "rabaed-dev-migrate-execution": [],
  "rabaed-dev-migrate-task": [],
  "app/apiTaskExecutionRole": [],
  "app/adminTaskExecutionRole": [],
  "app/webTaskExecutionRole": [],
  "app/webTaskTaskRole": [],
  "app/workerTaskExecutionRole": [],
  "network/CustomVpcRestrictDefaultSGCustomResourceProviderRole": [],
};

const grants = s3Grants();
const allows = [...grants].flatMap(([role, found]) => found.filter((g) => g.effect === "Allow").map((grant) => ({ role, grant, line: grantLine(grant) })));

describe("every IAM role's S3 grants (RP-1104)", () => {
  it("are exactly the expected list: a new role, a new grant or a wider one fails here", () => {
    const lines = Object.fromEntries([...grants].map(([role, found]) => [role, [...new Set(found.map(grantLine))].sort()]));
    expect(lines).toEqual(EXPECTED);
  });

  it("use only the AWS managed policies named here, none of which grants S3", () => {
    const used = [...roles.values()]
      .flatMap(({ role }) => (role.Properties?.ManagedPolicyArns ?? []) as unknown[])
      .map((arn) => (arn as { "Fn::Sub"?: string })["Fn::Sub"] ?? String(render(arn)));
    expect(used.length).toBeGreaterThan(0);
    for (const arn of used) expect(Object.keys(AWS_MANAGED_POLICIES)).toContain(arn);
  });

  // The account stack's two managed policies are attached to no role it defines: the boundary caps every
  // environment role, and the execution policy is the CDK bootstrap's CloudFormation role's, which creates
  // the buckets (so s3:* there; the Project files bucket policy refuses its objects to all but the api and
  // worker, storage.test.ts).
  it("leave the boundary and the CloudFormation execution policy on no stack role, the boundary capping S3 at four actions", () => {
    const unattached = parts.flatMap((part) =>
      (Object.entries(env.template(part).findResources("AWS::IAM::ManagedPolicy")) as [string, Resource][])
        .filter(([, policy]) => !policy.Properties?.Roles)
        .map(([logicalId, policy]) => ({ name: constructId(logicalId), statements: (policy.Properties?.PolicyDocument as PolicyDocument).Statement })),
    );
    expect(unattached.map((p) => p.name).sort()).toEqual(["ExecutionPolicy", "PermissionsBoundary"]);
    const boundaryS3 = unattached
      .find((p) => p.name === "PermissionsBoundary")!
      .statements.flatMap((statement) => [statement.Action ?? []].flat())
      .filter(mayBeS3)
      .sort();
    expect(boundaryS3).toEqual(["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]);
    for (const role of [API, WORKER]) expect(roles.get(role)!.role.Properties?.PermissionsBoundary).toBeDefined();
  });

  it("name each role once, so two with one construct ID can't hide each other", () => {
    const count = parts.reduce((n, part) => n + Object.keys(env.template(part).findResources("AWS::IAM::Role")).length, 0);
    expect(roles.size).toBe(count);
  });

  // A bucket policy may grant a role more than its own policies do; the list above sees only those. So no bucket
  // policy Allows a role or this account: the only Allows are on the logs bucket, to what delivers logs to it.
  it("are never widened by a bucket policy, which Allows only log delivery into the logs bucket", () => {
    const bucketAllows = parts.flatMap((part) =>
      (Object.values(env.template(part).findResources("AWS::S3::BucketPolicy")) as Resource[]).flatMap((policy) =>
        (policy.Properties?.PolicyDocument as { Statement: (Statement & { Principal?: Record<string, unknown> })[] }).Statement.filter(
          (statement) => statement.Effect === "Allow",
        ).map((statement) => ({ bucket: buckets.get(env.resolve(policy.Properties?.Bucket, part).logicalId), principal: render(statement.Principal) })),
      ),
    );
    expect(new Set(bucketAllows.map((a) => a.bucket))).toEqual(new Set(["Logs"]));
    const principals = new Set(bucketAllows.flatMap(({ principal }) => Object.entries(principal as Record<string, unknown>).flatMap(([kind, ids]) => [ids].flat().map((id) => `${kind} ${id}`))));
    expect(principals).toEqual(
      new Set([
        "Service logging.s3.amazonaws.com",
        "Service delivery.logs.amazonaws.com",
        "Service cloudtrail.amazonaws.com",
        // Elastic Load Balancing's own account for eu-central-1, which writes the load balancers' access logs.
        "AWS arn:aws:iam::054676820928:root",
      ]),
    );
  });

  describe("allow no wildcard", () => {
    it.each(allows)("$role: $line names one action, never s3:* or a pattern", ({ grant }) => {
      expect(grant.notAction).toBeUndefined();
      expect(grant.action).not.toMatch(/\*/);
    });

    it.each(allows)("$role: $line names a bucket of ours and a key prefix, never every object in it", ({ grant }) => {
      expect(grant.notResource).toBeUndefined();
      const [bucket, ...key] = grant.resource.split("/");
      expect([...buckets.values()]).toContain(bucket);
      // An object grant names a prefix: never `<bucket>/*`.
      if (key.length > 0) expect(key.join("/")).toMatch(/^[a-z-]+\//);
    });
  });
});

// What the code does in S3, role by role: one key of each kind it builds, with each action it takes on it.
// Keys the worker writes come from the shared builders (@rabaed/db/storage-keys); a Document's and a register
// import file's are built in SQL (`app.document_storage_key`, `app.register_import_file_key`), and
// packages/db/test/storage-keys-sql.test.ts checks those stay inside DOCUMENT_OBJECTS and REGISTER_IMPORT_OBJECTS.
const recordFolder = documentalRecordPrefix("p1", "w1");
const sampleKeys = {
  document: "ProjectFiles/projects/p1/work-items/w1/documents/d1",
  registerImport: "ProjectFiles/projects/p1/register-imports/i1/f1",
  signature: "ProjectFiles/members/m1/signatures/s1.png",
  logo: "ProjectFiles/companies/c1/logo/l1.png",
  stamp: "ProjectFiles/companies/c1/stamp/s1.png",
  record: `ProjectFiles/${recordFolder}record.pdf`,
  recordData: `ProjectFiles/${recordFolder}record-data.xml`,
  replacedRecord: `ProjectFiles/${recordFolder}replaced/ab12.pdf`,
  workingCopy: `ProjectFiles/${recordFolder}working-copies/c1.pdf`,
  snagReport: `ProjectFiles/${snagReportPrefix("p1")}r1/snag-report.pdf`,
  font: "BuildAssets/fonts/thmanyah/Thmanyah-Regular.ttf",
  sealingCertificate: "BuildAssets/sealing/pdf-sealing.pem",
};
const [Get, Put, Delete, List] = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"];

/** Some S3 actions a role takes, or must never take, on one resource, and why. */
type Use = { role: string; actions: string[]; resource: string; why: string };

const USES: Use[] = [
  // apps/api/src/documents: a signed PUT for the upload, HeadObject and GetObject to confirm it, a signed GET to
  // download, CopyObject (Get + Put) for Revisions and raised items, DeleteObject to roll a copy back.
  { role: API, actions: [Put, Get, Delete], resource: sampleKeys.document, why: "api documents" },
  { role: API, actions: [Put, Get, Delete], resource: sampleKeys.registerImport, why: "api register-import" },
  { role: API, actions: [Put, Get, Delete], resource: sampleKeys.signature, why: "api identity/signature.ts" },
  { role: API, actions: [Put, Get, Delete], resource: sampleKeys.logo, why: "api identity/company-image.ts" },
  { role: API, actions: [Put, Get, Delete], resource: sampleKeys.stamp, why: "api identity/company-image.ts" },
  // Signed download links only (routes/documental-record.ts, routes/working-copy.ts, work-items/snag-report.ts).
  ...[sampleKeys.record, sampleKeys.workingCopy, sampleKeys.snagReport].map((resource) => ({ role: API, actions: [Get], resource, why: "api download links" })),
  // HeadObject on a file not uploaded yet answers 404, not 403 (RP-269).
  { role: API, actions: [List], resource: "ProjectFiles", why: "api documents confirm" },

  // apps/worker/src/record: the appendix and the images a record prints; reproduce.ts reads the record it replaces.
  ...[sampleKeys.document, sampleKeys.signature, sampleKeys.logo, sampleKeys.stamp, sampleKeys.record, sampleKeys.recordData, sampleKeys.replacedRecord].map(
    (resource) => ({ role: WORKER, actions: [Get], resource, why: "worker record" }),
  ),
  ...[sampleKeys.record, sampleKeys.recordData, sampleKeys.replacedRecord, sampleKeys.workingCopy].map((resource) => ({
    role: WORKER,
    actions: [Put],
    resource,
    why: "worker record",
  })),
  { role: WORKER, actions: [Put], resource: sampleKeys.snagReport, why: "worker snag-report/job.ts" },
  // record/from-env.ts: the fonts (listed, then read) and the sealing certificate.
  { role: WORKER, actions: [Get], resource: sampleKeys.font, why: "worker fonts" },
  { role: WORKER, actions: [List], resource: "BuildAssets", why: "worker fonts" },
  { role: WORKER, actions: [Get], resource: sampleKeys.sealingCertificate, why: "worker sealing" },

  // The deploy workflow builds the images with the licensed fonts.
  { role: DEPLOY, actions: [Get], resource: sampleKeys.font, why: "deploy workflow" },
  { role: DEPLOY, actions: [List], resource: "BuildAssets", why: "deploy workflow" },
];

// What a role must never do, whatever a later grant adds: each is a leak or a lost record if it could.
const REFUSED: Use[] = [
  // RP-1084: a signed PUT or a delete with a wrong key can never overwrite or remove what only the worker writes.
  ...[sampleKeys.record, sampleKeys.recordData, sampleKeys.replacedRecord, sampleKeys.workingCopy, sampleKeys.snagReport].map((resource) => ({
    role: API,
    actions: [Put, Delete, "s3:PutObjectAcl", "s3:PutObjectTagging", "s3:DeleteObjectVersion"],
    resource,
    why: "only the worker writes it",
  })),
  { role: API, actions: [Get, Put, Delete], resource: "ProjectFiles/projects/p1/anything-else", why: "no key the code builds" },
  { role: API, actions: [Get], resource: sampleKeys.sealingCertificate, why: "the worker seals, not the api" },
  { role: WORKER, actions: [Delete], resource: sampleKeys.document, why: "the worker never deletes" },
  { role: WORKER, actions: [Delete], resource: sampleKeys.record, why: "the worker never deletes" },
  { role: WORKER, actions: [Put], resource: sampleKeys.document, why: "Documents are uploaded through the api" },
  { role: WORKER, actions: [Put], resource: sampleKeys.signature, why: "the worker only reads the images it prints" },
  { role: WORKER, actions: [Get], resource: sampleKeys.registerImport, why: "register imports are the api's alone" },
  { role: WORKER, actions: [Get, Put], resource: "ProjectFiles/projects/p1/anything-else", why: "no key the code builds" },
  { role: DEPLOY, actions: [Get], resource: sampleKeys.sealingCertificate, why: "the deploy role reads only the fonts" },
  { role: DEPLOY, actions: [Get], resource: sampleKeys.document, why: "the deploy role reads no Project files" },
];

// Whether the role's own policies let it take `action` on `resource`, as IAM decides: an Allow matches and no
// Deny does. A conditional Allow (ListBucket by prefix) counts as allowing, so a refusal here holds whatever
// the condition. A NotAction or NotResource grant would fail the wildcard checks above before it mattered here.
function roleMay(role: string, action: string, resource: string): boolean {
  const matching = (grants.get(role) ?? []).filter(
    (g) => !g.notAction && !g.notResource && iamPatternMatches(g.action, action) && iamPatternMatches(g.resource, resource),
  );
  return matching.some((g) => g.effect === "Allow") && !matching.some((g) => g.effect === "Deny");
}

const each = (uses: Use[]) => uses.flatMap((use) => use.actions.map((action) => ({ ...use, action })));

describe("the grants match what the code does in S3 (RP-1104)", () => {
  it.each(each(USES))("$role may $action $resource ($why)", ({ role, action, resource }) => {
    expect(roleMay(role, action, resource)).toBe(true);
  });

  it.each(each(REFUSED))("$role may not $action $resource: $why", ({ role, action, resource }) => {
    expect(roleMay(role, action, resource)).toBe(false);
  });

  it.each(allows)("$role: $line is used by the code, so no grant is wider than what it does", ({ role, grant }) => {
    const used = USES.filter((u) => u.role === role && u.actions.includes(grant.action) && iamPatternMatches(grant.resource, u.resource));
    expect(used).not.toEqual([]);
  });
});
