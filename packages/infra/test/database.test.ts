import { describe, expect, it } from "vitest";
import { environmentTemplates, references, resourcesOfType } from "./support.ts";

const env = environmentTemplates();
const [database] = resourcesOfType(env.synthesised, "AWS::RDS::DBInstance");
const db = database?.Properties ?? {};

describe("database", () => {
  it("is PostgreSQL 16, single-AZ in dev", () => {
    expect(resourcesOfType(env.synthesised, "AWS::RDS::DBInstance")).toHaveLength(1);
    expect(db.Engine).toBe("postgres");
    expect(db.EngineVersion).toMatch(/^16(\.|$)/);
    expect(db.MultiAZ).toBe(false);
  });

  it("is never publicly reachable and lives in the isolated subnets", () => {
    expect(db.PubliclyAccessible).toBe(false);
    const subnetGroup = env.resolve(db.DBSubnetGroupName, "data").resource;
    const subnets = subnetGroup.Properties?.SubnetIds as unknown[];
    expect(subnets.length).toBeGreaterThanOrEqual(2);
    for (const subnet of subnets) expect(env.subnetType(subnet, "data")).toBe("Isolated");
  });

  it("is encrypted with a customer-managed key that rotates", () => {
    expect(db.StorageEncrypted).toBe(true);
    const key = env.resolve(db.KmsKeyId, "data").resource;
    expect(key.Type).toBe("AWS::KMS::Key");
    expect(key.Properties?.EnableKeyRotation).toBe(true);
  });

  it("has fixed storage in dev, with no autoscaling (kept inside AWS's Free plan limits)", () => {
    expect(db.AllocatedStorage).toBe("20");
    expect(db).not.toHaveProperty("MaxAllocatedStorage");
  });

  it("keeps automated backups and cannot be deleted by accident", () => {
    // One day in dev: the account is on AWS's Free plan, which refuses more.
    expect(db.BackupRetentionPeriod).toBe(1);
    expect(db.DeletionProtection).toBe(true);
    expect(database).toMatchObject({ DeletionPolicy: "Snapshot", UpdateReplacePolicy: "Snapshot" });
  });

  it("keeps the database security group as deployed: a new description would replace it, which the database refuses", () => {
    const groups = Object.entries(env.template("network").findResources("AWS::EC2::SecurityGroup"));
    const [logicalId, group] = groups.find(([id]) => id.startsWith("DatabaseSecurityGroup"))!;
    expect(logicalId).toBe("DatabaseSecurityGroup7319C0F6");
    expect((group as { Properties: { GroupDescription: string } }).Properties.GroupDescription).toBe("PostgreSQL: reachable from api, worker and migrations only");
  });

  it("requires TLS for every connection", () => {
    const parameters = env.resolve(db.DBParameterGroupName, "data").resource;
    expect(parameters.Properties?.Parameters).toMatchObject({ "rds.force_ssl": "1" });
  });

  // The role secrets live under roles/: when they became JSON secrets they were
  // replaced, and CloudFormation creates a replacement before deleting the old
  // one, so the new ones needed new names.
  it("generates every password in Secrets Manager; none is in the template", () => {
    expect(JSON.stringify(db.MasterUserPassword)).toContain("resolve:secretsmanager");
    const secrets = resourcesOfType(env.synthesised, "AWS::SecretsManager::Secret");
    expect(secrets.map((s) => s.Properties?.Name).sort()).toEqual(
      [
        "rabaed/dev/database/master",
        "rabaed/dev/database/roles/rabaed_admin",
        "rabaed/dev/database/roles/rabaed_app",
        "rabaed/dev/database/roles/rabaed_migrator",
        // The demo people's password (demo.test.ts): dev is a demo environment.
        "rabaed/dev/demo/password",
      ].sort(),
    );
    for (const secret of secrets) {
      expect(secret.Properties).not.toHaveProperty("SecretString");
      expect(secret.Properties).toHaveProperty("GenerateSecretString");
    }
  });

  it("keeps each role's credentials as the JSON the rotation needs: its own username, and the database", () => {
    const templates = Object.fromEntries(
      resourcesOfType(env.synthesised, "AWS::SecretsManager::Secret")
        .filter((s) => String(s.Properties?.Name).startsWith("rabaed/dev/database/"))
        .map((s) => [
          s.Properties?.Name,
          JSON.parse((s.Properties?.GenerateSecretString as { SecretStringTemplate: string }).SecretStringTemplate),
        ]),
    );
    expect(templates["rabaed/dev/database/roles/rabaed_app"]).toMatchObject({ username: "rabaed_app", dbname: "rabaed" });
    expect(templates["rabaed/dev/database/roles/rabaed_admin"]).toMatchObject({ username: "rabaed_admin", dbname: "rabaed" });
    expect(templates["rabaed/dev/database/roles/rabaed_migrator"]).toMatchObject({ username: "rabaed_migrator", dbname: "rabaed" });
    expect(templates["rabaed/dev/database/master"]).toMatchObject({ username: "rabaed_master" });
    // Host, port and engine come from attaching each secret to the instance.
    expect(resourcesOfType(env.synthesised, "AWS::SecretsManager::SecretTargetAttachment")).toHaveLength(4);
  });

  it("rotates every database password every 30 days, from inside the VPC", () => {
    const schedules = resourcesOfType(env.synthesised, "AWS::SecretsManager::RotationSchedule");
    expect(schedules).toHaveLength(4);
    const rotated = new Set<string>();
    for (const { Properties: p } of schedules) {
      const secret = env.resolve(p?.SecretId, "data").resource;
      const target = secret.Type === "AWS::SecretsManager::SecretTargetAttachment" ? env.resolve(secret.Properties?.SecretId, "data").resource : secret;
      rotated.add(target.Properties?.Name as string);
      expect(p).toMatchObject({
        RotationRules: { ScheduleExpression: "rate(30 days)" },
        // The roles only exist once the migration task has run, so no rotation on creation.
        RotateImmediatelyOnUpdate: false,
        HostedRotationLambda: { RotationType: "PostgreSQLSingleUser" },
      });
      const lambda = p?.HostedRotationLambda as { VpcSubnetIds: unknown; VpcSecurityGroupIds: unknown };
      const subnets = references(lambda.VpcSubnetIds);
      expect(subnets.length).toBeGreaterThanOrEqual(2);
      for (const subnet of subnets) expect(env.subnetType(subnet, "data")).toBe("Private");
      expect(env.resolve(lambda.VpcSecurityGroupIds, "data").logicalId).toMatch(/^RotationSecurityGroup/);
    }
    expect([...rotated].sort()).toEqual(
      ["rabaed/dev/database/master", "rabaed/dev/database/roles/rabaed_admin", "rabaed/dev/database/roles/rabaed_app", "rabaed/dev/database/roles/rabaed_migrator"].sort(),
    );
  });
});
