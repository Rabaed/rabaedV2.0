import { CfnParameter, RemovalPolicy, type Stack } from "aws-cdk-lib";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import type * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { resourceNames, type EnvironmentConfig, type ServiceName, type ServiceSize } from "./config.ts";
import { DATABASE_NAME, type DataStack } from "./data-stack.ts";

/** Where the images put the RDS certificate bundle (see Dockerfile). */
const RDS_CA_BUNDLE = "/etc/ssl/rds/global-bundle.pem";

/**
 * The commit to deploy, given at deploy time. Images are tagged with it and
 * report it as APP_VERSION, so the smoke test can check what is running.
 */
export function imageTagParameter(stack: Stack): CfnParameter {
  return new CfnParameter(stack, "ImageTag", {
    type: "String",
    description: "Commit SHA of the images to run",
    allowedPattern: "^[0-9a-f]{7,40}$",
  });
}

/** How api, worker and migrations reach the database; packages/db builds the URLs from these. */
export function databaseEnvironment(data: DataStack): Record<string, string> {
  return {
    DATABASE_HOST: data.database.dbInstanceEndpointAddress,
    DATABASE_PORT: data.database.dbInstanceEndpointPort,
    DATABASE_NAME,
    DATABASE_SSL_ROOT_CERT: RDS_CA_BUNDLE,
  };
}

export interface TaskProps {
  readonly config: EnvironmentConfig;
  /** web, api, worker, or migrate (which runs the api image). */
  readonly name: ServiceName | "migrate";
  readonly size: Omit<ServiceSize, "desiredCount">;
  readonly repository: ecr.IRepository;
  readonly imageTag: CfnParameter;
  readonly environment?: Record<string, string>;
  /** Injected by ECS at start; only this task's roles can read them. */
  readonly secrets?: Record<string, ecs.Secret>;
  readonly port?: number;
  readonly command?: string[];
  readonly workingDirectory?: string;
  readonly healthCheck?: ecs.HealthCheck;
  readonly executionRole?: iam.IRole;
  readonly taskRole?: iam.IRole;
}

/** A Fargate task definition with one container, its own log group and its own roles. */
export function taskDefinition(stack: Stack, props: TaskProps): ecs.FargateTaskDefinition {
  const names = resourceNames(props.config);
  const task = new ecs.FargateTaskDefinition(stack, `${props.name}Task`, {
    family: `rabaed-${props.config.name}-${props.name}`,
    cpu: props.size.cpu,
    memoryLimitMiB: props.size.memoryMiB,
    runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    executionRole: props.executionRole,
    taskRole: props.taskRole,
  });
  const logGroup = new logs.LogGroup(stack, `${props.name}Logs`, {
    logGroupName: names.logGroup(props.name),
    retention: props.config.logRetentionDays as logs.RetentionDays,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  task.addContainer(props.name, {
    image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag.valueAsString),
    environment: { ...props.environment, APP_VERSION: props.imageTag.valueAsString },
    secrets: props.secrets,
    portMappings: props.port ? [{ containerPort: props.port }] : undefined,
    command: props.command,
    workingDirectory: props.workingDirectory,
    healthCheck: props.healthCheck,
    readonlyRootFilesystem: false,
    logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: props.name }),
  });
  return task;
}
