-- RP-590 (spec RP-598): the Submittals Module's three Types are the Material Approval
-- Request (MAR), the Supplier Approval Request (SAR) and the Document Approval Request
-- (DAR). SAR was "Shop Drawing Submittal" and DAR "Document Submittal"
-- (20270118000000_rabaed_default_types.sql); Shop Drawings belong to Drawings (RP-30).
-- Codes unchanged.
update work_item_type
set name = '{"en": "Supplier Approval Request", "ar": "طلب اعتماد مورد"}'::jsonb
where owner_kind = 'rabaed' and code = 'SAR';

update work_item_type
set name = '{"en": "Document Approval Request", "ar": "طلب اعتماد مستند"}'::jsonb
where owner_kind = 'rabaed' and code = 'DAR';
