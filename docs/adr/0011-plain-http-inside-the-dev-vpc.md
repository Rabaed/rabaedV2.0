# Plain HTTP inside the dev VPC; production encrypts every hop

ADR 0001 asks for encryption in transit. In the dev environment on AWS, two hops inside the VPC run without TLS: the load balancer forwards to web over HTTP (`packages/infra/src/app-stack.ts`, the `Web` targets of the HTTPS listener), and web calls the api at `http://api.<namespace>` (the `API_URL` it is given). Everything else is encrypted: the browser to the load balancer (HTTPS only; HTTP only redirects), the api and worker to the database (TLS required), and every call out to AWS.

We accept this for dev. Both hops stay inside private subnets, security groups allow only load balancer → web → api, and dev holds made-up demo data only (README, "Demo in dev"). Adding TLS now would mean certificates for internal names with no domain chosen yet, and a private certificate authority, for no data worth protecting.

An environment that holds real customer data must not go live like this: every hop carries TLS, including inside the VPC. The mechanism is chosen when that environment is built:

- **TLS to targets:** the load balancer forwards to web over HTTPS, and the api serves HTTPS on an internal name with a certificate web trusts.
- **A service mesh:** ECS Service Connect with TLS (AWS Private CA), which encrypts web → api, and later the admin service (ADR 0010), without the services handling certificates themselves.

## Consequences

The production stack must not reuse dev's `http://` `API_URL` or HTTP target group as they are; that environment's infrastructure tests should assert TLS on both hops. Until then, dev's traffic between web and the api, including session cookies passed through web's `/api/v1` proxy, is readable by anything that can capture traffic inside the VPC.
