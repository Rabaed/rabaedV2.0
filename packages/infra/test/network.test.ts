import { describe, expect, it } from "vitest";
import { stackNames, environments } from "../src/config.ts";
import { environmentTemplates, references, resourcesOfType, type Resource } from "./support.ts";

const env = environmentTemplates();
const names = stackNames(environments.dev);
const parts = Object.keys(names) as (keyof typeof names)[];

// A security group's name in these tests: `WebSecurityGroupA1B2C3D4` → `Web`.
function groupName(value: unknown, part: keyof typeof names): string {
  const { logicalId, resource } = env.resolve(value, part);
  expect(resource.Type).toBe("AWS::EC2::SecurityGroup");
  return logicalId.replace(/SecurityGroup[0-9A-F]{8}$/, "");
}

type Rule = { CidrIp?: string; FromPort?: number; IpProtocol: string; SourceSecurityGroupId?: unknown; DestinationSecurityGroupId?: unknown; GroupId?: unknown };

// "from -> to:port" for every rule, wherever CDK put it (inline or its own resource).
function paths(direction: "ingress" | "egress"): string[] {
  const found: string[] = [];
  const peer = (rule: Rule, part: keyof typeof names) => {
    const group = direction === "ingress" ? rule.SourceSecurityGroupId : rule.DestinationSecurityGroupId;
    if (group) return groupName(group, part);
    return rule.CidrIp === "0.0.0.0/0" ? "internet" : `${rule.CidrIp}`;
  };
  const add = (self: string, rule: Rule, part: keyof typeof names) => {
    // CDK's placeholder for "no outbound traffic at all".
    if (rule.CidrIp === "255.255.255.255/32") return;
    const other = peer(rule, part);
    const port = rule.IpProtocol === "-1" ? "all" : rule.FromPort;
    found.push(direction === "ingress" ? `${other} -> ${self}:${port}` : `${self} -> ${other}:${port}`);
  };
  for (const part of parts) {
    const resources = Object.entries(env.template(part).toJSON().Resources ?? {}) as [string, Resource][];
    for (const [logicalId, resource] of resources) {
      if (resource.Type === "AWS::EC2::SecurityGroup") {
        const inline = (resource.Properties?.[direction === "ingress" ? "SecurityGroupIngress" : "SecurityGroupEgress"] ?? []) as Rule[];
        for (const rule of inline) add(groupName({ Ref: logicalId }, part), rule, part);
      }
      if (resource.Type === (direction === "ingress" ? "AWS::EC2::SecurityGroupIngress" : "AWS::EC2::SecurityGroupEgress")) {
        const rule = resource.Properties as Rule;
        add(groupName(rule.GroupId, part), rule, part);
      }
    }
  }
  return found.sort();
}

describe("network", () => {
  it("puts nothing in a public subnet except the load balancer and the NAT gateway", () => {
    const users = new Set<string>();
    for (const part of parts) {
      const resources = Object.values(env.template(part).toJSON().Resources ?? {}) as Resource[];
      for (const resource of resources) {
        for (const ref of references(resource.Properties)) {
          if (env.tryResolve(ref, part)?.resource.Type !== "AWS::EC2::Subnet") continue;
          if (env.subnetType(ref, part) === "Public") users.add(resource.Type);
        }
      }
    }
    expect([...users].sort()).toEqual([
      "AWS::EC2::NatGateway",
      "AWS::EC2::SubnetRouteTableAssociation",
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
    ]);
  });

  it("gives nothing launched in a public subnet a public IP by default", () => {
    for (const subnet of resourcesOfType(env.synthesised, "AWS::EC2::Subnet")) {
      expect(subnet.Properties?.MapPublicIpOnLaunch ?? false).toBe(false);
    }
  });

  it("runs both load balancers (customer and Rabaed Admin) in the public subnets, facing the internet, each in its own group", () => {
    const albs = resourcesOfType(env.synthesised, "AWS::ElasticLoadBalancingV2::LoadBalancer");
    for (const alb of albs) {
      expect(alb.Properties?.Scheme).toBe("internet-facing");
      const subnets = alb.Properties?.Subnets as unknown[];
      expect(subnets.length).toBeGreaterThanOrEqual(2);
      for (const subnet of subnets) expect(env.subnetType(subnet, "app")).toBe("Public");
    }
    const groups = albs.map((alb) => (alb.Properties?.SecurityGroups as unknown[]).map((g) => groupName(g, "app")));
    expect(groups.sort()).toEqual([["AdminLoadBalancer"], ["LoadBalancer"]]);
  });

  it("runs every service in the private subnets without a public IP, in its own security group", () => {
    const services = resourcesOfType(env.synthesised, "AWS::ECS::Service");
    const byFamily: Record<string, string[]> = {};
    for (const service of services) {
      const family = env.resolve(service.Properties?.TaskDefinition, "app").resource.Properties?.Family as string;
      const vpc = (service.Properties?.NetworkConfiguration as { AwsvpcConfiguration: Record<string, unknown> }).AwsvpcConfiguration;
      expect(vpc.AssignPublicIp).toBe("DISABLED");
      for (const subnet of vpc.Subnets as unknown[]) expect(env.subnetType(subnet, "app")).toBe("Private");
      byFamily[family] = (vpc.SecurityGroups as unknown[]).map((g) => groupName(g, "app"));
    }
    expect(byFamily).toEqual({
      "rabaed-dev-web": ["Web"],
      "rabaed-dev-api": ["Api"],
      "rabaed-dev-admin": ["Admin"],
      "rabaed-dev-worker": ["Worker"],
    });
  });

  it("runs migrations in the private subnets, in their own security group", () => {
    const outputs = env.template("migrations").toJSON().Outputs as Record<string, { Value: unknown }>;
    const subnets = (outputs.Subnets?.Value as { "Fn::Join": [string, unknown[]] })["Fn::Join"][1];
    expect(subnets.length).toBeGreaterThanOrEqual(2);
    for (const subnet of subnets) expect(env.subnetType(subnet, "migrations")).toBe("Private");
    expect(groupName(outputs.SecurityGroup?.Value, "migrations")).toBe("Migrations");
  });

  it("lets traffic in only along the intended paths", () => {
    expect(paths("ingress")).toEqual(
      [
        "internet -> LoadBalancer:443",
        // Only to redirect to HTTPS.
        "internet -> LoadBalancer:80",
        "LoadBalancer -> Web:3000",
        // The public load balancer reaches web only; web reaches the api privately.
        "Web -> Api:4000",
        "Api -> Database:5432",
        // Rabaed Admin: its own load balancer, HTTPS only, to it alone (ADR 0010).
        "internet -> AdminLoadBalancer:443",
        "AdminLoadBalancer -> Admin:4050",
        "Admin -> Database:5432",
        "Worker -> Database:5432",
        "Migrations -> Database:5432",
        // The secret rotation Lambda signs in as each role to change its password.
        "Rotation -> Database:5432",
      ].sort(),
    );
  });

  it("lets traffic out only along the same paths, plus HTTPS for image pulls, logs and secrets", () => {
    expect(paths("egress")).toEqual(
      [
        "LoadBalancer -> Web:3000",
        "Web -> Api:4000",
        "Web -> internet:443",
        "Api -> Database:5432",
        "Api -> internet:443",
        "AdminLoadBalancer -> Admin:4050",
        "Admin -> Database:5432",
        "Admin -> internet:443",
        "Worker -> Database:5432",
        "Worker -> internet:443",
        "Migrations -> Database:5432",
        "Migrations -> internet:443",
        "Rotation -> Database:5432",
        "Rotation -> internet:443",
      ].sort(),
    );
  });
});
