import { CfnOutput, Fn, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { resourceNames, type EnvironmentConfig } from "./config.ts";
import type { DataStack } from "./data-stack.ts";
import type { NetworkStack } from "./network-stack.ts";
import type { RegistryStack } from "./registry-stack.ts";
import { databaseEnvironment, imageTagParameter, taskDefinition } from "./task.ts";

export interface MigrationsStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly registry: RegistryStack;
}

// The one-off migration task. The deploy workflow deploys this stack with the
// new image, runs the task, and deploys the app only if it exits 0, so the
// schema is always migrated before new code takes traffic.
//
// It runs packages/db/src/setup.ts: bootstrap (roles and database, as the RDS
// master user) and then the migrations, as rabaed_migrator.
export class MigrationsStack extends Stack {
  constructor(scope: Construct, id: string, props: MigrationsStackProps) {
    super(scope, id, props);
    const { config, network, data, registry } = props;
    const names = resourceNames(config);

    // Named, so the GitHub deploy role may pass these roles (and only these) to ECS.
    const ecsTasks = new iam.ServicePrincipal("ecs-tasks.amazonaws.com");
    const executionRole = new iam.Role(this, "ExecutionRole", { roleName: `${names.migrationRolePrefix}execution`, assumedBy: ecsTasks });
    const taskRole = new iam.Role(this, "TaskRole", { roleName: `${names.migrationRolePrefix}task`, assumedBy: ecsTasks });

    const task = taskDefinition(this, {
      config,
      name: "migrate",
      size: config.migrationTask,
      repository: registry.repositories.api,
      imageTag: imageTagParameter(this),
      environment: databaseEnvironment(data),
      secrets: {
        DATABASE_SUPERUSER_USERNAME: ecs.Secret.fromSecretsManager(data.masterSecret, "username"),
        DATABASE_SUPERUSER_PASSWORD: ecs.Secret.fromSecretsManager(data.masterSecret, "password"),
        DATABASE_MIGRATOR_PASSWORD: ecs.Secret.fromSecretsManager(data.roleSecrets.rabaed_migrator),
        DATABASE_APP_PASSWORD: ecs.Secret.fromSecretsManager(data.roleSecrets.rabaed_app),
        DATABASE_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(data.roleSecrets.rabaed_admin),
      },
      workingDirectory: "/app/packages/db",
      command: ["./node_modules/.bin/tsx", "src/setup.ts"],
      executionRole,
      taskRole,
    });

    // What `aws ecs run-task` needs; read by the deploy workflow.
    const subnets = network.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
    new CfnOutput(this, "Cluster", { value: network.cluster.clusterName });
    new CfnOutput(this, "TaskDefinition", { value: task.taskDefinitionArn });
    new CfnOutput(this, "Subnets", { value: Fn.join(",", subnets) });
    new CfnOutput(this, "SecurityGroup", { value: network.securityGroups.migrations.securityGroupId });
    new CfnOutput(this, "LogGroup", { value: names.logGroup("migrate") });
  }
}
