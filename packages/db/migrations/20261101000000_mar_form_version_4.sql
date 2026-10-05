-- The MAR Form Version 4 (RP-306, spec RP-299; form-engine.md §4 "MAR Form Version 4").
--
-- Version 3 plus the Consultant verification section, filled in only by the
-- Consultant at its review Step (`editable_at: ["consultant_review"]`, RP-301,
-- RP-304): Sample checked and Matches specification (yes/no, both required) and a
-- Verification note (textarea, required when Matches specification is No). It sits
-- before Classification; every other section and field is Version 3's, unchanged.
-- Its required fields are checked only on a forward Transition out of
-- consultant_review (the Code), never when the Contractor leaves Draft or on a Return.
--
-- Published here as data, as a Rabaed Default, like Versions 2 and 3, so every
-- environment has it as soon as it is migrated. The publish-time checks
-- (form-publish.ts) can't run in SQL; mar-form-v4.test.ts runs them on this Version
-- against Versions 1 to 3 and the MAR's Workflow, and published Versions never change.
--
-- New MARs pin it (app.latest_form_version). MARs already on Version 1, 2 or 3 keep
-- theirs: they show and validate with it, leaving Draft included.

insert into form_version (form_definition_id, version_no, status, published_at, schema)
select t.form_definition_id, 4, 'published', now(),
  jsonb_insert(v3.schema, '{sections,4}', $section$
    {
      "key": "consultant_verification",
      "title": { "en": "Consultant verification", "ar": "تحقق الاستشاري" },
      "editable_at": ["consultant_review"],
      "fields": [
        { "key": "sample_checked", "type": "yes_no", "required": true,
          "label": { "en": "Sample checked", "ar": "تم فحص العينة" } },
        { "key": "matches_specification", "type": "yes_no", "required": true,
          "label": { "en": "Matches specification", "ar": "مطابق للمواصفات" } },
        { "key": "verification_note", "type": "textarea",
          "required": { "field": "matches_specification", "op": "=", "value": false },
          "label": { "en": "Verification note", "ar": "ملاحظة التحقق" },
          "help": { "en": "Say what does not match the specification.",
                    "ar": "اذكر ما لا يطابق المواصفات." } }
      ]
    }
  $section$::jsonb)
from work_item_type t
join form_version v3 on v3.form_definition_id = t.form_definition_id and v3.version_no = 3
where t.owner_kind = 'rabaed' and t.code = 'MAR';
