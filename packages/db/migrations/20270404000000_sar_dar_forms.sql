-- RP-591 (spec RP-598, Submittals; form-engine.md §2.11): the Supplier Approval Request
-- (SAR) and the Document Approval Request (DAR) get a Form definition of their own.
--
-- Until now both Types pointed at the MAR's Form definition (20270118000000_rabaed_default_types.sql),
-- so a new MAR Form Version reached them too. Each now has its own, empty definition: the
-- documents apps/admin/forms/SAR.json and DAR.json are published into them by `pnpm
-- defaults:publish`. Items already raised keep the MAR Form Version they are pinned to
-- (ADR 0006); new items take the Type's own Form once it has a published Version.
-- Data only: no function changes.

do $$
  declare
    v_type record;
    v_form uuid;
  begin
    for v_type in
      select id, name from work_item_type
      where owner_kind = 'rabaed' and code in ('SAR', 'DAR')
        and form_definition_id = (select form_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR')
      order by code
    loop
      insert into form_definition (owner_kind, name) values ('rabaed', v_type.name) returning id into v_form;
      update work_item_type set form_definition_id = v_form where id = v_type.id;
    end loop;
  end
$$;
