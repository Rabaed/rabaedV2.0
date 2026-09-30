# Rabaed Admin is a separate service, and only it holds the role that bypasses row-level security

ADR 0007 gives Rabaed Admin a separate database role that bypasses row-level security, so Rabaed Engineers can support any Company. The walking skeleton served the admin routes from the customer api, so the internet-facing process that every Member talks to also held credentials that ignore every visibility rule. One break-in, SSRF or routing mistake there would expose every Company's data.

We decided that Rabaed Admin runs as its own service, with its own address and load balancer, never served by the same system as the customer app. Only the admin service can read the bypass role's credentials, and the customer api and web lose them entirely. The portal stays reachable from the internet, because Rabaed Engineers work from different places, and is protected at sign-in instead: a password plus a one-time code sent by email, lockout after failed attempts, sign-out after 30 minutes idle, and an alert on sign-in from a new device. Every sign-in is logged, like every `admin_action`.

## Considered Options

- **Keep the admin routes in the customer api, behind extra guards:** rejected; the customer api would still hold the bypass credentials.
- **Reach it only over a VPN or AWS session login:** rejected; too awkward for several Engineers working from different places, and the sign-in protections carry the load instead.
- **No bypass role, only purpose-built audited database functions:** rejected for now; more work for every admin feature, with little gain once the role lives only in a separately protected service.
- **A separate AWS account for the admin service:** deferred; the same account and network, with its own service, is enough for now. The KSA Instance or an audit may ask for it later.
- **SMS or authenticator-app codes:** SMS rejected (KSA sender registration, cost, foreign numbers, SIM swap); an authenticator app can be added later. Email is used because Rabaed needs to send email anyway, for invitations and password resets.

## Consequences

The first version moves only what exists today: Company onboarding and inviting its Authorized Person, each with a reason, gets simple screens in the new portal. Rabaed must be able to send email before the admin service can go live.
