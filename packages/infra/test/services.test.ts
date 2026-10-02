import { describe, expect, it } from "vitest";
import { environments, stackNames } from "../src/config.ts";
import { environmentTemplates, references, resourcesOfType, type Resource } from "./support.ts";

const env = environmentTemplates();
type Part = keyof ReturnType<typeof stackNames>;

type Container = {
  Name: string;
  Image: unknown;
  Command?: string[];
  WorkingDirectory?: string;
  Environment?: { Name: string; Value: unknown }[];
  Secrets?: { Name: string; ValueFrom: unknown }[];
  HealthCheck?: { Command: string[] };
  LogConfiguration?: { Options: Record<string, unknown> };
};

// Task definitions by family (rabaed-dev-web, …), with the stack they are in.
const taskDefinitions = new Map<string, { part: Part; properties: Record<string, unknown> }>();
for (const part of ["app", "migrations"] as const) {
  for (const resource of Object.values(env.template(part).findResources("AWS::ECS::TaskDefinition")) as Resource[]) {
    taskDefinitions.set(resource.Properties?.Family as string, { part, properties: resource.Properties ?? {} });
  }
}

function container(family: string): Container {
  const containers = taskDefinitions.get(family)?.properties.ContainerDefinitions as Container[] | undefined;
  expect(containers, family).toHaveLength(1);
  return containers![0]!;
}

// The name of the Secrets Manager secret a value refers to.
function secretName(value: unknown, part: Part): string {
  for (const ref of references(value)) {
    let target = env.tryResolve(ref, part);
    // RDS attaches its generated secret to the instance; follow the attachment to the secret.
    if (target?.resource.Type === "AWS::SecretsManager::SecretTargetAttachment") {
      target = env.resolve(target.resource.Properties?.SecretId, "data");
    }
    if (target?.resource.Type === "AWS::SecretsManager::Secret") return target.resource.Properties?.Name as string;
  }
  throw new Error(`no secret in ${JSON.stringify(value)}`);
}

// Secrets injected into the container, as env name → secret name[:field].
function injectedSecrets(family: string): Record<string, string> {
  const { part } = taskDefinitions.get(family)!;
  return Object.fromEntries(
    (container(family).Secrets ?? []).map(({ Name, ValueFrom }) => {
      const field = JSON.stringify(ValueFrom).match(/:(username|password)::/)?.[1];
      return [Name, field ? `${secretName(ValueFrom, part)}:${field}` : secretName(ValueFrom, part)];
    }),
  );
}

type Statement = { Action: string | string[]; Resource: unknown };

/** Like secretName, but undefined for a resource that is not a secret. */
function safeSecretName(value: unknown, part: Part): string | undefined {
  try {
    return secretName(value, part);
  } catch {
    return undefined;
  }
}

