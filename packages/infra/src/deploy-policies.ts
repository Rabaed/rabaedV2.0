import { DefaultStackSynthesizer, type Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { resourceNames, stackPattern, type EnvironmentConfig } from "./config.ts";
import { ROTATION_APPLICATION } from "./data-stack.ts";

// The two policies that bound a deploy (RP-242), both in the account stack,
// which only a person deploys.
//
// A deploy's CloudFormation execution role (the CDK bootstrap's, bootstrapped
// with `--cloudformation-execution-policies`) gets the execution policy
// instead of AdministratorAccess: the services the stacks use, and IAM only
// for this environment's roles while they carry the permissions boundary. The
// boundary caps every such role, the GitHub deploy role among them, whatever
// a stack grants it. A new kind of resource, or a role that needs a new kind
// of action, needs these widened in the same change (deploy-reach.test.ts).

// Services whose first use creates a service-linked role.
const SERVICE_LINKED_ROLES = ["ecs.amazonaws.com", "elasticloadbalancing.amazonaws.com", "rds.amazonaws.com"];

function roleArns(stack: Stack, patterns: readonly string[]) {
  return patterns.map((pattern) => `arn:${stack.partition}:iam::${stack.account}:role/${pattern}`);
}

/** What CloudFormation may do in a deploy of this environment's stacks. */
export function executionPolicyStatements(stack: Stack, config: EnvironmentConfig, boundaryArn: string): iam.PolicyStatement[] {
  const names = resourceNames(config);
  const environmentRoles = roleArns(stack, names.rolePatterns);
  return [
    new iam.PolicyStatement({
      sid: "Services",
      actions: [
        "cloudtrail:*",
        "cloudwatch:*",
        "ec2:*",
        "ecr:*",
        "ecs:*",
        "elasticloadbalancing:*",
        "kms:*",
        "lambda:*",
        "logs:*",
        "rds:*",
        "s3:*",
        "secretsmanager:*",
        "servicediscovery:*",
        // The email configuration set (app stack), not identities or sending.
        "ses:*ConfigurationSet*",
        "ses:ListTagsForResource",
        "ses:TagResource",
        "ses:UntagResource",
        // Cloud Map's private DNS namespace is a private hosted zone.
        "route53:ChangeResourceRecordSets",
        "route53:ChangeTagsForResource",
        "route53:CreateHostedZone",
        "route53:DeleteHostedZone",
        "route53:GetChange",
        "route53:GetHostedZone",
        "route53:ListHostedZonesByName",
        "route53:ListResourceRecordSets",
        "route53:ListTagsForResource",
      ],
      resources: ["*"],
    }),
    // The rotation app becomes a nested stack of the data stack, through the Serverless transform.
    new iam.PolicyStatement({
      sid: "NestedStacks",
      actions: ["cloudformation:*"],
      resources: [stack.formatArn({ service: "cloudformation", resource: "stack", resourceName: stackPattern(config) })],
    }),
    new iam.PolicyStatement({
      sid: "ServerlessTransform",
      actions: ["cloudformation:CreateChangeSet"],
      resources: [stack.formatArn({ service: "cloudformation", account: "aws", resource: "transform", resourceName: "Serverless-2016-10-31" })],
    }),
    new iam.PolicyStatement({
      sid: "RotationApplication",
      actions: ["serverlessrepo:CreateCloudFormationTemplate", "serverlessrepo:GetApplication", "serverlessrepo:GetCloudFormationTemplate"],
      resources: [ROTATION_APPLICATION.applicationArnForPartition("aws")],
    }),
    // Every template's BootstrapVersion parameter.
    new iam.PolicyStatement({
      sid: "BootstrapVersion",
      actions: ["ssm:GetParameters"],
      resources: [
        stack.formatArn({ service: "ssm", resource: "parameter", resourceName: `cdk-bootstrap/${DefaultStackSynthesizer.DEFAULT_QUALIFIER}/version` }),
      ],
    }),
    // A role may be created, and what it may do changed, only with the boundary on it.
    new iam.PolicyStatement({
      sid: "BoundedRoles",
      actions: [
        "iam:AttachRolePolicy",
        "iam:CreateRole",
        "iam:PutRolePermissionsBoundary",
        "iam:PutRolePolicy",
      ],
      resources: environmentRoles,
      conditions: { StringEquals: { "iam:PermissionsBoundary": boundaryArn } },
    }),
    // Taking permissions away never widens anything, so also from roles a
    // deploy has not bounded yet (e.g. hosted rotation's, deleted in dev).
    new iam.PolicyStatement({
      sid: "Roles",
      actions: [
        "iam:DeleteRole",
        "iam:DeleteRolePolicy",
        "iam:DetachRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:ListRoleTags",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:UpdateRole",
        "iam:UpdateRoleDescription",
      ],
      resources: environmentRoles,
    }),
    new iam.PolicyStatement({
      sid: "ServiceLinkedRoles",
      actions: ["iam:CreateServiceLinkedRole"],
      resources: ["*"],
      conditions: { StringEquals: { "iam:AWSServiceName": SERVICE_LINKED_ROLES } },
    }),
    new iam.PolicyStatement({
      sid: "KeepBoundaries",
      effect: iam.Effect.DENY,
      actions: ["iam:DeleteRolePermissionsBoundary"],
      resources: ["*"],
    }),
    // The stacks grant the deploy role what it reads next to the resource
    // (fonts, demo password, last good version); its trust, boundary and
    // managed policies are the account stack's alone.
    new iam.PolicyStatement({
      sid: "GithubRolesAreTheAccountStacks",
      effect: iam.Effect.DENY,
      notActions: ["iam:DeleteRolePolicy", "iam:GetRole", "iam:GetRolePolicy", "iam:PutRolePolicy"],
      resources: roleArns(stack, [names.githubRoles]),
    }),
  ];
}

/** The most any role a deploy creates or changes may do. */
export function boundaryStatements(stack: Stack, config: EnvironmentConfig): iam.PolicyStatement[] {
  const names = resourceNames(config);
  return [
    new iam.PolicyStatement({
      sid: "Workloads",
      actions: [
        // Images: the deploy role pushes, the task execution roles pull.
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:GetAuthorizationToken",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        // The deploy role runs the migration task and reads its log.
        "ecs:DescribeTasks",
        "ecs:RunTask",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:GetLogEvents",
        "logs:PutLogEvents",
        // Project files, fonts, secrets and their keys.
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject",
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetRandomPassword",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecretVersionStage",
        "ssm:GetParameter",
        "ssm:PutParameter",
        "ses:SendEmail",
        "ses:SendRawEmail",
        // Lambdas in the VPC (rotation), and the one that empties the default security group.
        "ec2:AssignPrivateIpAddresses",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:UnassignPrivateIpAddresses",
      ],
      resources: ["*"],
    }),
    // The deploy role hands over to the CDK's deploy roles; no role assumes any other.
    new iam.PolicyStatement({
      sid: "CdkBootstrapRoles",
      actions: ["sts:AssumeRole"],
      resources: roleArns(stack, [`cdk-${DefaultStackSynthesizer.DEFAULT_QUALIFIER}-*`]),
    }),
    // The deploy role passes the migration task its roles.
    new iam.PolicyStatement({ sid: "PassEnvironmentRoles", actions: ["iam:PassRole"], resources: roleArns(stack, names.rolePatterns) }),
  ];
}
