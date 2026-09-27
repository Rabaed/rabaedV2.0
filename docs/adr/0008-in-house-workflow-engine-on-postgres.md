# In-house workflow engine on PostgreSQL, not a BPM product

Rabaed's Workflows are human-paced, small graphs (roughly 3–15 Steps) whose every Transition must, in one transaction, respect row-level-security visibility, append to the hash-chained audit trail, freeze Documents and assign gap-free Document Numbers. We build the engine as a state machine in our own code over PostgreSQL, with a transactional outbox for side effects (notifications, PDF sealing, emails).

## Considered Options

- **Camunda / BPMN engines:** rejected. They keep their own state store outside our transaction and RLS, so every action would have to be kept consistent across two systems, and BPMN is far richer than the builder needs.
- **Temporal / durable-execution frameworks:** rejected for the Workflow itself, because there are no timers or SLAs to orchestrate. They remain an option for background jobs.

## Consequences

Parallel branches, timers and sub-processes are not supported until we build them (see the open questions in workflow-engine.md).
