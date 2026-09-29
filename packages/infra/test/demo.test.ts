import { describe, expect, it } from "vitest";
import { environments, type EnvironmentConfig } from "../src/config.ts";
import { environmentTemplates, references, resourcesOfType, type Resource } from "./support.ts";

// The demo in dev (RP-213): the migration task seeds it, the deploy's smoke
// test signs in as demo people, and their password lives in Secrets Manager.
const dev = environmentTemplates();
const demoSecretName = "rabaed/dev/demo/password";

type Container = { Environment?: { Name: string; Value: unknown }[]; Secrets?: { Name: string; ValueFrom: unknown }[] };
function migrateContainer(env: ReturnType<typeof environmentTemplates>): Container {
  const [task] = Object.values(env.template("migrations").findResources("AWS::ECS::TaskDefinition")) as Resource[];
  return (task!.Properties?.ContainerDefinitions as Container[])[0]!;
}

describe("demo", () => {
  it("dev is a demo environment", () => {
    expect(environments.dev.demo).toBe(true);
  });

  it("generates the demo people's password in Secrets Manager, never in the repo or the template", () => {
    const secrets = (Object.values(dev.template("data").findResources("AWS::SecretsManager::Secret")) as Resource[]).filter(
      (s) => s.Properties?.Name === demoSecretName,
    );
    expect(secrets).toHaveLength(1);
    expect(secrets[0]!.Properties).toHaveProperty("GenerateSecretString");
    expect(secrets[0]!.Properties).not.toHaveProperty("SecretString");
  });

  it("gives the migration task the password and marks the environment as a demo one", () => {
    const container = migrateContainer(dev);
    expect(container.Environment).toContainEqual({ Name: "RABAED_DEMO", Value: "on" });
    const injected = container.Secrets?.find((s) => s.Name === "DEMO_PASSWORD");
    expect(injected).toBeDefined();
    const secret = references(injected!.ValueFrom).map((r) => dev.tryResolve(r, "migrations")?.resource).find(Boolean);
    expect(secret?.Properties?.Name).toBe(demoSecretName);
  });

  it("names the password's secret in an output, which tells the deploy workflow to seed and check the demo", () => {
    const outputs = dev.template("migrations").toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(outputs.DemoPasswordSecret?.Value).toBe(demoSecretName);
  });

  it("lets the deploy role read the demo password (for the smoke test's sign-ins) and no other secret", () => {
    const grants = resourcesOfType(dev.synthesised, "AWS::IAM::Policy").filter((p) =>
      (p.Properties?.Roles as unknown[]).includes("rabaed-dev-github-deploy"),
    );
    const statements = grants.flatMap((p) => (p.Properties?.PolicyDocument as { Statement: { Action: unknown; Resource: unknown }[] }).Statement);
    const secretStatements = statements.filter((s) => [s.Action].flat().some((a) => String(a).startsWith("secretsmanager:")));
    expect(secretStatements).toHaveLength(1);
    expect(secretStatements[0]!.Action).toBe("secretsmanager:GetSecretValue");
    const target = dev.resolve(secretStatements[0]!.Resource, "data").resource;
    expect(target.Properties?.Name).toBe(demoSecretName);
  });

  it("an environment that is not a demo one has no demo password and cannot seed", () => {
    const production: EnvironmentConfig = { ...environments.dev, name: "prod", demo: false };
    const env = environmentTemplates(production);
    const names = resourcesOfType(env.synthesised, "AWS::SecretsManager::Secret").map((s) => s.Properties?.Name);
    expect(names.filter((n) => String(n).includes("demo"))).toEqual([]);
    const container = migrateContainer(env);
    expect(container.Environment?.map((e) => e.Name)).not.toContain("RABAED_DEMO");
    expect(container.Secrets?.map((s) => s.Name)).not.toContain("DEMO_PASSWORD");
    expect(env.template("migrations").toJSON().Outputs).not.toHaveProperty("DemoPasswordSecret");
  });
});
