import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Template } from "aws-cdk-lib/assertions";
import { environments, stackNames } from "../src/config.ts";
import { accountTemplate, render } from "./support.ts";

// GitHub's immutable subject for this repository (created after 15 July 2026):
// owner and repository IDs pinned, so a renamed or re-created repo cannot match.
// `gh api repos/Rabaed/rabaedV2.0/actions/oidc/customization/sub` shows it.
const repo = "repo:Rabaed@328426410/rabaedV2.0@1391344568";

type Statement = { Condition?: Record<string, unknown> } & Record<string, unknown>;
type PolicyDocument = { Statement: Statement[] };
type RoleResource = {
  Properties: {
    AssumeRolePolicyDocument: PolicyDocument;
    ManagedPolicyArns?: unknown[];
    PermissionsBoundary?: unknown;
    Policies?: { PolicyDocument: PolicyDocument }[];
  };
};
type PolicyResource = { Properties: { Roles: { Ref?: string }[]; PolicyDocument: PolicyDocument } };

// A role's trust policy and everything it is allowed to do, wherever CDK put it.
function role(template: Template, roleName: string) {
  const found = Object.entries(template.findResources("AWS::IAM::Role", { Properties: { RoleName: roleName } }));
  expect(found, `role ${roleName}`).toHaveLength(1);
  const [[logicalId, resource]] = found as [[string, RoleResource]];
  const policies = Object.values(template.findResources("AWS::IAM::Policy")) as PolicyResource[];
  const attached = policies.filter((policy) => policy.Properties.Roles.some((r) => r.Ref === logicalId));
  const inline = resource.Properties.Policies ?? [];
  return {
    trust: resource.Properties.AssumeRolePolicyDocument.Statement,
    managedPolicies: resource.Properties.ManagedPolicyArns ?? [],
    boundary: render(resource.Properties.PermissionsBoundary),
    permissions: [...attached.map((p) => p.Properties), ...inline].flatMap((p) => p.PolicyDocument.Statement),
  };
}

const BOUNDARY = "arn:aws:iam::${AWS::AccountId}:policy/rabaed-dev-boundary";

// The ARN pattern of a CDK bootstrap role (default qualifier) in this account and region.
function bootstrapRoleArn(kind: string) {
  return `arn:aws:iam::\${AWS::AccountId}:role/cdk-hnb659fds-${kind}-role-\${AWS::AccountId}-eu-central-1`;
}

// An ARN pattern in this account and region.
function regional(service: string, resource: string) {
  return `arn:aws:${service}:eu-central-1:\${AWS::AccountId}:${resource}`;
}

function trustsOnly(statements: Statement[], subject: string) {
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatchObject({
    Effect: "Allow",
    Action: "sts:AssumeRoleWithWebIdentity",
    Principal: { Federated: { Ref: expect.stringMatching(/^GithubOidc/) } },
    Condition: {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": subject,
      },
    },
  });
  expect(Object.keys(statements[0]?.Condition ?? {})).toEqual(["StringEquals"]);
}

