/**
 * A test-only Rabaed Workflow with a Send Back (ADR 0014; RP-334), since no
 * Rabaed Default uses one yet (the MAR keeps Code C only):
 *
 *   Draft ─send_for_review→ Contractor review ─submit→ Consultant review
 *   Contractor review ─return→ Draft
 *   Consultant review ─send_back→ Contractor review          (the Send Back)
 *   Consultant review ─send_back_to_draft→ Draft             (a Send Back to the Draft)
 *   Consultant review ─send_to_manager→ Consultant approval (issues the Code)
 *   Consultant approval ─return_to_engineer→ Consultant review
 *   Consultant approval ─approve_a→ Approved · A, ─revise_c→ Revise & Resubmit · C
 *
 * It passes publish checks 4 and 8, as every published Version must. `run`
 * executes SQL as the migrator (a pg client's or Kysely's query); the result is
 * the new Workflow definition's id, for a test Type to use.
 *
 * By default a Rabaed Default named "Send Back (test)", Version 1, published.
 * `owner` makes it a Project's or a Company's Library Workflow (ADR 0016),
 * `name` names it, `version` adds Version n to an existing definition instead
 * of a new one, and `publish: false` leaves that Version a draft.
 */
export async function addSendBackWorkflow(
  run: (text: string) => Promise<{ rows: unknown[] }>,
  options: SendBackWorkflowOptions = {},
): Promise<string> {
  const { withApproveB = false, publish = true } = options;
  const name = JSON.stringify(options.name ?? { en: "Send Back (test)", ar: "الإرجاع (اختبار)" }).replaceAll("'", "''");
  const owner = options.owner;
  const definition = options.version
    ? `select '${options.version.definitionId}'::uuid as id`
    : `insert into workflow_definition (owner_kind, project_id, company_id, name)
      values ('${owner?.kind ?? "rabaed"}', ${owner?.kind === "project" ? `'${owner.projectId}'` : "null"},
        ${owner?.kind === "company" ? `'${owner.companyId}'` : "null"}, '${name}')
      returning id`;
  const { rows } = await run(`
    with definition as (
      ${definition}
    ), version as (
      insert into workflow_version (workflow_definition_id, version_no, status)
      select id, ${options.version?.no ?? 1}, 'draft' from definition
      returning id
    ), steps as (
      insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode)
      select version.id, s.key, s.name::jsonb, s.stage_key, s.actor_rule::jsonb, s.outcome_mode
      from version, (values
        ('draft', '{"en": "Draft", "ar": "مسودة"}', 'draft', '{"base_role": "contractor", "permission": "create"}', 'none'),
        ('internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
          '{"base_role": "contractor", "permission": "review"}', 'none'),
        ('consultant_review', '{"en": "Consultant review", "ar": "مراجعة الاستشاري"}', 'pending_approval',
          '{"base_role": "consultant", "permission": "review"}', 'none'),
        ('consultant_approval', '{"en": "Consultant approval", "ar": "اعتماد الاستشاري"}', 'internal_review',
          '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
        ('approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none'),
        ('revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}', 'revise_resubmit', '{}', 'none')
      ) as s (key, name, stage_key, actor_rule, outcome_mode)
      returning id, key, workflow_version_id
    ), transitions as (
      insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
      select f.workflow_version_id, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort
      from (values
        ('send_for_review', 'draft', 'internal_review', '{"en": "Send for Review", "ar": "إرسال للمراجعة"}', 'send', null, 'create', 1),
        ('return', 'internal_review', 'draft', '{"en": "Return", "ar": "إعادة"}', 'return', null, 'review', 2),
        ('submit', 'internal_review', 'consultant_review', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 3),
        ('send_back', 'consultant_review', 'internal_review', '{"en": "Send Back", "ar": "إرجاع إلى المقدّم"}', 'send_back', null, 'review', 4),
        ('send_back_to_draft', 'consultant_review', 'draft', '{"en": "Send Back to Draft", "ar": "إرجاع إلى المسودة"}',
          'send_back', null, 'review', 5),
        ('send_to_manager', 'consultant_review', 'consultant_approval', '{"en": "Send to Manager", "ar": "إرسال للمدير"}',
          'send', null, 'review', 6),
        ('return_to_engineer', 'consultant_approval', 'consultant_review', '{"en": "Return to Engineer", "ar": "إعادة للمهندس"}',
          'return', null, 'approve', 7),
        ('approve_a', 'consultant_approval', 'approved', '{"en": "Approve · A", "ar": "اعتماد · A"}', 'close', 'A', 'approve', 8),
        ('revise_c', 'consultant_approval', 'revise_resubmit', '{"en": "Revise · C", "ar": "مراجعة · C"}', 'close', 'C', 'approve', 9)
        ${withApproveB ? `, ('approve_b', 'consultant_approval', 'approved', '{"en": "Approve with Comments · B", "ar": "اعتماد مع ملاحظات · B"}',
          'close', 'B', 'approve', 10)` : ""}
      ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
      join steps f on f.key = t.from_key
      join steps s on s.key = t.to_key
      returning id
    )
    select definition.id, version.id as version_id from definition, version where (select count(*) from transitions) > 0
  `);
  const row = rows[0] as { id?: string; version_id?: string } | undefined;
  if (!row?.id) throw new Error("addSendBackWorkflow: nothing inserted");
  // Built as a draft, then published: a published Version takes no new parts (RP-424).
  if (publish) await run(`update workflow_version set status = 'published', published_at = now() where id = '${row.version_id}'`);
  return row.id;
}

export type SendBackWorkflowOptions = {
  withApproveB?: boolean;
  name?: { en: string; ar: string };
  /** A Project's own Workflow, or one in a Company's Library; a Rabaed Default when left out. */
  owner?: { kind: "project"; projectId: string } | { kind: "company"; companyId: string };
  /** Adds Version `no` to the definition `definitionId` rather than creating one. */
  version?: { definitionId: string; no: number };
  /** False leaves the new Version a draft. */
  publish?: boolean;
};
