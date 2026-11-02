-- RP-1152: a Work Item Type's one-line description, in both languages, for the New item's
-- Type cards ("The Types you may raise"; gap row 18, approved 2026-11-02). Null for a Type
-- that has none. Filled for the Submittals' three Rabaed Default Types from GLOSSARY.md's
-- meaning of each.
alter table work_item_type
  add column description jsonb check (description is null or app.is_bilingual(description));

comment on column work_item_type.description is
  'RP-1152: a one-line description in both languages ({"en", "ar"}), shown on the New item''s Type card. Null when the Type has none.';

update work_item_type
set description = '{"en": "Approval of a material or product from an approved supplier", "ar": "اعتماد مادة أو منتج من مورد معتمد"}'::jsonb
where owner_kind = 'rabaed' and code = 'MAR';

update work_item_type
set description = '{"en": "Approval of a supplier or manufacturer for the Approved Supplier List", "ar": "اعتماد مورد أو مصنع لقائمة الموردين المعتمدين"}'::jsonb
where owner_kind = 'rabaed' and code = 'SAR';

update work_item_type
set description = '{"en": "Approval of a document, such as a report, a calculation or a plan", "ar": "اعتماد مستند، مثل تقرير أو حسابات أو خطة"}'::jsonb
where owner_kind = 'rabaed' and code = 'DAR';
