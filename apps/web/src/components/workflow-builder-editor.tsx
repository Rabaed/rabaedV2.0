"use client";

import { type BilingualText, type Locale, type WorkflowBuilderRead, type WorkflowDefinition, type WorkflowProblem } from "@rabaed/domain";
import { WorkflowBuilder, workflowBuilderLabels, type WorkflowBuilderLabels, type WorkflowPublishResult, type WorkflowSaveState } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActionFormLabels } from "@/lib/form-labels";

type Props = {
  read: WorkflowBuilderRead;
  locale: Locale;
  backHref: string;
  /** The names the builder gives what it adds, in English and Arabic. */
  names: WorkflowBuilderLabels["names"];
};

/** How long after the last edit the draft is saved and checked. */
const SAVE_DELAY_MS = 800;

/**
 * The Workflow builder page's client (RP-439, WF-16): every edit is saved as the
 * Workflow's draft through WF-4's API (`PUT /v1/workflows/:id/draft`) a moment after
 * the last one, then checked (`POST â€¦/validate`), so the problems listed are the
 * server's; Publish saves what is pending, checks again and publishes (`POST â€¦/publish`).
 */
export function WorkflowBuilderEditor({ read, locale, backHref, names }: Props) {
  const router = useRouter();
  const t = useTranslations("workflowBuilder");
  const tMap = useTranslations("workflowMap");
  const tRules = useTranslations("workflowRules");
  const tRoles = useTranslations("projects.roles");
  const { workflow } = read;
  const api = `/api/v1/workflows/${encodeURIComponent(workflow.id)}`;
  const start = workflow.draft?.definition ?? workflow.published?.definition ?? { steps: [], transitions: [], layout: {} };
  const versionNo = workflow.draft?.versionNo ?? Math.max(0, ...workflow.publishedVersions) + 1;

  // Nothing saved yet: the bar says nothing until the first save.
  const [saveState, setSaveState] = useState<WorkflowSaveState>({ kind: "opened" });
  const [problems, setProblems] = useState<readonly WorkflowProblem[]>([]);
  const latest = useRef<WorkflowDefinition>(start);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);

  const known = useRef<readonly WorkflowProblem[]>([]);
  const show = (found: readonly WorkflowProblem[]) => {
    known.current = found;
    setProblems(found);
  };

  /** The server's check of `definition`; what it last found when it can't be reached. */
  const check = useCallback(
    async (definition: WorkflowDefinition): Promise<readonly WorkflowProblem[]> => {
      try {
        const res = await fetch(`${api}/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition }) });
        if (!res.ok) return known.current;
        const found = ((await res.json()) as { problems: WorkflowProblem[] }).problems;
        show(found);
        return found;
      } catch {
        return known.current;
      }
    },
    [api],
  );

  const save = useCallback(async (): Promise<boolean> => {
    pending.current = null;
    const definition = latest.current;
    setSaveState({ kind: "saving" });
    try {
      const res = await fetch(`${api}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition }) });
      setSaveState(res.ok ? { kind: "saved", at: new Date() } : { kind: "failed" });
      return res.ok;
    } catch {
      setSaveState({ kind: "failed" });
      return false;
    }
  }, [api]);

  /** Saves what is pending now, waiting for a save already under way. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (pending.current) {
      clearTimeout(pending.current);
      saving.current = save();
    }
    return saving.current ? saving.current : true;
  }, [save]);

  const onChange = useCallback(
    (definition: WorkflowDefinition) => {
      latest.current = definition;
      setSaveState({ kind: "unsaved" });
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        saving.current = save();
        void saving.current.then(() => check(latest.current));
      }, SAVE_DELAY_MS);
    },
    [save, check],
  );

  // The draft as it opens is checked once; leaving with a save pending asks first.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void check(latest.current);
  }, [check]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  const onValidate = useCallback(async () => {
    await flush();
    return check(latest.current);
  }, [flush, check]);

  const onPublish = useCallback(
    async (changeNote: string): Promise<WorkflowPublishResult> => {
      // A Workflow opened on its published Version has no draft until it is saved once.
      if (!(await flush()) || (!workflow.draft && !(await save()))) return { ok: false, problems: known.current };
      const res = await fetch(`${api}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeNote }) }).catch(() => null);
      const body = ((await res?.json().catch(() => ({}))) ?? {}) as { versionNo?: number; problems?: WorkflowProblem[] };
      if (res?.ok && body.versionNo !== undefined) {
        // As the reference (owner's decision 4, RP-555): the builder stays, says the draft is published and links to its Versions; the page reads the new Version underneath.
        router.refresh();
        return { ok: true, versionNo: body.versionNo };
      }
      if (body.problems) show(body.problems);
      return { ok: false, problems: body.problems ?? known.current };
    },
    [flush, save, workflow.draft, api, router],
  );

  const actionFormLabels = useActionFormLabels();
  // A Project's Workflow has its Versions and Screens pages; a Library one is edited here only.
  const project = workflow.owner === "project" && workflow.projectId ? `/${locale}/projects/${workflow.projectId}/settings` : null;
  const versionsHref = useMemo(() => (project ? (n: number) => `${project}/workflows/${workflow.id}/versions/${n}` : undefined), [project, workflow.id]);

  const labels = useMemo<WorkflowBuilderLabels>(
    () => workflowBuilderLabels({ t, tMap, tRules, tRoles, positions: read.positions, locale, names }),
    [t, tMap, tRoles, tRules, read.positions, locale, names],
  );

  const name: BilingualText = workflow.draft?.name ?? workflow.name;
  return (
    <WorkflowBuilder
      // Not keyed by Version: a publish keeps the builder (its "Published" badge) while the page reads the new Version.
      name={name[locale]}
      versionNo={versionNo}
      published={workflow.published}
      definition={start}
      stages={read.stages}
      outcomes={read.outcomes}
      positions={read.positions}
      form={read.form}
      typeCode={read.type.code}
      actionFormLabels={actionFormLabels}
      versionsHref={versionsHref}
      screensHref={project ? `${project}/screens` : undefined}
      screens={read.screens}
      running={read.running}
      locale={locale}
      labels={labels}
      problems={problems}
      saveState={saveState}
      backHref={backHref}
      onChange={onChange}
      onValidate={onValidate}
      onPublish={onPublish}
    />
  );
}
