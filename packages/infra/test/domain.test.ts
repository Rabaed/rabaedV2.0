import { describe, expect, it } from "vitest";
import { environments, type EnvironmentConfig } from "../src/config.ts";
import { environmentTemplates, render, synthesise } from "./support.ts";

// Story 27 of spec RP-207: a real domain arrives by changing configuration
// only. The App stack's Url output is the address the deploy's smoke test and
// summary use, so it must be the domain once one is set.
const withDomain: EnvironmentConfig = { ...environments.dev, domain: "dev.example.test" };

function app(config: EnvironmentConfig) {
  const template = environmentTemplates(config).template("app");
  const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
  const listeners = template.findResources("AWS::ElasticLoadBalancingV2::Listener");
  const https = Object.values(listeners).find((l) => (l as { Properties: { Port: number } }).Properties.Port === 443) as {
    Properties: { Certificates: { CertificateArn: unknown }[] };
  };
  return { outputs, httpsCertificates: https.Properties.Certificates.map((c) => render(c.CertificateArn)) };
}

describe("without a domain (interim)", () => {
  const { outputs, httpsCertificates } = app(environments.dev);

  it("serves at the load balancer's own address", () => {
    expect(render(outputs.Url!.Value)).toEqual(`https://${render(outputs.LoadBalancerDnsName!.Value)}`);
    expect(outputs.LoadBalancerDnsName!.Value).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^LoadBalancer/), "DNSName"] });
  });

  it("uses the certificate the deploy passes in", () => {
    expect(httpsCertificates).toEqual(["${CertificateArn}"]);
  });
});

describe("with a domain", () => {
  const { outputs, httpsCertificates } = app(withDomain);

  it("serves at https://<domain>", () => {
    expect(outputs.Url!.Value).toBe("https://dev.example.test");
  });

  it("still names the load balancer, so the domain can be pointed at it", () => {
    expect(outputs.LoadBalancerDnsName!.Value).toEqual({ "Fn::GetAtt": [expect.stringMatching(/^LoadBalancer/), "DNSName"] });
  });

  it("uses the certificate the deploy passes in, the domain's", () => {
    expect(httpsCertificates).toEqual(["${CertificateArn}"]);
  });
});

describe("a domain that is not a bare host name", () => {
  it.each(["https://dev.example.test", "dev.example.test/", "dev.example.test:443", "Dev.Example.Test", "localhost"])("refuses %s", (domain) => {
    expect(() => synthesise({ ...environments.dev, domain })).toThrow(/domain/);
  });
});
