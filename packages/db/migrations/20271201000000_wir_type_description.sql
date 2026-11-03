-- RP-1221: the WIR's one-line description, in both languages, for its Type card in the New
-- item's panel ("The Types you may raise"; gap row 12, approved 2026-11-02), as RP-1152 gave
-- the Submittals' three (20271130000000_work_item_type_description.sql).
update work_item_type
set description = '{"en": "Ask the Consultant to inspect work that is ready on site", "ar": "اطلب من الاستشاري معاينة أعمال جاهزة في الموقع"}'::jsonb
where owner_kind = 'rabaed' and code = 'WIR';
