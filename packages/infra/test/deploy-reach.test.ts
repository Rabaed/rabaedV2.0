import { describe, expect, it } from "vitest";
import { accountTemplate, environmentTemplates, render, type Resource } from "./support.ts";

// What a deploy can reach (RP-242). GitHub's deploy role hands over to the CDK
// bootstrap roles, whose CloudFormation execution role runs with the policy
// below instead of AdministratorAccess. It may create and change only roles
// that carry the permissions boundary, which caps what any of them can do.

const env = environmentTemplates();
const account = accountTemplate();
// Every stack the deploy workflow deploys: all but the account stack.
const deployed = env.synthesised.filter(({ stack }) => stack.stackName !== "Rabaed-dev-Account");

const BOUNDARY = "arn:aws:iam::${AWS::AccountId}:policy/rabaed-dev-boundary";
// Named ones, and the ones CloudFormation names after their stack.
const ENVIRONMENT_ROLES = ["Rabaed-dev-*", "rabaed-dev-*"].map((name) => `arn:aws:iam::\${AWS::AccountId}:role/${name}`);
const GITHUB_ROLES = "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-github-*";

type Statement = {
  Effect: "Allow" | "Deny";
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  Condition?: Record<string, Record<string, unknown>>;
};

const list = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function managedPolicy(name: string): Statement[] {
  const found = Object.values(account.findResources("AWS::IAM::ManagedPolicy", { Properties: { ManagedPolicyName: name } })) as Resource[];
  expect(found, `managed policy ${name}`).toHaveLength(1);
  return render((found[0]!.Properties?.PolicyDocument as { Statement: unknown[] }).Statement) as Statement[];
}

const execution = managedPolicy("rabaed-dev-cfn-execution");
const boundary = managedPolicy("rabaed-dev-boundary");

// IAM's wildcards (* any run, ? one character); action names ignore case.
function matches(pattern: string, value: string): boolean {
  const regex = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i").test(value);
}

const allowed = (statements: Statement[]) => statements.filter((s) => s.Effect === "Allow");
const actions = (statements: Statement[]) => statements.flatMap((s) => list(s.Action));
const allowsAction = (statements: Statement[], action: string) =>
  allowed(statements).some((s) => list(s.Action).some((pattern) => matches(pattern, action)));
const service = (action: string) => action.split(":")[0]!;

// The IAM service prefix whose API creates a CloudFormation resource type.
function serviceOf(type: string): string[] {
  if (type.startsWith("Custom::")) return ["lambda"];
  const namespace = type.split("::")[1]!;
  if (namespace === "ElasticLoadBalancingV2") return ["elasticloadbalancing"];
  // A Serverless Application Repository app becomes a nested stack.
  if (namespace === "Serverless") return ["serverlessrepo", "cloudformation"];
  return [namespace.toLowerCase()];
}

describe("the account stack", () => {
  // The deploy role may assume only the default-qualifier bootstrap roles
  // (ci-access.test.ts), so a deploy can never change the account stack: its
  // own GitHub trust, the boundary or the execution policy.
  it("is deployed through its own CDK bootstrap, the others through the deploys' one", () => {
    const bootstrapVersion = (parameters: Record<string, { Default?: string }> | undefined) => parameters?.BootstrapVersion?.Default;
    expect(bootstrapVersion(account.toJSON().Parameters)).toBe("/cdk-bootstrap/rabaedacct/version");
    for (const { stack, template } of deployed) {
      expect(bootstrapVersion(template.toJSON().Parameters), stack.stackName).toBe("/cdk-bootstrap/hnb659fds/version");
    }
  });
});

