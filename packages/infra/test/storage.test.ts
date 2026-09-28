import { describe, expect, it } from "vitest";
import { environmentTemplates, references, render, resourcesOfType, type Resource } from "./support.ts";

const env = environmentTemplates();
const storage = env.template("storage");

// Buckets by purpose (the logical ID CDK gives each).
const buckets = Object.fromEntries(
  Object.entries(storage.findResources("AWS::S3::Bucket")).map(([logicalId, resource]) => [logicalId.replace(/[0-9A-F]{8}$/, ""), resource as Resource]),
);
const bucketLogicalId = (name: string) => Object.keys(storage.findResources("AWS::S3::Bucket")).find((id) => id.startsWith(name))!;

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

  it("encrypts logs with S3-managed keys, the only encryption S3 access logs (and later load-balancer logs) can be written to", () => {
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

  it("only the api task role is granted object access, and only under projects/", () => {
    const projectBucket = bucketLogicalId("ProjectFiles");
    const grants: { role: string; resources: unknown[] }[] = [];
    for (const part of ["app", "migrations", "storage", "data", "network", "account", "registry"] as const) {
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

describe("keys", () => {
  const keys = Object.fromEntries(
    Object.entries(storage.findResources("AWS::KMS::Key")).map(([id, r]) => [id.replace(/[0-9A-F]{8}$/, ""), (r as Resource).Properties ?? {}]),
  );

  it("has a rotating customer-managed key for storage", () => {
    expect(keys.StorageKey).toMatchObject({ EnableKeyRotation: true });
  });

  it("reserves an asymmetric signing key for sealing PDFs, which nothing may use yet", () => {
    expect(keys.PdfSealingKey).toMatchObject({ KeySpec: "RSA_3072", KeyUsage: "SIGN_VERIFY" });
    const sealing = Object.keys(storage.findResources("AWS::KMS::Key")).find((id) => id.startsWith("PdfSealingKey"));
    for (const policy of resourcesOfType(env.synthesised, "AWS::IAM::Policy")) {
      expect(JSON.stringify(policy.Properties?.PolicyDocument)).not.toContain(sealing);
    }
  });
});