// Secrets the task definition's execution role, task role, or either may read.
function readableSecrets(family: string, which: "execution" | "task" | "any" = "any"): string[] {
  const { part, properties } = taskDefinitions.get(family)!;
  const chosen = { execution: [properties.ExecutionRoleArn], task: [properties.TaskRoleArn], any: [properties.ExecutionRoleArn, properties.TaskRoleArn] }[which];
  const roles = chosen.filter(Boolean).map((r) => env.resolve(r, part).logicalId);
  const policies = Object.values(env.template(part).findResources("AWS::IAM::Policy")) as Resource[];
  const names = new Set<string>();
  for (const policy of policies) {
    const attached = (policy.Properties?.Roles as { Ref: string }[]).some((r) => roles.includes(r.Ref));
    if (!attached) continue;
    for (const statement of (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement) {
      const actions = [statement.Action].flat();
      if (!actions.some((a) => a.startsWith("secretsmanager:"))) continue;
      for (const resource of [statement.Resource].flat()) names.add(secretName(resource, part));
    }
  }
  return [...names].sort();
}

function repositoryOf(family: string): string {
  const { part } = taskDefinitions.get(family)!;
  const repos = references(container(family).Image)
    .map((ref) => env.tryResolve(ref, part)?.resource)
    .filter((r) => r?.Type === "AWS::ECR::Repository");
  expect(repos.length, family).toBeGreaterThan(0);
  return repos[0]!.Properties?.RepositoryName as string;
}

const MASTER = "rabaed/dev/database/master";
const APP = "rabaed/dev/database/roles/rabaed_app";
const ADMIN = "rabaed/dev/database/roles/rabaed_admin";
const MIGRATOR = "rabaed/dev/database/roles/rabaed_migrator";
const DEMO = "rabaed/dev/demo/password";

describe("container images", () => {
  it("has one private ECR repository per service, scanned on push, with immutable tags", () => {
    const repos = resourcesOfType(env.synthesised, "AWS::ECR::Repository");
    expect(repos.map((r) => r.Properties?.RepositoryName).sort()).toEqual(["rabaed-dev/admin", "rabaed-dev/api", "rabaed-dev/web", "rabaed-dev/worker"]);
    for (const repo of repos) {
      expect(repo.Properties).toMatchObject({ ImageScanningConfiguration: { ScanOnPush: true }, ImageTagMutability: "IMMUTABLE" });
    }
  });

  it("runs each service from its own repository; migrations run from the api image", () => {
    expect(Object.fromEntries([...taskDefinitions.keys()].sort().map((family) => [family, repositoryOf(family)]))).toEqual({
      "rabaed-dev-admin": "rabaed-dev/admin",
      "rabaed-dev-api": "rabaed-dev/api",
      "rabaed-dev-migrate": "rabaed-dev/api",
      "rabaed-dev-web": "rabaed-dev/web",
      "rabaed-dev-worker": "rabaed-dev/worker",
    });
  });

  it("tags every image with the deployed commit and reports it as APP_VERSION", () => {
    for (const family of taskDefinitions.keys()) {
      const c = container(family);
      expect(JSON.stringify(c.Image), family).toContain('{"Ref":"ImageTag"}');
      expect(c.Environment, family).toContainEqual({ Name: "APP_VERSION", Value: { Ref: "ImageTag" } });
    }
  });

  it("takes the image tag at deploy time, with no default", () => {
    for (const part of ["app", "migrations"] as const) {
      const parameter = env.template(part).toJSON().Parameters.ImageTag;
      expect(parameter).toMatchObject({ Type: "String" });
      expect(parameter).not.toHaveProperty("Default");
    }
  });
});

// The customer load balancer and Rabaed Admin's own one (ADR 0010).
const app = env.template("app");
const loadBalancers = app.findResources("AWS::ElasticLoadBalancingV2::LoadBalancer") as Record<string, Resource>;
const loadBalancerId = (prefix: string) => Object.keys(loadBalancers).find((id) => new RegExp(`^${prefix}[0-9A-F]{8}$`).test(id))!;
const listenersOf = (prefix: string) =>
  (Object.values(app.findResources("AWS::ElasticLoadBalancingV2::Listener")) as Resource[]).filter(
    (l) => (l.Properties?.LoadBalancerArn as { Ref: string }).Ref === loadBalancerId(prefix),
  );
const targetGroupId = (listener: Resource | undefined) => {
  const [action] = listener?.Properties?.DefaultActions as { Type: string; TargetGroupArn: { Ref: string } }[];
  expect(action?.Type).toBe("forward");
  return action!.TargetGroupArn.Ref;
};
/** The task family of the ECS service that registers into a target group. */
const familyBehind = (groupId: string) => {
  const services = Object.values(app.findResources("AWS::ECS::Service")) as Resource[];
  const service = services.find((svc) =>
    (svc.Properties?.LoadBalancers as { TargetGroupArn: { Ref: string } }[] | undefined)?.some((lb) => lb.TargetGroupArn.Ref === groupId),
  );
  return env.resolve(service?.Properties?.TaskDefinition, "app").resource.Properties?.Family;
};

describe("load balancer", () => {
  const listeners = listenersOf("LoadBalancer");

  it("listens on HTTPS with a modern TLS policy and the certificate given at deploy time", () => {
    const https = listeners.find((l) => l.Properties?.Port === 443);
    expect(https?.Properties).toMatchObject({
      Protocol: "HTTPS",
      SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      Certificates: [{ CertificateArn: { Ref: "CertificateArn" } }],
    });
    expect(app.toJSON().Parameters.CertificateArn).not.toHaveProperty("Default");
  });

  it("answers HTTP only with a permanent redirect to HTTPS", () => {
    const http = listeners.find((l) => l.Properties?.Port === 80);
    expect(http?.Properties).toMatchObject({
      Protocol: "HTTP",
      DefaultActions: [{ Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" } }],
    });
    expect(listeners).toHaveLength(2);
  });

  it("forwards HTTPS to web, which it health-checks", () => {
    const group = targetGroupId(listeners.find((l) => l.Properties?.Port === 443));
    expect(app.toJSON().Resources[group].Properties).toMatchObject({ Port: 3000, Protocol: "HTTP", TargetType: "ip", HealthCheckPath: "/api/health" });
    expect(familyBehind(group)).toBe("rabaed-dev-web");
  });

  it("drops invalid headers, on every load balancer", () => {
    const all = resourcesOfType(env.synthesised, "AWS::ElasticLoadBalancingV2::LoadBalancer");
    expect(all).toHaveLength(2);
    for (const alb of all) {
      expect(alb.Properties?.LoadBalancerAttributes).toContainEqual({ Key: "routing.http.drop_invalid_header_fields.enabled", Value: "true" });
    }
  });
});

describe("Rabaed Admin's load balancer", () => {
  const listeners = listenersOf("AdminLoadBalancer");

  it("is its own, facing the internet, at its own address", () => {
    const id = loadBalancerId("AdminLoadBalancer");
    expect(id).toBeDefined();
    expect(id).not.toBe(loadBalancerId("LoadBalancer"));
    expect(loadBalancers[id]!.Properties?.Scheme).toBe("internet-facing");
    const outputs = app.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(JSON.stringify(outputs.AdminUrl?.Value)).toContain(id);
  });

  it("listens on HTTPS only, with the same TLS policy and certificate", () => {
    expect(listeners.map((l) => l.Properties)).toEqual([
      expect.objectContaining({
        Port: 443,
        Protocol: "HTTPS",
        SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
        Certificates: [{ CertificateArn: { Ref: "CertificateArn" } }],
      }),
    ]);
  });

  it("forwards to Rabaed Admin only, which it health-checks; the customer load balancer never reaches it", () => {
    const group = targetGroupId(listeners[0]);
    expect(app.toJSON().Resources[group].Properties).toMatchObject({ Port: 4050, Protocol: "HTTP", TargetType: "ip", HealthCheckPath: "/health" });
    expect(familyBehind(group)).toBe("rabaed-dev-admin");
    expect(resourcesOfType(env.synthesised, "AWS::ElasticLoadBalancingV2::TargetGroup")).toHaveLength(2);
  });
});

describe("services", () => {
  const services = resourcesOfType(env.synthesised, "AWS::ECS::Service");
  const familyOf = (service: Resource) => env.resolve(service.Properties?.TaskDefinition, "app").resource.Properties?.Family;

  it("runs web, api, Rabaed Admin and worker on Fargate at the configured fixed sizes", () => {
    const sizes = Object.fromEntries(
      services.map((s) => {
        const family = familyOf(s) as string;
        const { Cpu, Memory } = taskDefinitions.get(family)!.properties;
        return [family, { launchType: s.Properties?.LaunchType, desired: s.Properties?.DesiredCount, cpu: Cpu, memory: Memory }];
      }),
    );
    expect(sizes).toEqual({
      "rabaed-dev-web": { launchType: "FARGATE", desired: 1, cpu: "256", memory: "1024" },
      "rabaed-dev-api": { launchType: "FARGATE", desired: 1, cpu: "256", memory: "512" },
      "rabaed-dev-admin": { launchType: "FARGATE", desired: 1, cpu: "256", memory: "512" },
      "rabaed-dev-worker": { launchType: "FARGATE", desired: 1, cpu: "256", memory: "512" },
    });
  });

  it("deploys by rolling update and rolls back a deploy that never becomes healthy", () => {
    for (const service of services) {
      expect(service.Properties?.DeploymentConfiguration, familyOf(service) as string).toMatchObject({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
      });
    }
  });

  it("health-checks the api and Rabaed Admin containers through their /health endpoints, which need the database", () => {
    expect(container("rabaed-dev-api").HealthCheck?.Command.join(" ")).toContain("http://127.0.0.1:4000/health");
    expect(container("rabaed-dev-admin").HealthCheck?.Command.join(" ")).toContain("http://127.0.0.1:4050/health");
  });

  it("web reaches the api by its private name", () => {
    expect(container("rabaed-dev-web").Environment).toContainEqual({ Name: "API_URL", Value: "http://api.rabaed-dev.internal:4000" });
    const [namespace] = resourcesOfType(env.synthesised, "AWS::ServiceDiscovery::PrivateDnsNamespace");
    expect(namespace?.Properties?.Name).toBe("rabaed-dev.internal");
    // Rabaed Admin has no private name: nothing inside reaches it, only its load balancer.
    const discovery = resourcesOfType(env.synthesised, "AWS::ServiceDiscovery::Service");
    expect(discovery.map((d) => d.Properties?.Name)).toEqual(["api"]);
  });

  it("Rabaed Admin links invitations to the customer web's address", () => {
    const webUrl = container("rabaed-dev-admin").Environment?.find((e) => e.Name === "WEB_URL")?.Value;
    expect(JSON.stringify(webUrl)).toContain(loadBalancerId("LoadBalancer"));
  });

  it("sends secure session cookies", () => {
    for (const family of ["rabaed-dev-api", "rabaed-dev-admin"]) {
      expect(container(family).Environment, family).toContainEqual({ Name: "SESSION_COOKIE_SECURE", Value: "true" });
    }
  });

  it("logs every container to its own log group, kept for a month", () => {
    const groups = resourcesOfType(env.synthesised, "AWS::Logs::LogGroup").filter((g) =>
      String(g.Properties?.LogGroupName).startsWith("/rabaed/dev/") && !String(g.Properties?.LogGroupName).includes("/lambda/"),
    );
    expect(groups.map((g) => g.Properties?.LogGroupName).sort()).toEqual(
      ["/rabaed/dev/admin", "/rabaed/dev/api", "/rabaed/dev/migrate", "/rabaed/dev/web", "/rabaed/dev/worker"],
    );
    for (const group of groups) expect(group.Properties?.RetentionInDays).toBe(30);
    for (const family of taskDefinitions.keys()) {
      expect(container(family).LogConfiguration?.Options, family).toMatchObject({ "awslogs-group": expect.anything() });
    }
  });
});

describe("secrets", () => {
  // api and worker run for weeks, so they read their (rotating) passwords
  // through their task role when connecting; the environment names the secret.
  function secretEnvironment(family: string): Record<string, string> {
    const { part } = taskDefinitions.get(family)!;
    return Object.fromEntries(
      (container(family).Environment ?? []).filter((e) => e.Name.endsWith("_SECRET_ARN")).map((e) => [e.Name, secretName(e.Value, part)]),
    );
  }

  it("tells api, Rabaed Admin and worker which secrets hold their database passwords", () => {
    expect(secretEnvironment("rabaed-dev-web")).toEqual({});
    expect(secretEnvironment("rabaed-dev-api")).toEqual({ DATABASE_APP_SECRET_ARN: APP });
    expect(secretEnvironment("rabaed-dev-admin")).toEqual({ DATABASE_ADMIN_SECRET_ARN: ADMIN });
    expect(secretEnvironment("rabaed-dev-worker")).toEqual({ DATABASE_APP_SECRET_ARN: APP });
  });

  it("lets each service's task role read only its own secrets; only Rabaed Admin's the admin one", () => {
    expect(readableSecrets("rabaed-dev-web")).toEqual([]);
    expect(readableSecrets("rabaed-dev-api", "task")).toEqual([APP]);
    expect(readableSecrets("rabaed-dev-admin", "task")).toEqual([ADMIN]);
    expect(readableSecrets("rabaed-dev-worker", "task")).toEqual([APP]);
    for (const family of ["rabaed-dev-api", "rabaed-dev-admin", "rabaed-dev-worker", "rabaed-dev-web"]) {
      expect(readableSecrets(family, "execution"), family).toEqual([]);
      expect(injectedSecrets(family), family).toEqual({});
    }
  });

  it("injects the passwords into the one-off migration task at start", () => {
    expect(injectedSecrets("rabaed-dev-migrate")).toEqual({
      DATABASE_SUPERUSER_USERNAME: `${MASTER}:username`,
      DATABASE_SUPERUSER_PASSWORD: `${MASTER}:password`,
      DATABASE_MIGRATOR_PASSWORD: `${MIGRATOR}:password`,
      DATABASE_APP_PASSWORD: `${APP}:password`,
      DATABASE_ADMIN_PASSWORD: `${ADMIN}:password`,
      // Dev is a demo environment: the task also seeds the demo (demo.test.ts).
      DEMO_PASSWORD: DEMO,
    });
    expect(readableSecrets("rabaed-dev-migrate")).toEqual([ADMIN, MASTER, DEMO, APP, MIGRATOR].sort());
  });

  // ADR 0010: the role that bypasses row-level security is out of the customer api's reach.
  it("lets no role read the admin secret but Rabaed Admin's task role and the migration task's, which creates the roles", () => {
    const readers: string[] = [];
    for (const { stack, template } of env.synthesised) {
      const part = (Object.entries(stackNames(environments.dev)).find(([, name]) => name === stack.stackName)?.[0] ?? "") as Part;
      for (const policy of Object.values(template.findResources("AWS::IAM::Policy")) as Resource[]) {
        const statements = (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement;
        const readsAdmin = statements.some(
          (st) => [st.Action].flat().some((a) => a.startsWith("secretsmanager:")) && [st.Resource].flat().some((r) => safeSecretName(r, part) === ADMIN),
        );
        if (!readsAdmin) continue;
        for (const role of policy.Properties?.Roles as { Ref: string }[]) readers.push(String(env.resolve(role, part).resource.Properties?.RoleName));
      }
    }
    expect(readers.sort()).toEqual(["rabaed-dev-admin-task", "rabaed-dev-migrate-execution"]);
  });

  it("puts no password in plain environment variables", () => {
    for (const family of taskDefinitions.keys()) {
      const names = (container(family).Environment ?? []).map((e) => e.Name);
      // Allowed: API_URL and WEB_URL (addresses), secret ARNs (not secret), and DATABASE_ROLE_PASSWORDS (a mode, "on-create").
      const allowed = (n: string) => ["API_URL", "WEB_URL", "DATABASE_ROLE_PASSWORDS"].includes(n) || n.endsWith("_SECRET_ARN");
      expect(names.filter((n) => /PASSWORD|SECRET|_URL$/.test(n) && !allowed(n)), family).toEqual([]);
    }
  });
});

describe("Project files", () => {
  it("the api knows its bucket; nothing else does", () => {
    const names = (family: string) => (container(family).Environment ?? []).map((e) => e.Name);
    expect(names("rabaed-dev-api")).toContain("PROJECT_FILES_BUCKET");
    for (const family of ["rabaed-dev-web", "rabaed-dev-admin", "rabaed-dev-worker", "rabaed-dev-migrate"]) {
      expect(names(family)).not.toContain("PROJECT_FILES_BUCKET");
    }
  });
});

describe("migrations", () => {
  it("leave role passwords to rotation once the roles exist", () => {
    expect(container("rabaed-dev-migrate").Environment).toContainEqual({ Name: "DATABASE_ROLE_PASSWORDS", Value: "on-create" });
  });

  it("run the database setup (roles, then migrations) from the api image", () => {
    const c = container("rabaed-dev-migrate");
    expect(c.WorkingDirectory).toBe("/app/packages/db");
    expect(c.Command).toEqual(["./node_modules/.bin/tsx", "src/setup.ts"]);
  });

  it("use roles whose names the deploy role may pass, and nothing else may", () => {
    const { part, properties } = taskDefinitions.get("rabaed-dev-migrate")!;
    for (const role of [properties.ExecutionRoleArn, properties.TaskRoleArn]) {
      expect(env.resolve(role, part).resource.Properties?.RoleName).toMatch(/^rabaed-dev-migrate-/);
    }
    for (const family of ["rabaed-dev-web", "rabaed-dev-api", "rabaed-dev-admin", "rabaed-dev-worker"]) {
      const { properties: p } = taskDefinitions.get(family)!;
      for (const role of [p.ExecutionRoleArn, p.TaskRoleArn]) {
        expect(String(env.resolve(role, "app").resource.Properties?.RoleName ?? "")).not.toMatch(/^rabaed-dev-migrate-/);
      }
    }
  });
});
