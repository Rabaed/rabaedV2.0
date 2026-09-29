import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { resourceNames, type EnvironmentConfig } from "./config.ts";
import { DATABASE_PORT, type NetworkStack } from "./network-stack.ts";

// The database roles every Instance runs with (packages/db/src/config.ts).
export const databaseRoles = ["rabaed_migrator", "rabaed_app", "rabaed_admin"] as const;
export type DatabaseRole = (typeof databaseRoles)[number];

/** The database the app's roles use; created by the migration task's bootstrap. */
export const DATABASE_NAME = "rabaed";

export interface DataStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly network: NetworkStack;
}

// Characters a generated or rotated password never contains (RDS's own
// default list), so no password needs quoting anywhere.
const EXCLUDED_CHARACTERS = " %+~`#$&*()|[]{}:;<>?!'/@\"\\";

// PostgreSQL and its credentials. The RDS master user only bootstraps: it
// creates the three roles and the database (packages/db/src/bootstrap.ts),
// which the migration task runs before every deploy.
//
// Every password is a JSON secret (username, password, host, database) that
// Secrets Manager rotates every 30 days: a Lambda in the VPC signs in as the
// role and changes its own password. api and worker read the current password
// when they connect (packages/db/src/rotating-password.ts), so a rotation
// needs no restart; the migration task gets it at start.
export class DataStack extends Stack {
  readonly database: rds.DatabaseInstance;
  /** The RDS master user's secret (JSON with `username` and `password`). */
  readonly masterSecret: secretsmanager.ISecret;
  /** One secret per database role (JSON with `username` and `password`). */
  readonly roleSecrets: Record<DatabaseRole, secretsmanager.ISecret>;
  /** Every demo person's sign-in password; demo environments only. */
  readonly demoPassword?: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, network } = props;
    const names = resourceNames(config);

    const key = new kms.Key(this, "DatabaseKey", {
      alias: `alias/rabaed-${config.name}-database`,
      description: `Encrypts the rabaed-${config.name} database and its backups`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 });
    this.database = new rds.DatabaseInstance(this, "Database", {
      engine,
      instanceType: new ec2.InstanceType(config.database.instanceType),
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [network.securityGroups.database],
      port: DATABASE_PORT,
      publiclyAccessible: false,
      multiAz: config.database.multiAz,
      storageType: rds.StorageType.GP3,
      allocatedStorage: config.database.allocatedStorageGb,
      maxAllocatedStorage: config.database.maxAllocatedStorageGb,
      storageEncrypted: true,
      storageEncryptionKey: key,
      credentials: rds.Credentials.fromGeneratedSecret("rabaed_master", {
        secretName: `${names.secretPrefix}database/master`,
        excludeCharacters: EXCLUDED_CHARACTERS,
      }),
      parameterGroup: new rds.ParameterGroup(this, "Parameters", {
        engine,
        description: `rabaed-${config.name}: TLS only`,
        parameters: { "rds.force_ssl": "1" },
      }),
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      backupRetention: Duration.days(config.database.backupRetentionDays),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      copyTagsToSnapshot: true,
    });
    this.masterSecret = this.database.secret!;

    // Attached to the instance, which adds its host, port and engine: what the rotation needs.
    const roleSecret = (role: DatabaseRole) =>
      new rds.DatabaseSecret(this, `${role}Secret`, {
        username: role,
        dbname: DATABASE_NAME,
        // Under roles/: these replaced plain-password secrets of the old names, and
        // CloudFormation creates a replacement before deleting what it replaces.
        secretName: `${names.secretPrefix}database/roles/${role}`,
        excludeCharacters: EXCLUDED_CHARACTERS,
      }).attach(this.database);
    this.roleSecrets = Object.fromEntries(databaseRoles.map((role) => [role, roleSecret(role)])) as Record<DatabaseRole, secretsmanager.ISecret>;

    // Named, so its log group can be created first, with a retention: Lambda
    // would otherwise create one that keeps logs forever.
    const rotate = (id: string, secret: secretsmanager.ISecret) => {
      const functionName = names.rotationFunction(id);
      const logGroup = new logs.LogGroup(this, `${id}RotationLogs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: config.logRetentionDays,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const schedule = new secretsmanager.RotationSchedule(this, `${id}Rotation`, {
        secret,
        hostedRotation: secretsmanager.HostedRotation.postgreSqlSingleUser({
          functionName,
          vpc: network.vpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          securityGroups: [network.securityGroups.rotation],
          excludeCharacters: EXCLUDED_CHARACTERS,
        }),
        automaticallyAfter: Duration.days(30),
        // The roles exist only once the migration task has run after the first deploy.
        rotateImmediatelyOnUpdate: false,
      });
      schedule.node.addDependency(logGroup);
    };
    rotate("master", this.masterSecret);
    for (const role of databaseRoles) rotate(role, this.roleSecrets[role]);

    // The demo people's one password (demo environments only). The migration
    // task seeds with it; the deploy role reads it for the smoke test, which
    // signs in as demo people to check visibility through the load balancer.
    if (config.demo) {
      this.demoPassword = new secretsmanager.Secret(this, "DemoPassword", {
        secretName: names.demoPasswordSecret,
        description: `Sign-in password of every demo person in rabaed-${config.name} (demo data only)`,
        generateSecretString: { passwordLength: 32, excludePunctuation: true },
      });
      // Granted here, by name, next to the secret: the deploy role is in the account stack.
      new iam.Policy(this, "DeployReadsDemoPassword", {
        roles: [iam.Role.fromRoleName(this, "DeployRole", names.deployRole)],
        statements: [new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [this.demoPassword.secretArn] })],
      });
    }
  }
}
