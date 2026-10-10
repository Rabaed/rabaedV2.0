-- The Draft Stage reads "Draft" (owner decision 2026-10-10, RP-409): one item's Status,
-- as every other Stage name reads, not a pile ("Drafts"). The Rabaed Default Stages of
-- every Module, and each Project's copy that still has the default name (one a Project
-- Admin renamed keeps its own, app.rename_stage). Projects created from now on copy
-- the new name (app.copy_rabaed_stages).

update stage set name = '{"en": "Draft", "ar": "مسودة"}'::jsonb, updated_at = now()
where key = 'draft' and name = '{"en": "Drafts", "ar": "المسودات"}'::jsonb;
