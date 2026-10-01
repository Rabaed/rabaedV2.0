import { describe, expect, it } from "vitest";
import { environments, type EnvironmentConfig } from "../src/config.ts";
import { environmentTemplates, render, synthesise } from "./support.ts";

// Story 27 of spec RP-207: a real domain arrives by changing configuration
// only. The App stack's Url output is the address the deploy's smoke test and
// summary use, so it must be the domain once one is set. The listener's
// certificate is the CertificateArn parameter either way (test/services.test.ts);
// the smoke test's TLS check catches one that does not match the domain.
function outputs(config: EnvironmentConfig) {
  return environmentTemplates(config).template("app").toJSON().Outputs as Record<string, { Value: unknown }>;
}

const loadBalancerDnsName = { "Fn::GetAtt": [expect.stringMatching(/^LoadBalancer/), "DNSName"] };

it("without a domain (interim), serves at the load balancer's own address", () => {
  const { Url, LoadBalancerDnsName } = outputs(environments.dev);
  expect(LoadBalancerDnsName!.Value).toEqual(loadBalancerDnsName);
  expect(render(Url!.Value)).toEqual(`https://${render(LoadBalancerDnsName!.Value)}`);
});

it("with a domain, serves at https://<domain> and still names the load balancer to point it at", () => {
  const { Url, LoadBalancerDnsName } = outputs({ ...environments.dev, domain: "dev.example.test" });
  expect(Url!.Value).toBe("https://dev.example.test");
  expect(LoadBalancerDnsName!.Value).toEqual(loadBalancerDnsName);
});

describe("domain", () => {
  it.each(["https://dev.example.test", "dev.example.test/", "dev.example.test:443", "Dev.Example.Test", "localhost"])("refuses %s", (domain) => {
    expect(() => synthesise({ ...environments.dev, domain })).toThrow(/domain/);
  });

  it("accepts a punycode top-level domain such as Saudi Arabia's Arabic one", () => {
    expect(() => synthesise({ ...environments.dev, domain: "dev.example.xn--mgberp4a5d4ar" })).not.toThrow();
  });
});
