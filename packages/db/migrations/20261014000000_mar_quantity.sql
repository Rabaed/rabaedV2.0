-- The MAR Form Version 1 gets its quantity (RP-272, spec RP-261).
--
-- Version 1 is the part-1 MAR: manufacturer, model, quantity (a number with its
-- unit), specification section and description, with Trade, Location and Scopes
-- as Built-in Fields. The skeleton's Version 1 had no quantity; this adds it
-- (optional, so no item pinned to Version 1 becomes incomplete) the way the
-- Built-in Fields migration placed Trade, Location and Scopes: dev and CI hold
-- demo and test data only, and no customer Work Item exists yet, so Version 1
-- is completed in place. The richer MAR (table of items, named attachment
-- fields, supplier pick list) is Version 2, published through RP-271.

alter table form_version disable trigger form_version_published_frozen;
update form_version v set schema = jsonb_set(
  v.schema,
  '{sections,0,fields}',
  (
    select jsonb_agg(f.field order by f.pos)
    from (
      select field, ord as pos from jsonb_array_elements(v.schema -> 'sections' -> 0 -> 'fields') with ordinality as t(field, ord)
      union all
      select $quantity$
        { "key": "quantity", "type": "number", "unit": "pcs", "min": 0, "decimals": 2, "required": false,
          "label": { "en": "Quantity", "ar": "الكمية" },
          "help": { "en": "How many of this material the Project will use, in pieces.",
                    "ar": "كمية هذه المادة التي سيستخدمها المشروع، بالقطعة." } }
      $quantity$::jsonb, 2.5
    ) f
  )
)
from work_item_type t
where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.form_definition_id = t.form_definition_id and v.version_no = 1
  and not jsonb_path_exists(v.schema, '$.sections[*].fields[*] ? (@.key == "quantity")');
alter table form_version enable trigger form_version_published_frozen;
