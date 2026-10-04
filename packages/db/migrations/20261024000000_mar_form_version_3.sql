-- The MAR Form Version 3 (RP-294, spec RP-289; form-engine.md §2.10).
--
-- Version 2 plus an optional "Related submittals" link question
-- (`work_item_ref`, form-engine.md part 2b) in its own References section:
-- the filler picks earlier Submitted items they can see in the Project, and
-- each pick is a Link of the MAR under the question's key. No Rabaed Default
-- makes it required. Every other field is Version 2's, unchanged.
--
-- Published here as data, as a Rabaed Default, like Version 2, so every
-- environment has it as soon as it is migrated. The publish-time checks
-- (form-publish.ts) can't run in SQL; mar-form-v3.test.ts runs them on this
-- Version against Versions 1 and 2, and published Versions never change.
--
-- New MARs pin it (app.latest_form_version). MARs already on Version 1 or 2
-- keep theirs: they show and validate with it, leaving Draft included.

insert into form_version (form_definition_id, version_no, status, published_at, schema)
select t.form_definition_id, 3, 'published', now(), $schema$
  {
    "sections": [
      {
        "key": "material",
        "title": { "en": "Material details", "ar": "تفاصيل المادة" },
        "fields": [
          { "key": "manufacturer", "type": "text", "required": true,
            "label": { "en": "Manufacturer", "ar": "المصنّع" } },
          { "key": "model", "type": "text", "required": false,
            "label": { "en": "Model", "ar": "الطراز" } },
          { "key": "specification_section", "type": "text", "required": false,
            "label": { "en": "Specification section", "ar": "بند المواصفات" },
            "help": { "en": "The section of the Project specification this material answers.",
                      "ar": "بند مواصفات المشروع الذي تستوفيه هذه المادة." } },
          { "key": "description", "type": "textarea", "required": true,
            "label": { "en": "Description", "ar": "الوصف" } }
        ]
      },
      {
        "key": "quantities",
        "title": { "en": "Items", "ar": "البنود" },
        "fields": [
          { "key": "items", "type": "table", "required": false,
            "label": { "en": "Items", "ar": "البنود" },
            "help": { "en": "Each fixture or product this submittal covers, with how many the Project will use.",
                      "ar": "كل وحدة أو منتج يشمله هذا الاعتماد، مع الكمية التي سيستخدمها المشروع." },
            "columns": [
              { "key": "fixture_type", "type": "text", "required": true, "maxLength": 200,
                "label": { "en": "Fixture type", "ar": "نوع الوحدة" } },
              { "key": "description", "type": "text", "required": false, "maxLength": 500,
                "label": { "en": "Description", "ar": "الوصف" } },
              { "key": "quantity", "type": "number", "required": true, "min": 0, "decimals": 2, "total": true,
                "label": { "en": "Quantity", "ar": "الكمية" } },
              { "key": "unit", "type": "select", "required": true,
                "label": { "en": "Unit", "ar": "الوحدة" },
                "options": [
                  { "value": "pcs", "label": { "en": "Pieces", "ar": "قطعة" } },
                  { "value": "m", "label": { "en": "Metres", "ar": "متر" } },
                  { "value": "m2", "label": { "en": "Square metres", "ar": "متر مربع" } },
                  { "value": "set", "label": { "en": "Sets", "ar": "طقم" } }
                ] }
            ] }
        ]
      },
      {
        "key": "documents",
        "title": { "en": "Documents", "ar": "المستندات" },
        "fields": [
          { "key": "datasheet", "type": "attachments", "required": true, "contentTypes": ["application/pdf"],
            "label": { "en": "Datasheet (PDF)", "ar": "نشرة البيانات (PDF)" },
            "help": { "en": "The manufacturer's datasheet for this material.",
                      "ar": "نشرة بيانات المصنّع لهذه المادة." } },
          { "key": "test_certificate", "type": "attachments", "required": false,
            "label": { "en": "Test certificate", "ar": "شهادة الاختبار" } },
          { "key": "sample_photo", "type": "photos", "required": false,
            "label": { "en": "Sample photo", "ar": "صورة العينة" } }
        ]
      },
      {
        "key": "references",
        "title": { "en": "References", "ar": "المراجع" },
        "fields": [
          { "key": "related_submittals", "type": "work_item_ref", "required": false,
            "label": { "en": "Related submittals", "ar": "الاعتمادات ذات الصلة" },
            "help": { "en": "Earlier submittals this one relies on, such as an approved MAR. Only Submitted items you can see in this Project can be picked.",
                      "ar": "اعتمادات سابقة يعتمد عليها هذا الاعتماد، مثل اعتماد مواد معتمد. يمكن اختيار البنود المقدَّمة التي تراها في هذا المشروع فقط." } }
        ]
      },
      {
        "key": "classification",
        "title": { "en": "Classification", "ar": "التصنيف" },
        "fields": [
          { "key": "trade", "type": "trade", "required": true,
            "label": { "en": "Trade", "ar": "التخصص" } },
          { "key": "location", "type": "location", "required": true,
            "label": { "en": "Location", "ar": "الموقع" } },
          { "key": "scopes", "type": "scopes", "required": false,
            "label": { "en": "Scopes", "ar": "النطاقات" },
            "help": { "en": "The Scopes of the chosen Trade this material is for.",
                      "ar": "نطاقات التخصص المختار التي تخصها هذه المادة." } }
        ]
      }
    ]
  }
$schema$::jsonb
from work_item_type t
where t.owner_kind = 'rabaed' and t.code = 'MAR';
