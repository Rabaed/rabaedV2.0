import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { resourceNames, type EnvironmentConfig } from "./config.ts";
import { grantToDeployRole } from "./deploy-grants.ts";

export interface StorageStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/** Project files live under this prefix, then the Project's `project_id` (ADR 0007). */
export const PROJECT_FILES_PREFIX = "projects/";

/** The licensed fonts in the build assets bucket; the Thmanyah files go under `fonts/thmanyah/`. */
export const FONTS_PREFIX = "fonts/";

// Files and the keys that protect them. Every bucket is private, versioned,
// owner-enforced (no ACLs) and refuses requests not made over TLS.
//
// - Project files: encrypted with the storage key. Only the api's task role
//   can read or write objects, only under projects/, and the bucket policy
//   refuses everyone else, administrators included. Browsers get files
//   through signed URLs the api creates, refused once 15 minutes old.
// - Build assets: private files the build needs. The setup wizard uploads
//   the licensed Thmanyah fonts under fonts/; the deploy workflow, which
//   builds the images, may read that prefix and nothing else (RP-211).
// - Logs: S3 access logs of the other two buckets, the load balancer's
//   access logs (under load-balancer/) and CloudTrail's audit trail (under
//   cloudtrail/), kept for a year. Encrypted with S3-managed keys, because
//   neither S3 access logs nor load-balancer logs can be written to a
//   KMS-encrypted bucket.
export class StorageStack extends Stack {
  readonly storageKey: kms.Key;
  readonly projectFiles: s3.Bucket;
  readonly buildAssets: s3.Bucket;
  readonly logs: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const { config } = props;
    const names = resourceNames(config);

    this.storageKey = new kms.Key(this, "StorageKey", {
      alias: names.keyAlias("storage"),
      description: `Encrypts ${names.prefix} Project files and build assets`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Reserved: sealing issued PDFs (a digital signature) comes later. Nothing may use it yet.
    new kms.Key(this, "PdfSealingKey", {
      alias: names.keyAlias("pdf-sealing"),
      description: `Reserved for sealing ${names.prefix} PDFs; not used yet`,
      keySpec: kms.KeySpec.RSA_3072,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const privateBucket: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    };

    const logs = (this.logs = new s3.Bucket(this, "Logs", {
      ...privateBucket,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: Duration.days(365), noncurrentVersionExpiration: Duration.days(30) }],
    }));

    // Old versions are kept: recovering an overwritten or deleted file is what versioning is for.
    const encryptedBucket = (id: string, logPrefix: string) =>
      new s3.Bucket(this, id, {
        ...privateBucket,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: this.storageKey,
        bucketKeyEnabled: true,
        serverAccessLogsBucket: logs,
        serverAccessLogsPrefix: logPrefix,
      });
    this.projectFiles = encryptedBucket("ProjectFiles", "project-files/");
    this.buildAssets = encryptedBucket("BuildAssets", "build-assets/");

    // By name, not by reference: the api's role lives in the app stack, which
    // depends on this one.
    const apiTaskRole = `arn:${this.partition}:iam::${this.account}:role/${names.apiTaskRole}`;
    this.projectFiles.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "OnlyTheApiReadsAndWritesProjectFiles",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject*", "s3:PutObject*", "s3:DeleteObject*", "s3:RestoreObject"],
        resources: [this.projectFiles.arnForObjects("*")],
        conditions: { StringNotEquals: { "aws:PrincipalArn": apiTaskRole } },
      }),
    );
    // The deploy role (account stack) builds the web image, which bundles the
    // fonts. Granted here, by name, next to the bucket and key it reads.
    grantToDeployRole(this, config, "DeployReadsFonts", [
      new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [this.buildAssets.arnForObjects(`${FONTS_PREFIX}*`)] }),
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [this.buildAssets.bucketArn],
        conditions: { StringLike: { "s3:prefix": `${FONTS_PREFIX}*` } },
      }),
      // With bucket keys, S3 asks KMS in the bucket's name, not the object's.
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [this.storageKey.keyArn],
        conditions: {
          StringEquals: {
            "kms:ViaService": `s3.${this.region}.amazonaws.com`,
            "kms:EncryptionContext:aws:s3:arn": this.buildAssets.bucketArn,
          },
        },
      }),
    ]);
    new CfnOutput(this, "BuildAssetsBucket", { value: this.buildAssets.bucketName });

    // A signed URL carries the api role's permissions until it expires; S3 refuses it after 15 minutes whatever expiry it was signed with.
    this.projectFiles.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "SignedUrlsAreShortLived",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [this.projectFiles.arnForObjects("*")],
        conditions: { NumericGreaterThan: { "s3:signatureAge": 15 * 60 * 1000 } },
      }),
    );
  }
}
