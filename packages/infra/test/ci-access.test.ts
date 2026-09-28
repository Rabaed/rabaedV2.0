import { describe, expect, it } from "vitest";
import type { Template } from "aws-cdk-lib/assertions";
import { accountTemplate, render } from "./support.ts";

const repo = "repo:Rabaed/rabaedV2.0";

type Statement = { Condition?: Record<string, unknown> } & Record<string, unknown>;
type PolicyDocument = { Statement: Statement[] };
type RoleResource = {
  Properties: { AssumeRolePolicyDocument: PolicyDocument; ManagedPolicyArns?: unknown[]; Policies?: { PolicyDocument: PolicyDocument }[] };
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
    permissions: [...attached.map((p) => p.Properties), ...inline].flatMap((p) => p.PolicyDocument.Statement),
  };
}

// The ARN pattern of a CDK bootstrap role (default qualifier) in this account and region.
function bootstrapRoleArn(kind: string) {
  return `arn:aws:iam::\${AWS::AccountId}:role/cdk-hnb659fds-${kind}-role-\${AWS::AccountId}-eu-central-1`;
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

  it("the deploy role trusts only this repository's main branch", () => {
    trustsOnly(role(accountTemplate(), "rabaed-dev-github-deploy").trust, `${repo}:ref:refs/heads/main`);
  });

  it("the deploy role can only hand over to the CDK bootstrap roles", () => {
    const deploy = role(accountTemplate(), "rabaed-dev-github-deploy");
    expect(deploy.managedPolicies).toEqual([]);
    expect(render(deploy.permissions)).toEqual([
      {
        Effect: "Allow",
        Action: "sts:AssumeRole",
        Resource: ["deploy", "file-publishing", "image-publishing", "lookup"].map(bootstrapRoleArn),
      },
    ]);
  });

  it("the pull request role trusts only this repository's pull requests", () => {
    trustsOnly(role(accountTemplate(), "rabaed-dev-github-diff").trust, `${repo}:pull_request`);
  });

  it("the pull request role is read-only: it can only assume the CDK lookup role", () => {
    const diff = role(accountTemplate(), "rabaed-dev-github-diff");
    expect(diff.managedPolicies).toEqual([]);
    expect(render(diff.permissions)).toEqual([{ Effect: "Allow", Action: "sts:AssumeRole", Resource: bootstrapRoleArn("lookup") }]);
  });
});
