import { describe, expect, it } from "vitest";
import { environments, stackNames } from "../src/config.ts";
import { environmentTemplates, references, render, resourcesOfType, type Resource } from "./support.ts";

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

  it("the bucket refuses object reads and writes by anyone but the api task role", () => {
    const deny = bucketPolicy("ProjectFiles").find((s) => s.Effect === "Deny" && s.Condition?.StringNotEquals);
    expect(render(deny)).toMatchObject({
      Principal: { AWS: "*" },
      Action: expect.arrayContaining(["s3:GetObject*", "s3:PutObject*", "s3:DeleteObject*"]),
      Condition: { StringNotEquals: { "aws:PrincipalArn": apiTaskRole } },
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

  it("only the api task role is granted object access, and only under projects/", () => {
    const projectBucket = bucketLogicalId("ProjectFiles");
    const grants: { role: string; resources: unknown[] }[] = [];
    for (const part of Object.keys(stackNames(environments.dev)) as (keyof ReturnType<typeof stackNames>)[]) {
      for (const policy of Object.values(env.template(part).findResources("AWS::IAM::Policy")) as Resource[]) {
        for (const statement of (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement) {
          if (!actions(statement).some((a) => a.startsWith("s3:"))) continue;
          const onProjectFiles = references(statement.Resource).some((ref) => env.tryResolve(ref, part)?.logicalId === projectBucket);
          if (!onProjectFiles) continue;
          for (const role of policy.Properties?.Roles as unknown[]) {
            grants.push({ role: String(env.resolve(role, part).resource.Properties?.RoleName), resources: [statement.Resource].flat() });
          }
        }
      }
    }
    expect(grants.map((g) => g.role)).toEqual(["rabaed-dev-api-task"]);
    // ADR 0007: object keys start with the Project; the api's grant covers that prefix only.
    for (const resource of grants[0]!.resources) expect(String(render(resource))).toMatch(/\/projects\/\*$/);
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

  it("the deploy role, which builds the images, can read only the fonts/ prefix of the build assets bucket", () => {
    const grants = grantsOn(buildAssets);
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

  it("reserves an asymmetric signing key for sealing PDFs, which nothing may use yet", () => {
    expect(keys.PdfSealingKey).toMatchObject({ KeySpec: "RSA_3072", KeyUsage: "SIGN_VERIFY" });
    const sealing = keysByName.PdfSealingKey!.logicalId;
    for (const policy of resourcesOfType(env.synthesised, "AWS::IAM::Policy")) {
      expect(JSON.stringify(policy.Properties?.PolicyDocument)).not.toContain(sealing);
    }
  });
});
