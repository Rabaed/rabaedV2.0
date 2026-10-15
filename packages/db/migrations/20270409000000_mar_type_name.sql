-- Review fixes for spec RP-598: the MAR Type is the Material Approval Request
-- («طلب اعتماد مواد»), as GLOSSARY.md names it beside the Supplier and Document Approval
-- Requests (20270403000000_submittal_type_names.sql renamed those two). It was "Material
-- Submittal" («اعتماد المواد», 20260929000000_work_items.sql). Code unchanged. Its Rabaed
-- Default Form keeps its definition's name in step.
--
-- The search text holds each item's Type name (app.refresh_work_item_search), so the items of
-- the three renamed Types are indexed again: a search finds them by their names now.
update work_item_type
set name = '{"en": "Material Approval Request", "ar": "طلب اعتماد مواد"}'::jsonb
where owner_kind = 'rabaed' and code = 'MAR';

update form_definition
set name = '{"en": "Material Approval Request (MAR)", "ar": "طلب اعتماد مواد (MAR)"}'::jsonb
where owner_kind = 'rabaed' and name ->> 'en' = 'Material Submittal (MAR)';

select app.refresh_work_item_search(w.id)
from work_item w
join work_item_type t on t.id = w.work_item_type_id
where t.owner_kind = 'rabaed' and t.code in ('MAR', 'SAR', 'DAR');
