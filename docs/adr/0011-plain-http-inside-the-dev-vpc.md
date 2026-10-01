# Plain HTTP inside the dev VPC; environments with real data encrypt every hop

ADR 0001 asks for encryption in transit. In the dev environment on AWS, two hops inside the VPC run without TLS: the load balancer forwards to web over HTTP (`packages/infra/src/app-stack.ts`, the `Web` targets of the HTTPS listener), and web calls the api at `http://api.<namespace>:4000` (the `API_URL` it is given). Everything else is encrypted: the browser to the load balancer (HTTPS only; HTTP only redirects), the api and worker to the database (TLS required), and every call out to AWS.

We accept this for dev. Both hops stay inside private subnets, security groups allow only load balancer → web → api, and dev holds made-up demo data only (README, "Demo in dev"). An environment that holds real customer data must not go live like this: every hop carries TLS, including inside the VPC. The mechanism is chosen when that environment is built.

## Considered Options

- **TLS inside the VPC in dev now:** rejected; it needs certificates for internal names with no domain chosen yet, and a private certificate authority, for no data worth protecting.
- **TLS to targets:** deferred to the first environment with real data. The load balancer forwards to web over HTTPS, and the api serves HTTPS on an internal name with a certificate web trusts.
- **A service mesh:** deferred likewise. ECS Service Connect with TLS (AWS Private CA) encrypts web → api, and later the admin service (ADR 0010), without the services handling certificates themselves.

## Consequences

That environment's stack must not reuse dev's `http://` `API_URL` or HTTP target group as they are, and its infrastructure tests should assert TLS on both hops. Until then, dev's traffic between web and the api, including session cookies passed through web's `/api/v1` proxy, is readable by anything that can capture traffic inside the VPC.