describe("CloudFormation execution policy (no AdministratorAccess)", () => {
  it("allows only the services the deployed stacks use", () => {
    expect([...new Set(actions(allowed(execution)).map(service))].sort()).toEqual([
      "cloudformation",
      "cloudtrail",
      "cloudwatch",
      "ec2",
      "ecr",
      "ecs",
      "elasticloadbalancing",
      "iam",
      "kms",
      "lambda",
      "logs",
      "rds",
      "route53",
      "s3",
      "secretsmanager",
      "serverlessrepo",
      "servicediscovery",
      "ses",
      "ssm",
    ]);
    for (const action of actions(execution)) expect(action).not.toBe("*");
  });

  it("covers every resource type the deployed stacks create", () => {
    const types = new Set(deployed.flatMap(({ template }) => Object.values(template.toJSON().Resources as Record<string, Resource>).map((r) => r.Type)));
    types.delete("AWS::CDK::Metadata");
    for (const type of types) {
      for (const prefix of serviceOf(type)) {
        expect(
          actions(allowed(execution)).some((a) => service(a) === prefix),
          `${type} needs ${prefix}`,
        ).toBe(true);
      }
    }
  });

  it("creates and changes only this environment's roles, and only while they carry the boundary", () => {
    const iam = allowed(execution).filter((s) => actions([s]).some((a) => service(a) === "iam"));
    for (const statement of iam) {
      const writes = actions([statement]).filter((a) => !/^iam:(Get|List)/.test(a));
      if (writes.length > 0 && writes.every((a) => a === "iam:CreateServiceLinkedRole")) {
        // Only for the services that need one, the first time they are used.
        expect(statement.Condition).toEqual({
          StringEquals: { "iam:AWSServiceName": ["ecs.amazonaws.com", "elasticloadbalancing.amazonaws.com", "rds.amazonaws.com"] },
        });
        continue;
      }
      expect(list(statement.Resource)).toEqual(ENVIRONMENT_ROLES);
      expect(actions([statement])).not.toContain("iam:*");
    }
    // Creating a role or giving it permissions needs the boundary on it.
    // Taking permissions away does not: it never widens anything.
    for (const action of ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:PutRolePermissionsBoundary"]) {
      const granting = iam.filter((s) => list(s.Action).includes(action));
      expect(granting, action).toHaveLength(1);
      expect(granting[0]!.Condition, action).toEqual({ StringEquals: { "iam:PermissionsBoundary": BOUNDARY } });
    }
    // Managed policies (the boundary and this policy among them) are not its to change.
    expect(actions(iam).filter((a) => /Policy(Version)?$/.test(a) && !/Role/.test(a))).toEqual([]);
  });

  it("can never take a boundary off, nor change the GitHub roles beyond their inline grants", () => {
    const denied = execution.filter((s) => s.Effect === "Deny");
    expect(denied).toContainEqual(expect.objectContaining({ Effect: "Deny", Action: "iam:DeleteRolePermissionsBoundary", Resource: "*" }));
    // The stacks grant the deploy role (bounded) what it reads next to the
    // resource; its trust, boundary and managed policies stay the account stack's.
    expect(denied).toContainEqual(
      expect.objectContaining({
        Effect: "Deny",
        NotAction: ["iam:DeleteRolePolicy", "iam:GetRole", "iam:GetRolePolicy", "iam:PutRolePolicy"],
        Resource: GITHUB_ROLES,
      }),
    );
  });

  it("deploys only this environment's stacks, and reads only the rotation app and the bootstrap version", () => {
    const scoped = (prefix: string) => allowed(execution).filter((s) => actions([s]).some((a) => service(a) === prefix));
    expect(scoped("cloudformation")).toMatchObject([
      { Action: "cloudformation:*", Resource: "arn:aws:cloudformation:eu-central-1:${AWS::AccountId}:stack/Rabaed-dev-*" },
      // The data stack's nested rotation stacks come through the Serverless transform.
      { Action: "cloudformation:CreateChangeSet", Resource: "arn:aws:cloudformation:eu-central-1:aws:transform/Serverless-2016-10-31" },
    ]);
    for (const statement of scoped("serverlessrepo")) {
      expect(statement.Resource).toBe("arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSPostgreSQLRotationSingleUser");
      for (const action of actions([statement])) expect(action).toMatch(/^serverlessrepo:(Get|CreateCloudFormationTemplate)/);
    }
    expect(scoped("ssm")).toMatchObject([
      {
        Effect: "Allow",
        Action: "ssm:GetParameters",
        Resource: "arn:aws:ssm:eu-central-1:${AWS::AccountId}:parameter/cdk-bootstrap/hnb659fds/version",
      },
    ]);
  });
});

