# One Form engine and one Workflow engine for all Work Items

Submittals, Inspections, Snags and the Site Report types are all Work Items: instances of a configurable Work Item Type, each with a Form (built in the form builder) and a versioned Workflow, modelled on Jira's issue types. We chose this over writing each module as its own code, so that Rabaed Defaults, customer-built types, Revisions, Document Numbers and Documental Records work the same everywhere. A new module is then mostly configuration. The cost is that module-specific behaviour has to be expressed through the engines, never hard-coded beside them.

The workflow builder is a visual graph editor (React Flow or similar): Steps are nodes grouped into Stages, and Transitions are edges, each configured with its label, who may take it, its Action Form and its notifications. Stages drive the Kanban columns; Steps are the swimlanes inside them.
