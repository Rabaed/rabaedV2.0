import { CfnResource, RemovalPolicy, Stack, type IAspect } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";
import { resourceNames, type EnvironmentConfig } from "./config.ts";

// CDK adds Lambda functions of its own for custom resources (e.g. the one that
// empties the default security group). Left alone, Lambda creates their log
// groups on first run, with no retention. This points every function in a
// stack at one log group the stack creates first, with the environment's
// retention. (Secrets Manager's hosted rotation Lambdas are not in the
// template; the data stack names them and creates their groups.)
export class LambdaLogGroups implements IAspect {
  constructor(private readonly config: EnvironmentConfig) {}

  visit(node: IConstruct): void {
    if (!(node instanceof CfnResource) || node.cfnResourceType !== "AWS::Lambda::Function") return;
    const stack = Stack.of(node);
    const id = "LambdaLogs";
    const group =
      (stack.node.tryFindChild(id) as logs.LogGroup | undefined) ??
      new logs.LogGroup(stack, id, {
        logGroupName: resourceNames(this.config).lambdaLogGroup(stack.stackName),
        retention: this.config.logRetentionDays as logs.RetentionDays,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    node.addPropertyOverride("LoggingConfig.LogGroup", group.logGroupName);
    node.node.addDependency(group);
  }
}
