import type { Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { resourceNames, type EnvironmentConfig } from "./config.ts";

/**
 * Grants the GitHub deploy role (account stack) more, by name, in the stack
 * that holds what it reaches; the permissions boundary still caps it.
 */
export function grantToDeployRole(stack: Stack, config: EnvironmentConfig, id: string, statements: iam.PolicyStatement[]): iam.Policy {
  const deployRole =
    (stack.node.tryFindChild("DeployRole") as iam.IRole | undefined) ?? iam.Role.fromRoleName(stack, "DeployRole", resourceNames(config).deployRole);
  return new iam.Policy(stack, id, { roles: [deployRole], statements });
}
