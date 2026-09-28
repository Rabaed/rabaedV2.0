import { describe, expect, it } from "vitest";
import { environments, type EnvironmentConfig } from "../src/config.ts";
import { synthesise } from "./support.ts";

const AWS_REGION = /\b(?:us|eu|ap|me|sa|ca|af|il|mx)-(?:gov-)?[a-z]+-\d\b/g;

// A second environment somewhere else, to prove the region is a parameter.
// (Not a Gulf region: CloudFormation offers no AWS::Budgets::Budget in
// me-central-1, which the production spec must plan for.)
const elsewhere: EnvironmentConfig = { ...environments.dev, name: "elsewhere", region: "eu-west-1" };

describe.each([environments.dev, elsewhere])("the $name environment", (config) => {
  const stacks = synthesise(config);

  it("creates no IAM users or access keys", () => {
    for (const { template } of stacks) {
      template.resourceCountIs("AWS::IAM::User", 0);
      template.resourceCountIs("AWS::IAM::AccessKey", 0);
    }
  });

  it("puts every stack in the configured region and names no other region", () => {
    for (const { stack, template } of stacks) {
      expect(stack.region).toBe(config.region);
      const regions = new Set(JSON.stringify(template.toJSON()).match(AWS_REGION));
      regions.delete(config.region);
      expect([...regions], stack.stackName).toEqual([]);
    }
  });
});
