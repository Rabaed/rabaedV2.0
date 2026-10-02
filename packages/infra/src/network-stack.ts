import { Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import type { Construct } from "constructs";
import { resourceNames, type EnvironmentConfig } from "./config.ts";

export const WEB_PORT = 3000;
export const API_PORT = 4000;
export const ADMIN_PORT = 4050;
export const DATABASE_PORT = 5432;

export interface NetworkStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

// The VPC, the ECS cluster and every security group. All traffic rules live
// here, in one place, so the allowed paths can be read (and are tested) together:
//   internet → load balancer (443, and 80 only to redirect) → web → api → database
//   internet → admin load balancer (443 only) → admin → database (Rabaed Admin, ADR 0010)
//   worker → database; the migration task → database; password rotation → database
// Every task may also make outbound HTTPS calls, through the NAT gateway, to pull
// its image, write logs and read its secrets.
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly securityGroups: Record<
    "loadBalancer" | "web" | "api" | "adminLoadBalancer" | "admin" | "worker" | "migrations" | "rotation" | "database",
    ec2.SecurityGroup
  >;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;
    const names = resourceNames(config);

    // Public subnets hold only the load balancer and the NAT gateway. Tasks run
    // in the private subnets; the database in isolated ones with no route out.
    this.vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
      maxAzs: 2,
      natGateways: config.natGateways,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24, mapPublicIpOnLaunch: false },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Container Insights publishes each service's running task count, which the
    // monitoring stack alarms on (RP-245).
    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: this.vpc,
      clusterName: names.cluster,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    this.cluster.addDefaultCloudMapNamespace({ name: names.namespace, vpc: this.vpc });

    const group = (id: string, description: string) =>
      new ec2.SecurityGroup(this, `${id}SecurityGroup`, { vpc: this.vpc, description, allowAllOutbound: false });
    const loadBalancer = group("LoadBalancer", "Public load balancer: HTTPS in, to web only");
    const web = group("Web", "web tasks");
    const api = group("Api", "api tasks");
    // Rabaed Admin has its own load balancer and address; nothing connects it to web or the api.
    const adminLoadBalancer = group("AdminLoadBalancer", "Rabaed Admin load balancer: HTTPS in, to admin only");
    const admin = group("Admin", "Rabaed Admin tasks");
    const worker = group("Worker", "worker tasks");
    const migrations = group("Migrations", "One-off migration tasks");
    const rotation = group("Rotation", "Secrets Manager rotation Lambdas for the database passwords");
    // Never change a group's description: CloudFormation replaces the group, which
    // the stacks using it (the database) refuse. Rotation also reaches the database.
    const database = group("Database", "PostgreSQL: reachable from api, worker and migrations only");

    loadBalancer.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS from anywhere");
    loadBalancer.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP from anywhere, redirected to HTTPS");
    loadBalancer.connections.allowTo(web, ec2.Port.tcp(WEB_PORT), "load balancer to web");
    web.connections.allowTo(api, ec2.Port.tcp(API_PORT), "web to api");
    adminLoadBalancer.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS from anywhere");
    adminLoadBalancer.connections.allowTo(admin, ec2.Port.tcp(ADMIN_PORT), "admin load balancer to admin");
    for (const client of [api, admin, worker, migrations, rotation]) {
      client.connections.allowTo(database, ec2.Port.tcp(DATABASE_PORT), `${client.node.id} to database`);
    }
    for (const task of [web, api, admin, worker, migrations, rotation]) {
      task.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS out: image pulls, logs, secrets");
    }

    this.securityGroups = { loadBalancer, web, api, adminLoadBalancer, admin, worker, migrations, rotation, database };
  }
}
