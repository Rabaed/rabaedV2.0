import { Stack, type StackProps } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { resourceNames, serviceNames, type EnvironmentConfig, type ServiceName } from "./config.ts";

export interface RegistryStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

// One image repository per service. Deployed before images are pushed; the
// deploy workflow tags each image with the commit it was built from.
//
// The deploy workflow records the last version that passed its checks in an
// SSM parameter, and redeploys the app with those images when a later version
// fails them (RP-246). Only the workflow writes the parameter; were it a
// resource here, any update to it would reset the value.
export class RegistryStack extends Stack {
  readonly repositories: Record<ServiceName, ecr.Repository>;

  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props);
    const names = resourceNames(props.config);

    const repository = (service: ServiceName) =>
      new ecr.Repository(this, `${service}Repository`, {
        repositoryName: names.repository(service),
        imageScanOnPush: true,
        // A commit's image can never be replaced once pushed.
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        lifecycleRules: [{ description: "Keep the last 50 images", maxImageCount: 50 }],
      });
    this.repositories = Object.fromEntries(serviceNames.map((s) => [s, repository(s)])) as Record<ServiceName, ecr.Repository>;

    // Granted here, by name, next to the images it names (as the storage stack does for the fonts).
    new iam.Policy(this, "DeployRecordsLastGoodVersion", {
      roles: [iam.Role.fromRoleName(this, "DeployRole", names.deployRole)],
      statements: [
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter", "ssm:PutParameter"],
          resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: names.lastGoodVersionParameter.slice(1) })],
        }),
      ],
    });
  }
}
