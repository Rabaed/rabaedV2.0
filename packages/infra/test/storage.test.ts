import { describe, expect, it } from "vitest";
import { environments, stackNames } from "../src/config.ts";
import { environmentTemplates, references, render, type Resource } from "./support.ts";

const env = environmentTemplates();
const storage = env.template("storage");

// Resources of a type by their construct ID (the logical ID without CDK's hash).
function byName(type: string): Record<string, { logicalId: string; resource: Resource }> {
  return Object.fromEntries(
    Object.entries(storage.findResources(type)).map(([logicalId, resource]) => [logicalId.replace(/[0-9A-F]{8}$/, ""), { logicalId, resource: resource as Resource }]),
  );
}
const bucketsByName = byName("AWS::S3::Bucket");
const buckets = Object.fromEntries(Object.entries(bucketsByName).map(([name, { resource }]) => [name, resource]));
const bucketLogicalId = (name: string) => bucketsByName[name]!.logicalId;

type Statement = { Effect: string; Principal?: unknown; Action: string | string[]; Resource: unknown; Condition?: Record<string, Record<string, unknown>> };
function bucketPolicy(bucket: string): Statement[] {
  const policies = Object.values(storage.findResources("AWS::S3::BucketPolicy")) as Resource[];
  const policy = policies.find((p) => (p.Properties?.Bucket as { Ref?: string }).Ref === bucketLogicalId(bucket));
  return (policy?.Properties?.PolicyDocument as { Statement: Statement[] } | undefined)?.Statement ?? [];
}

const actions = (s: Statement) => [s.Action].flat();

