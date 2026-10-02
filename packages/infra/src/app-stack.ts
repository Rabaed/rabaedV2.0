import { CfnOutput, CfnParameter, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import type { Construct } from "constructs";
import { checkDomain, resourceNames, type EnvironmentConfig, type ServiceName } from "./config.ts";
import type { DataStack } from "./data-stack.ts";
import { MailSending } from "./email.ts";
import { ADMIN_PORT, API_PORT, WEB_PORT, type NetworkStack } from "./network-stack.ts";
import type { RegistryStack } from "./registry-stack.ts";
import { PROJECT_FILES_PREFIX, type StorageStack } from "./storage-stack.ts";
import { databaseEnvironment, imageTagParameter, taskDefinition, type TaskProps } from "./task.ts";

export interface AppStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly registry: RegistryStack;
  readonly storage: StorageStack;
}

// The running app: the public load balancer, the web, api and worker services,
// Rabaed Admin behind its own load balancer, and how they send email.
//
// The load balancer forwards to web only. Web reaches the api by its private
// name (as it does locally through API_URL), and the browser reaches the api
// only through web's /api/v1 proxy.
//
// Rabaed Admin (ADR 0010) is a separate service with its own load balancer
// and address, HTTPS only, and its own sign-in. Only its task role can read
// the rabaed_admin password, the role that bypasses row-level security; the
// customer api and web have no secret, variable or route for it.
//
// Each deploy is a rolling update. A task that fails its health checks trips
// the ECS circuit breaker, which rolls the service back to the previous
// version; CloudFormation then fails the deploy, which turns the workflow red.
//
// api and worker read their database passwords from Secrets Manager with their
// task roles when connecting, so a rotated password reaches them without a
// restart. Each task role reads only its own secrets.
export class AppStack extends Stack {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  /** web's targets behind the HTTPS listener. */
  readonly webTargets: elbv2.ApplicationTargetGroup;
  /** Rabaed Admin's own load balancer. */
  readonly adminLoadBalancer: elbv2.ApplicationLoadBalancer;
  /** Every Fargate service, for the monitoring stack's running task alarms. */
  readonly services: Record<ServiceName, ecs.FargateService>;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, network, data, registry, storage } = props;
    checkDomain(config);
    const names = resourceNames(config);
    const imageTag = imageTagParameter(this);

    // The domain's certificate once config.domain is set. Until then, the
    // wizard imports an interim self-signed certificate and records its ARN;
    // see README "Dev environment on AWS".
    const certificateArn = new CfnParameter(this, "CertificateArn", {
      type: "String",
      description: "ACM certificate for the HTTPS listener",
      allowedPattern: "^arn:aws[a-z-]*:acm:.+",
    });

    const task = (name: ServiceName, extra: Omit<TaskProps, "config" | "name" | "size" | "repository" | "imageTag">) =>
      taskDefinition(this, { config, name, size: config.services[name], repository: registry.repositories[name], imageTag, ...extra });

    const service = (name: ServiceName, taskDef: ecs.FargateTaskDefinition, securityGroup: ec2.ISecurityGroup, extra: Partial<ecs.FargateServiceProps> = {}) =>
      new ecs.FargateService(this, `${name}Service`, {
        cluster: network.cluster,
        taskDefinition: taskDef,
        desiredCount: config.services[name].desiredCount,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [securityGroup],
        assignPublicIp: false,
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        circuitBreaker: { enable: true, rollback: true },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        ...extra,
      });

    // Named, so the Project files bucket can refuse every other principal.
    const apiTaskRole = new iam.Role(this, "ApiTaskRole", {
      roleName: names.apiTaskRole,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    data.roleSecrets.rabaed_app.grantRead(apiTaskRole);
    // Read and write objects under projects/ only: what the signed URLs it
    // creates may do, since a signed URL carries the signer's permissions.
    apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [storage.projectFiles.arnForObjects(`${PROJECT_FILES_PREFIX}*`)],
      }),
    );
    storage.storageKey.grantEncryptDecrypt(apiTaskRole);

    // Named, so the deploy's smoke check can ask IAM what it may read.
    const adminTaskRole = new iam.Role(this, "AdminTaskRole", {
      roleName: names.adminTaskRole,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    data.roleSecrets.rabaed_admin.grantRead(adminTaskRole);

    // Email through Amazon SES. Only the services that send email (the api,
    // and Rabaed Admin for its sign-in codes and invitations) may.
    const mail = new MailSending(this, config);
    mail.grantSend(apiTaskRole);
    mail.grantSend(adminTaskRole);

    const api = service(
      "api",
      task("api", {
        environment: {
          ...databaseEnvironment(data),
          DATABASE_APP_SECRET_ARN: data.roleSecrets.rabaed_app.secretArn,
          PROJECT_FILES_BUCKET: storage.projectFiles.bucketName,
          API_HOST: "0.0.0.0",
          API_PORT: String(API_PORT),
          SESSION_COOKIE_SECURE: "true",
          ...mail.environment,
        },
        taskRole: apiTaskRole,
        port: API_PORT,
        // /health answers 503 when the database is unreachable, so a version
        // that cannot reach it never becomes healthy and is rolled back.
        healthCheck: healthCheck(API_PORT),
      }),
      network.securityGroups.api,
      { cloudMapOptions: { name: "api", dnsRecordType: servicediscovery.DnsRecordType.A, dnsTtl: Duration.seconds(10) } },
    );

    const web = service(
      "web",
      task("web", {
        environment: { API_URL: `http://api.${names.namespace}:${API_PORT}` },
        port: WEB_PORT,
      }),
      network.securityGroups.web,
      { healthCheckGracePeriod: Duration.seconds(60) },
    );
    web.node.addDependency(api);

    const workerTask = task("worker", {
      environment: { ...databaseEnvironment(data), DATABASE_APP_SECRET_ARN: data.roleSecrets.rabaed_app.secretArn },
    });
    data.roleSecrets.rabaed_app.grantRead(workerTask.taskRole);
    const worker = service("worker", workerTask, network.securityGroups.worker);

    const loadBalancer = (this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: network.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: network.securityGroups.loadBalancer,
      dropInvalidHeaderFields: true,
    }));
    // Every request, for the audit trail; the logs bucket (storage stack) keeps them a year.
    loadBalancer.logAccessLogs(storage.logs, "load-balancer");

    const https = loadBalancer.addListener("Https", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      certificates: [elbv2.ListenerCertificate.fromArn(certificateArn.valueAsString)],
      // The security groups (network stack) already hold every rule.
      open: false,
    });
    this.webTargets = https.addTargets("Web", {
      port: WEB_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [web],
      healthCheck: { path: "/api/health", healthyHttpCodes: "200", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(15),
    });

    loadBalancer.addListener("Http", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
    });

    // The customer web's address: the domain once there is one.
    const webUrl = `https://${config.domain ?? loadBalancer.loadBalancerDnsName}`;

    const admin = service(
      "admin",
      task("admin", {
        environment: {
          ...databaseEnvironment(data),
          DATABASE_ADMIN_SECRET_ARN: data.roleSecrets.rabaed_admin.secretArn,
          ADMIN_HOST: "0.0.0.0",
          ADMIN_PORT: String(ADMIN_PORT),
          SESSION_COOKIE_SECURE: "true",
          // Invitation links in Rabaed Admin's emails open the customer web.
          WEB_URL: webUrl,
          ...mail.environment,
        },
        taskRole: adminTaskRole,
        port: ADMIN_PORT,
        healthCheck: healthCheck(ADMIN_PORT),
      }),
      network.securityGroups.admin,
      { healthCheckGracePeriod: Duration.seconds(60) },
    );
    this.services = { web, api, admin, worker };

    // Rabaed Admin's own load balancer: HTTPS only, no HTTP listener at all.
    const adminLoadBalancer = (this.adminLoadBalancer = new elbv2.ApplicationLoadBalancer(this, "AdminLoadBalancer", {
      vpc: network.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: network.securityGroups.adminLoadBalancer,
      dropInvalidHeaderFields: true,
    }));
    adminLoadBalancer.logAccessLogs(storage.logs, "load-balancer");
    adminLoadBalancer
      .addListener("AdminHttps", {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        // The interim certificate covers every load balancer's AWS address. A
        // domain's certificate covers only its names: Rabaed Admin then needs
        // its own name on it (e.g. admin.<domain>), which RP-247 left out.
        certificates: [elbv2.ListenerCertificate.fromArn(certificateArn.valueAsString)],
        open: false,
      })
      .addTargets("Admin", {
        port: ADMIN_PORT,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [admin],
        healthCheck: { path: "/health", healthyHttpCodes: "200", interval: Duration.seconds(15), healthyThresholdCount: 2 },
        deregistrationDelay: Duration.seconds(15),
      });

    // The deploy checks, after each deploy, that the api's task role still
    // cannot read the admin secret and Rabaed Admin's can, by asking IAM
    // (simulate only: it reads the roles' policies, it changes nothing).
    // Granted here, by name, next to the roles it names (as the registry stack does).
    new iam.Policy(this, "DeployChecksAdminSecretAccess", {
      roles: [iam.Role.fromRoleName(this, "DeployRole", names.deployRole)],
      statements: [new iam.PolicyStatement({ actions: ["iam:SimulatePrincipalPolicy"], resources: [apiTaskRole.roleArn, adminTaskRole.roleArn] })],
    });

    new CfnOutput(this, "AdminUrl", { value: `https://${adminLoadBalancer.loadBalancerDnsName}` });
    // ARNs, not secrets: what the deploy's secret access check asks IAM about.
    new CfnOutput(this, "ApiTaskRoleArn", { value: apiTaskRole.roleArn });
    new CfnOutput(this, "AdminTaskRoleArn", { value: adminTaskRole.roleArn });
    new CfnOutput(this, "AdminSecretArn", { value: data.roleSecrets.rabaed_admin.secretArn });
    // Where the domain's DNS record points; also the address until there is one.
    new CfnOutput(this, "LoadBalancerDnsName", { value: loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, "Url", { value: webUrl });
  }
}

/** The container's own check of its /health, which answers 503 when the database is unreachable. */
function healthCheck(port: number): ecs.HealthCheck {
  return {
    command: ["CMD", "node", "-e", `fetch("http://127.0.0.1:${port}/health").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`],
    interval: Duration.seconds(15),
    timeout: Duration.seconds(5),
    retries: 3,
    startPeriod: Duration.seconds(30),
  };
}
