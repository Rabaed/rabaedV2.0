# Form answers stored as JSONB against immutable Form versions

Because customers build their own Forms, Work Item answers can't live in fixed columns. We store each Work Item's answers as one JSONB document, validated against the published, immutable Form version the item is pinned to. We rejected an entity-attribute-value table (slow and awkward to query and to seal as one hashable snapshot) and generating a real table per Form (schema migrations at customer runtime, hard to version). The cost is that reporting on specific fields needs JSONB indexes or a derived reporting store.

The same pinning applies to Workflows. Visibility is enforced through a materialised `work_item_access` table combined with Postgres row-level security, rather than evaluating Workflow rules on every read.