describe("buckets", () => {
  it("are three: Project files, private build assets and logs", () => {
    expect(Object.keys(buckets).sort()).toEqual(["BuildAssets", "Logs", "ProjectFiles"]);
  });

  it.each(["ProjectFiles", "BuildAssets", "Logs"])("%s blocks all public access, is versioned and owner-enforced", (name) => {
    expect(buckets[name]?.Properties).toMatchObject({
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      VersioningConfiguration: { Status: "Enabled" },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
    });
    expect(buckets[name]).toMatchObject({ DeletionPolicy: "Retain" });
  });

  it.each(["ProjectFiles", "BuildAssets", "Logs"])("%s refuses any request not over TLS", (name) => {
    expect(bucketPolicy(name)).toContainEqual(
      expect.objectContaining({ Effect: "Deny", Action: "s3:*", Condition: { Bool: { "aws:SecureTransport": "false" } } }),
    );
  });

  it.each(["ProjectFiles", "BuildAssets"])("%s is encrypted with the customer-managed storage key", (name) => {
    const [rule] = (buckets[name]?.Properties?.BucketEncryption as { ServerSideEncryptionConfiguration: Record<string, unknown>[] }).ServerSideEncryptionConfiguration;
    expect(rule).toMatchObject({ ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" }, BucketKeyEnabled: true });
    const keyId = (rule as { ServerSideEncryptionByDefault: { KMSMasterKeyID: unknown } }).ServerSideEncryptionByDefault.KMSMasterKeyID;
    expect(env.resolve(keyId, "storage").logicalId).toMatch(/^StorageKey/);
  });

  it("encrypts logs with S3-managed keys, the only encryption S3 access logs and load-balancer logs can be written to", () => {
    expect(buckets.Logs?.Properties?.BucketEncryption).toEqual({
      ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
    });
  });

  it("logs every access to the Project files and build assets buckets", () => {
    for (const name of ["ProjectFiles", "BuildAssets"]) {
      const logging = buckets[name]?.Properties?.LoggingConfiguration as { DestinationBucketName: unknown; LogFilePrefix: string };
      expect(env.resolve(logging.DestinationBucketName, "storage").logicalId).toBe(bucketLogicalId("Logs"));
    }
  });
});

describe("Project files", () => {
  const apiTaskRole = "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-api-task";
  const workerTaskRole = "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-worker-task";

  it("the bucket refuses object reads and writes by anyone but the api and worker task roles", () => {
    const deny = bucketPolicy("ProjectFiles").find((s) => s.Effect === "Deny" && s.Condition?.StringNotEquals);
    expect(render(deny)).toMatchObject({
      Principal: { AWS: "*" },
      Action: expect.arrayContaining(["s3:GetObject*", "s3:PutObject*", "s3:DeleteObject*"]),
      Condition: { StringNotEquals: { "aws:PrincipalArn": [apiTaskRole, workerTaskRole] } },
    });
  });

  it("refuses signed URLs older than 15 minutes, so the api's links are short-lived", () => {
    const deny = bucketPolicy("ProjectFiles").find((s) => s.Effect === "Deny" && s.Condition?.NumericGreaterThan);
    expect(render(deny)).toMatchObject({
      Principal: { AWS: "*" },
      Action: expect.arrayContaining(["s3:GetObject", "s3:PutObject"]),
      Condition: { NumericGreaterThan: { "s3:signatureAge": 900000 } },
    });
  });

  it("lets browsers PUT and GET Documents with those URLs from the customer web's address only (RP-269)", () => {
    const cors = (template: typeof storage) =>
      render(Object.values(template.findResources("AWS::S3::Bucket")).find((b) => (b as Resource).Properties?.CorsConfiguration));
    const rule = (bucket: unknown) => (bucket as Resource).Properties!.CorsConfiguration as { CorsRules: Record<string, unknown>[] };
    expect(rule(buckets.ProjectFiles).CorsRules).toEqual([
      expect.objectContaining({ AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["content-type"] }),
    ]);
    expect(JSON.stringify(rule(buckets.ProjectFiles).CorsRules[0]!.AllowedOrigins)).toContain(".elb.amazonaws.com");
    const withDomain = environmentTemplates({ ...environments.dev, domain: "dev.example.test" }).template("storage");
    expect(rule(cors(withDomain)).CorsRules[0]!.AllowedOrigins).toEqual(["https://dev.example.test"]);
    expect(buckets.BuildAssets?.Properties?.CorsConfiguration).toBeUndefined();
  });

  it("only the api and worker task roles are granted object access: the api under projects/, the worker reading there and writing only records (RP-620)", () => {
    const projectBucket = bucketLogicalId("ProjectFiles");
    const grants: { role: string; actions: string[]; resources: unknown[] }[] = [];
    for (const part of Object.keys(stackNames(environments.dev)) as (keyof ReturnType<typeof stackNames>)[]) {
      for (const policy of Object.values(env.template(part).findResources("AWS::IAM::Policy")) as Resource[]) {
        for (const statement of (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement) {
          if (!actions(statement).some((a) => a.startsWith("s3:"))) continue;
          const onProjectFiles = references(statement.Resource).some((ref) => env.tryResolve(ref, part)?.logicalId === projectBucket);
          if (!onProjectFiles) continue;
          for (const role of policy.Properties?.Roles as unknown[]) {
            grants.push({
              role: String(env.resolve(role, part).resource.Properties?.RoleName),
              actions: actions(statement),
              resources: [statement.Resource].flat(),
            });
          }
        }
      }
    }
    expect([...new Set(grants.map((g) => g.role))].sort()).toEqual(["rabaed-dev-api-task", "rabaed-dev-worker-task"]);
    // ADR 0007: object keys start with the Project; the api's object grants cover that prefix only.
    const isList = (g: { actions: string[] }) => g.actions.includes("s3:ListBucket");
    const api = grants.filter((g) => g.role === "rabaed-dev-api-task");
    for (const resource of api.filter((g) => !isList(g)).flatMap((g) => g.resources)) {
      expect(String(render(resource))).toMatch(/\/projects\/\*$/);
    }
    // The worker reads Documents and the Signatures, logos and Stamps a record prints (RP-650), and writes
    // nothing but each item's Documental Record; it never deletes or lists.
    // (CDK merges one action's statements, so a statement may also name the build assets bucket.)
    const onBucket = (r: unknown) => references(r).some((ref) => env.tryResolve(ref, "app")?.logicalId === projectBucket);
    const worker = grants
      .filter((g) => g.role === "rabaed-dev-worker-task")
      .flatMap((g) => g.resources.filter(onBucket).map((r) => [g.actions.join(","), String(render(r))]));
    expect(worker).toHaveLength(5);
    expect(worker).toEqual(expect.arrayContaining([
      ["s3:GetObject", expect.stringMatching(/\/projects\/\*$/)],
      ["s3:GetObject", expect.stringMatching(/\/members\/\*\/signatures\/\*$/)],
      ["s3:GetObject", expect.stringMatching(/\/companies\/\*\/logo\/\*$/)],
      ["s3:GetObject", expect.stringMatching(/\/companies\/\*\/stamp\/\*$/)],
      ["s3:PutObject", expect.stringMatching(/\/projects\/\*\/work-items\/\*\/documental-record\/\*$/)],
    ]));
    // And listing, on the bucket itself, so a file not uploaded yet answers 404 rather than 403 (RP-269).
    const lists = api.filter(isList);
    expect(lists.map((g) => g.actions)).toEqual([["s3:ListBucket"]]);
    expect(env.resolve(lists[0]!.resources[0], "app").logicalId).toBe(projectBucket);
  });
});

describe("build assets", () => {
  const buildAssets = bucketLogicalId("BuildAssets");
  const storageKey = byName("AWS::KMS::Key").StorageKey!.logicalId;

  // Every IAM statement, in any stack, that names the resource, with the roles it is attached to.
  function grantsOn(logicalId: string) {
    const grants: { roles: string[]; statement: Statement }[] = [];
    for (const part of Object.keys(stackNames(environments.dev)) as (keyof ReturnType<typeof stackNames>)[]) {
      for (const policy of Object.values(env.template(part).findResources("AWS::IAM::Policy")) as Resource[]) {
        for (const statement of (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement) {
          if (!references(statement.Resource).some((ref) => env.tryResolve(ref, part)?.logicalId === logicalId)) continue;
          // A role from another stack is attached by name.
          const roles = (policy.Properties?.Roles as unknown[]).map((role) =>
            typeof role === "string" ? role : String(env.resolve(role, part).resource.Properties?.RoleName),
          );
          grants.push({ roles, statement });
        }
      }
    }
    return grants;
  }

  it("only the deploy role and the worker may read the build assets bucket", () => {
    expect([...new Set(grantsOn(buildAssets).flatMap((g) => g.roles))].sort()).toEqual(["rabaed-dev-github-deploy", "rabaed-dev-worker-task"]);
  });

  it("the worker reads the fonts and the sealing certificate, and lists only the fonts (RP-620)", () => {
    const grants = grantsOn(buildAssets).filter((g) => g.roles.includes("rabaed-dev-worker-task"));
    const byAction = Object.fromEntries(grants.map(({ statement }) => [String(statement.Action), statement]));
    expect(Object.keys(byAction).sort()).toEqual(["s3:GetObject", "s3:ListBucket"]);
    // (CDK merges the worker's reads into one statement, the Project files' included.)
    const onBuildAssets = (r: unknown) => references(r).some((ref) => env.tryResolve(ref, "app")?.logicalId === buildAssets);
    expect([byAction["s3:GetObject"]!.Resource].flat().filter(onBuildAssets).map((r) => String(render(r)))).toEqual([
      expect.stringMatching(/\/fonts\/\*$/),
      expect.stringMatching(/\/sealing\/\*$/),
    ]);
    expect(byAction["s3:ListBucket"]!.Condition).toEqual({ StringLike: { "s3:prefix": "fonts/*" } });
  });

  it("the deploy role, which builds the images, can read only the fonts/ prefix of the build assets bucket", () => {
    const grants = grantsOn(buildAssets).filter((g) => g.roles.includes("rabaed-dev-github-deploy"));
    expect(grants.flatMap((g) => g.roles)).toEqual(["rabaed-dev-github-deploy", "rabaed-dev-github-deploy"]);
    const byAction = Object.fromEntries(grants.map(({ statement }) => [String(statement.Action), statement]));
    expect(Object.keys(byAction).sort()).toEqual(["s3:GetObject", "s3:ListBucket"]);

    // Objects: under fonts/ only.
    expect(String(render(byAction["s3:GetObject"]!.Resource))).toMatch(/\/fonts\/\*$/);
    expect(byAction["s3:GetObject"]!.Condition).toBeUndefined();
    // Listing: the bucket itself, and only keys under fonts/.
    expect(env.resolve(byAction["s3:ListBucket"]!.Resource, "storage").logicalId).toBe(buildAssets);
    expect(byAction["s3:ListBucket"]!.Condition).toEqual({ StringLike: { "s3:prefix": "fonts/*" } });
  });

  it("the deploy role may decrypt with the storage key only through S3, for the build assets bucket", () => {
    // (The api's task role uses the key too, for Project files.)
    const grants = grantsOn(storageKey).filter((g) => g.roles.includes("rabaed-dev-github-deploy"));
    expect(grants).toHaveLength(1);
    const statement = grants[0]!.statement;
    expect(statement).toMatchObject({ Effect: "Allow", Action: "kms:Decrypt" });
    const condition = statement.Condition as { StringEquals: Record<string, unknown> };
    expect(Object.keys(condition)).toEqual(["StringEquals"]);
    expect(condition.StringEquals["kms:ViaService"]).toBe("s3.eu-central-1.amazonaws.com");
    // With S3 bucket keys, the encryption context is the bucket's ARN.
    const bucketArn = condition.StringEquals["kms:EncryptionContext:aws:s3:arn"];
    expect(env.resolve(bucketArn, "storage").logicalId).toBe(buildAssets);
  });

  it("names the bucket in an output, for the setup wizard and the deploy workflow", () => {
    const outputs = storage.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(env.resolve(outputs.BuildAssetsBucket?.Value, "storage").logicalId).toBe(buildAssets);
  });
});

describe("keys", () => {
  const keysByName = byName("AWS::KMS::Key");
  const keys = Object.fromEntries(Object.entries(keysByName).map(([name, { resource }]) => [name, resource.Properties ?? {}]));

  it("has a rotating customer-managed key for storage", () => {
    expect(keys.StorageKey).toMatchObject({ EnableKeyRotation: true });
  });

  it("has an asymmetric signing key for sealing the Documental Records, with which only the worker may sign (RP-620)", () => {
    expect(keys.PdfSealingKey).toMatchObject({ KeySpec: "RSA_3072", KeyUsage: "SIGN_VERIFY" });
    const sealing = keysByName.PdfSealingKey!.logicalId;
    const uses: { roles: string[]; actions: string[] }[] = [];
    for (const part of Object.keys(stackNames(environments.dev)) as (keyof ReturnType<typeof stackNames>)[]) {
      for (const policy of Object.values(env.template(part).findResources("AWS::IAM::Policy")) as Resource[]) {
        for (const statement of (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement) {
          if (!references(statement.Resource).some((ref) => env.tryResolve(ref, part)?.logicalId === sealing)) continue;
          const roles = (policy.Properties?.Roles as unknown[]).map((role) => String(env.resolve(role, part).resource.Properties?.RoleName));
          uses.push({ roles, actions: actions(statement) });
        }
      }
    }
    expect(uses).toEqual([{ roles: ["rabaed-dev-worker-task"], actions: ["kms:Sign"] }]);
  });

  it("its key policy refuses kms:Sign to every principal but the worker's task role, whatever IAM grants", () => {
    const policy = keysByName.PdfSealingKey!.resource.Properties?.KeyPolicy as { Statement: Statement[] };
    const deny = policy.Statement.filter((s) => s.Effect === "Deny");
    expect(render(deny)).toEqual([
      expect.objectContaining({
        Principal: { AWS: "*" },
        Action: "kms:Sign",
        Resource: "*",
        Condition: { StringNotEquals: { "aws:PrincipalArn": "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-worker-task" } },
      }),
    ]);
  });

  it("carries the tag the permissions boundary allows kms:Sign by", () => {
    expect(keys.PdfSealingKey!.Tags).toContainEqual({ Key: "rabaed-purpose", Value: "pdf-sealing" });
    expect(keys.StorageKey!.Tags ?? []).not.toContainEqual({ Key: "rabaed-purpose", Value: "pdf-sealing" });
  });
});
