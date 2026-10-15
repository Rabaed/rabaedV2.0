-- RP-596 (spec RP-598, Submittals; ADR 0022; workflow-engine.md §1 "Rabaed Defaults"): more
-- than one Rabaed Default Workflow for a Work Item Type.
--
-- A Rabaed Default Work Item Type had exactly one Rabaed Default Workflow, the definition its
-- `workflow_definition_id` names. The submittals now have eight (the number of reviewers on each
-- side, 1 or 2, each with and without the Owner's review): the Type's own definition is the one
-- new items start on while a Project binds none, and the others are Rabaed Defaults a Project
-- Admin may bind (app.bind_workflow already accepts any Rabaed Default made for the Type) or
-- duplicate. They are rows of workflow_definition of `owner_kind` 'rabaed' with the Type in
-- `work_item_type_id`, which `pnpm defaults:publish` creates and publishes.
--
-- `default_key` names such a Rabaed Default within its Type ("2-2", "1-1-owner"), so that
-- `defaults:publish` finds the row again and publishes a new Version of it, never a second
-- one. Null on every other Workflow, and on a Rabaed Default no document publishes (a Type's
-- Rabaed Default whose document `defaults:publish` doesn't carry). Data and one constraint only:
-- no function changes.

alter table workflow_definition add column default_key text;

alter table workflow_definition add constraint workflow_definition_default_key_check
  check (default_key is null or (owner_kind = 'rabaed' and work_item_type_id is not null and default_key ~ '^[a-z0-9][a-z0-9-]*$'));

create unique index workflow_definition_default_key_key
  on workflow_definition (work_item_type_id, default_key) where default_key is not null;