describe("permissions boundary", () => {
  it("is on every role the deployed stacks create", () => {
    const roles = deployed.flatMap(({ stack, template }) =>
      Object.entries(template.findResources("AWS::IAM::Role")).map(([id, role]) => ({ id: `${stack.stackName}/${id}`, role: role as Resource })),
    );
    expect(roles.length).toBeGreaterThan(0);
    for (const { id, role } of roles) expect(render(role.Properties?.PermissionsBoundary), id).toBe(BOUNDARY);
  });

  // Otherwise a role would be created, but fail when it is used.
  it("allows every action the stacks grant to a role", () => {
    // AWS managed policies CDK attaches, and what they allow.
    const managed: Record<string, string[]> = {
      "service-role/AWSLambdaBasicExecutionRole": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
    };
    // Every role of the deployed stacks, and the deploy role of the account
    // stack; the pull request role is not bounded (it cannot write at all).
    const deployRole = Object.keys(account.findResources("AWS::IAM::Role", { Properties: { RoleName: "rabaed-dev-github-deploy" } }));
    const bounded = (resource: Resource, stack: string) =>
      stack !== "Rabaed-dev-Account" ||
      (resource.Type === "AWS::IAM::Role"
        ? resource.Properties?.RoleName === "rabaed-dev-github-deploy"
        : list(resource.Properties?.Roles as { Ref?: string }[]).some((r) => deployRole.includes(r.Ref ?? "")));
    const granted = env.synthesised.flatMap(({ stack, template }) => {
      const resources = Object.values(template.toJSON().Resources as Record<string, Resource>).filter((r) => bounded(r, stack.stackName));
      const policies = resources.filter((r) => r.Type === "AWS::IAM::Policy").map((r) => r.Properties?.PolicyDocument);
      const roles = resources.filter((r) => r.Type === "AWS::IAM::Role");
      const inline = roles.flatMap((r) => list(r.Properties?.Policies as { PolicyDocument: unknown }[] | undefined).map((p) => p.PolicyDocument));
      const attached = roles.flatMap((r) =>
        list(r.Properties?.ManagedPolicyArns).flatMap((arn) => {
          // CDK spells these with Fn::Sub.
          const text = (arn as { "Fn::Sub"?: string })["Fn::Sub"] ?? String(render(arn));
          const name = text.split(":policy/")[1]!;
          expect(managed, `managed policy ${name}`).toHaveProperty([name]);
          return managed[name]!;
        }),
      );
      const statements = [...policies, ...inline].flatMap((doc) => (doc as { Statement: Statement[] }).Statement);
      return [...actions(allowed(statements)), ...attached];
    });
    expect(granted.length).toBeGreaterThan(0);
    for (const action of new Set(granted)) expect(allowsAction(boundary, action), action).toBe(true);
  });

  it("lets no role change IAM, or assume any role but the CDK bootstrap roles; IAM it may only read, to simulate the two task roles", () => {
    for (const action of actions(boundary)) {
      expect(action).not.toMatch(/^[^:]*$|:\*$/);
    }
    for (const statement of boundary) {
      const iamOrSts = actions([statement]).filter((a) => ["iam", "sts"].includes(service(a)));
      if (iamOrSts.length === 0) continue;
      expect(statement.Effect).toBe("Allow");
      if (iamOrSts.includes("iam:PassRole")) {
        expect(statement).toMatchObject({ Effect: "Allow", Action: "iam:PassRole", Resource: ENVIRONMENT_ROLES });
      } else if (iamOrSts.includes("iam:SimulatePrincipalPolicy")) {
        // The deploy's admin secret access check (ADR 0010).
        expect(statement).toMatchObject({ Effect: "Allow", Action: "iam:SimulatePrincipalPolicy" });
        expect(list(statement.Resource as string[]).sort()).toEqual([
          "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-admin-task",
          "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-api-task",
        ]);
      } else {
        expect(statement).toMatchObject({
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Resource: "arn:aws:iam::${AWS::AccountId}:role/cdk-hnb659fds-*",
        });
      }
    }
  });
});
