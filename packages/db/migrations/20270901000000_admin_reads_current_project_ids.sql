-- RP-645: Rabaed Admin runs the api's import code as the default Member on rabaed_admin,
-- which reads past row-level security. The import's own reads of a Project and of an import
-- say the tables' policies again (app.current_project_ids: the session's Member's Projects),
-- so an Engineer's import reads exactly what the default Member reads through the customer
-- api. It answers for the session's Member only.
grant execute on function app.current_project_ids() to rabaed_admin;
