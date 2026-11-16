-- RP-1306: an approved supplier links to the SAR that approved it, for a Member who sees that SAR (visibility.md
-- V10, amended narrowly by the owner on 2026-11-16, RP-1306 comment 15896; scenarios RP-1306-1 to RP-1306-5).
--
-- * app.approved_supplier_approvals gives, for each entry of the Project's Approved Supplier List that a
--   Supplier Approval Request added (`source_work_item_id`), that SAR's id, Document Number and Subject, and
--   only where app.sees_work_item holds for the caller now. So a Member reads nothing they can't already open,
--   and narrowing their Visibility takes the row away at the next read.
-- * An entry a Project Admin added by hand (`source` 'preloaded') has no SAR, so it has no row: it reads exactly
--   like an entry whose SAR the caller can't see, and a missing row never tells another Company that a hidden
--   SAR exists.
-- * No table change and no column grant change: the app role still has no grant on `source` or
--   `source_work_item_id`. No order: the api joins the rows to the list by supplier id.
create function app.approved_supplier_approvals(p_project_id uuid)
  returns table (supplier_id uuid, work_item_id uuid, document_number text, subject text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, w.id, w.document_number, w.title
        from approved_supplier s
        join work_item w on w.id = s.source_work_item_id and w.project_id = s.project_id
        where s.project_id = p_project_id
          and app.sees_work_item(w.id);
    end
  $$;

revoke all on function app.approved_supplier_approvals(uuid) from public;
grant execute on function app.approved_supplier_approvals(uuid) to rabaed_app;
