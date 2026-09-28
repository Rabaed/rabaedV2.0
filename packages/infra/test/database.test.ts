import { describe, expect, it } from "vitest";
import { environmentTemplates, resourcesOfType } from "./support.ts";

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

  it("requires TLS for every connection", () => {
    const parameters = env.resolve(db.DBParameterGroupName, "data").resource;
    expect(parameters.Properties?.Parameters).toMatchObject({ "rds.force_ssl": "1" });
  });

  it("generates every password in Secrets Manager; none is in the template", () => {
    expect(JSON.stringify(db.MasterUserPassword)).toContain("resolve:secretsmanager");
    const secrets = resourcesOfType(env.synthesised, "AWS::SecretsManager::Secret");
    expect(secrets.map((s) => s.Properties?.Name).sort()).toEqual(
      ["rabaed/dev/database/master", "rabaed/dev/database/rabaed_admin", "rabaed/dev/database/rabaed_app", "rabaed/dev/database/rabaed_migrator"].sort(),
    );
    for (const secret of secrets) {
      expect(secret.Properties).not.toHaveProperty("SecretString");
      expect(secret.Properties).toHaveProperty("GenerateSecretString");
    }
  });
});
