# The Project, not the Company, is the tenancy boundary

In a normal B2B SaaS each customer is a tenant and sees only its own data. Rabaed doesn't work that way: a Contractor can take part in Customer A's Project and Customer B's Project at the same time, so the Company can't be the wall. We isolate data per Project instead. A Company sees a Project only while it is a Participant (or through Signatory Access), and every row of Project data carries `project_id`. Company-owned data (Members, the Company's library) carries `company_id`.

All customers share one database per Instance (pooled), with isolation enforced in three layers:

1. **Application authorization** on every request.
2. **PostgreSQL row-level security** on every tenant table. The request's Member is set as a transaction-local setting, so a missed `WHERE` clause returns nothing instead of another customer's data.
3. **Scoped object storage.** File keys are prefixed by Project and served only through short-lived signed URLs.

Search indexes, caches and background jobs carry the same Project context. Rabaed Admin uses a separate database role that bypasses RLS; every use of it is written to `admin_action`.

## Considered Options

- **A database or schema per customer:** rejected because Projects are shared across customers, so there is no clean customer to split by.
- **A database per Project:** rejected as too costly to operate at hundreds of Projects.

A dedicated deployment for a single large customer remains possible later through the Instance mechanism (ADR 0005).