describe("GitHub Actions access", () => {
  it("trusts GitHub's OIDC issuer, so no AWS keys are stored in GitHub", () => {
    accountTemplate().hasResourceProperties("AWS::IAM::OIDCProvider", {
      Url: "https://token.actions.githubusercontent.com",
      ClientIdList: ["sts.amazonaws.com"],
    });
  });

  // Not just main: any workflow on main could ask for a token. Only a job that
  // names the dev environment gets this subject, and the environment admits
  // only main (setup wizard).
  it("the deploy role trusts only this repository's dev environment", () => {
    trustsOnly(role(accountTemplate(), "rabaed-dev-github-deploy").trust, `${repo}:environment:dev`);
  });

  it("only the deploy job of the dev deploy workflow uses the dev environment", () => {
    const dir = new URL("../../../.github/workflows/", import.meta.url);
    const uses = readdirSync(dir).flatMap((file) => {
      const lines = readFileSync(new URL(file, dir), "utf8").split("\n");
      return lines.flatMap((line, i) => {
        // Any spelling (`environment: dev`, `{ name: dev }`, a `name:` block):
        // a job naming any environment at all must be this one.
        if (!/^\s+environment:/.test(line)) return [];
        const job = lines
          .slice(0, i)
          .reverse()
          .find((l) => /^ {2}[\w-]+:\s*$/.test(l));
        return [`${file} ${job?.trim()} ${line.trim()}`];
      });
    });
    expect(uses).toEqual(["deploy-dev.yml deploy: environment: dev"]);
  });

  it("the deploy role is capped by the permissions boundary, so the stacks' grants to it cannot exceed it", () => {
    expect(role(accountTemplate(), "rabaed-dev-github-deploy").boundary).toBe(BOUNDARY);
  });

  it("the deploy role can hand over to the CDK bootstrap roles, push images and run migrations, nothing more", () => {
    const deploy = role(accountTemplate(), "rabaed-dev-github-deploy");
    expect(deploy.managedPolicies).toEqual([]);
    const expected = [
      {
        Effect: "Allow",
        Action: "sts:AssumeRole",
        Resource: ["deploy", "file-publishing", "image-publishing", "lookup"].map(bootstrapRoleArn),
      },
      // Logging in to ECR has no resource-level permission.
      { Effect: "Allow", Action: "ecr:GetAuthorizationToken", Resource: "*" },
      {
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        Resource: regional("ecr", "repository/rabaed-dev/*"),
      },
      {
        Effect: "Allow",
        Action: "ecs:RunTask",
        Resource: regional("ecs", "task-definition/rabaed-dev-migrate:*"),
        Condition: { ArnEquals: { "ecs:cluster": regional("ecs", "cluster/rabaed-dev") } },
      },
      { Effect: "Allow", Action: "ecs:DescribeTasks", Resource: regional("ecs", "task/rabaed-dev/*") },
      {
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: "arn:aws:iam::${AWS::AccountId}:role/rabaed-dev-migrate-*",
        Condition: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
      },
      { Effect: "Allow", Action: "logs:GetLogEvents", Resource: regional("logs", "log-group:/rabaed/dev/migrate:*") },
    ];
    const actual = render(deploy.permissions) as unknown[];
    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expect.arrayContaining(expected));
  });

  it("the pull request role trusts only this repository's pull requests", () => {
    trustsOnly(role(accountTemplate(), "rabaed-dev-github-diff").trust, `${repo}:pull_request`);
  });

  it("the pull request role can read this environment's stack templates and the CDK bootstrap version, nothing more", () => {
    const diff = role(accountTemplate(), "rabaed-dev-github-diff");
    expect(diff.managedPolicies).toEqual([]);
    expect(render(diff.permissions)).toEqual([
      {
        Effect: "Allow",
        Action: ["cloudformation:DescribeStacks", "cloudformation:GetTemplate", "cloudformation:ListStackResources"],
        Resource: Object.values(stackNames(environments.dev))
          .sort()
          .map((stack) => regional("cloudformation", `stack/${stack}/*`)),
      },
      {
        Effect: "Allow",
        Action: "ssm:GetParameter",
        // The deploys' bootstrap, and the account stack's own (rabaedacct).
        Resource: ["hnb659fds", "rabaedacct"].map((qualifier) => regional("ssm", `parameter/cdk-bootstrap/${qualifier}/version`)),
      },
    ]);
  });

  // Code in a pull request runs with this role, so it must not reach the
  // logs bucket, CloudWatch logs or image layers, directly or through the
  // CDK lookup role (AWS ReadOnlyAccess).
  it("the pull request role cannot read logs or images, or assume another role", () => {
    const actions = role(accountTemplate(), "rabaed-dev-github-diff").permissions.flatMap((s) => [s.Action ?? [], s.NotAction ?? []].flat());
    for (const action of actions as string[]) {
      expect(action).not.toMatch(/^(s3|logs|ecr|sts):/);
      expect(action).not.toMatch(/\*/);
    }
  });
});
