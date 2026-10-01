import { describe, expect, it } from "vitest";
import { environmentTemplates, render, resourcesOfType } from "./support.ts";

const env = environmentTemplates();
const registry = env.template("registry");

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type Policy = { Roles: unknown[]; PolicyDocument: { Statement: Statement[] } };

// The deploy workflow records the last version that passed its checks in an
// SSM parameter, and redeploys it when a later version fails them (RP-246).
describe("last good version", () => {
  it("is written only by the workflow: no stack owns the parameter, so no stack update can reset it", () => {
    expect(resourcesOfType(env.synthesised, "AWS::SSM::Parameter")).toEqual([]);
  });

  it("the deploy role may read and write that parameter, nothing more", () => {
    const policies = (Object.values(registry.findResources("AWS::IAM::Policy")) as { Properties: Policy }[]).map((p) => p.Properties);
    const granted = policies.filter((p) => String(render(p.Roles)).includes("rabaed-dev-github-deploy"));
    expect(granted).toHaveLength(1);
    expect(render(granted[0]!.PolicyDocument.Statement)).toEqual([
      {
        Effect: "Allow",
        Action: ["ssm:GetParameter", "ssm:PutParameter"],
        Resource: "arn:aws:ssm:eu-central-1:${AWS::AccountId}:parameter/rabaed/dev/deploy/last-good-version",
      },
    ]);
  });
});
