-- Rabaed Admin -> Workflows (RP-443, WF-20; spec RP-423; workflow-engine.md section 1
-- "Authoring"): a Rabaed Engineer duplicates a Rabaed Default Workflow into another Type's
-- draft and edits the Rabaed Default outcome sets and Stage sets, each action logged in
-- admin_action with its reason (visibility.md V9). Only the actions the log may hold grow:
-- the rows are written by Rabaed Admin on the admin connection, which bypasses row-level
-- security and already writes `outcome` and `stage`.
alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option',
    'read_numbering', 'set_numbering_pattern', 'set_participant_code', 'set_numbering_counter_start',
    'save_workflow_draft', 'publish_workflow',
    'duplicate_workflow', 'add_default_outcome', 'change_default_outcome', 'reorder_default_outcomes',
    'add_default_stage', 'rename_default_stage', 'reorder_default_stages'
  ));
