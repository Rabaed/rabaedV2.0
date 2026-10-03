# Form answers stored as JSONB against immutable Form versions

Because customers build their own Forms, Work Item answers can't live in fixed columns. We store each Work Item's answers as one JSONB document, validated against the published, immutable Form version the item is pinned to. We rejected an entity-attribute-value table (slow and awkward to query and to seal as one hashable snapshot) and generating a real table per Form (schema migrations at customer runtime, hard to version). The cost is that reporting on specific fields needs JSONB indexes or a derived reporting store.

The same pinning applies to Workflows. Visibility is enforced through a materialised `work_item_access` table combined with Postgres row-level security, rather than evaluating Workflow rules on every read.

## Exception: the MAR Form Version 1 was completed in place (2026-10-03)

The migration `20261012000000_built_in_fields.sql` (RP-270) changed the published MAR Form Version 1. It switched off the `form_version_published_frozen` trigger for one update, which added the Built-in Fields Trade, Location and Scopes in a Classification section.

- **Why in place:** spec RP-261 defines Version 1 as containing the Built-in Fields, and is completing it ticket by ticket (RP-272 finishes it). Version 1 was published earlier in the same spec, and has only ever existed in dev, which holds demo data and is re-seeded. A Version 2 would have left every existing item pinned to a schema without the fields its answers now carry.
- **Not a precedent.** Once a Form Version is published on an Instance where any customer has filled it, it never changes, without exception. A correction there is a new Version, and old items keep theirs.
- **Further changes in RP-261.** Before Version 1 reaches such an Instance, any further change to it is made the same way: one migration that says so, with the trigger switched off only for that update. After that, the rule above applies.
