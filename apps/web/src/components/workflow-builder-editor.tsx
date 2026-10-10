"use client";

import type { BilingualText, Locale, WorkflowBuilderRead, WorkflowDefinition, WorkflowProblem } from "@rabaed/domain";
import { WorkflowBuilder, type WorkflowBuilderLabels, type WorkflowPublishResult, type WorkflowSaveState } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 * the last one, then checked (`POST …/validate`), so the problems listed are the
 * server's; Publish saves what is pending, checks again and publishes (`POST …/publish`).
 */
export function WorkflowBuilderEditor({ read, locale, backHref, names }: Props) {
  const router = useRouter();
  const t = useTranslations("workflowBuilder");
  const tMap = useTranslations("workflowMap");
  const tRoles = useTranslations("projects.roles");
  const { workflow } = read;
  const api = `/api/v1/workflows/${encodeURIComponent(workflow.id)}`;
  const start = workflow.draft?.definition ?? workflow.published?.definition ?? { steps: [], transitions: [], layout: {} };
  const versionNo = workflow.draft?.versionNo ?? Math.max(0, ...workflow.publishedVersions) + 1;

  const [saveState, setSaveState] = useState<WorkflowSaveState>({ kind: "saved", at: new Date() });
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

  const onPublish = useCallback(async (): Promise<WorkflowPublishResult> => {
    // A Workflow opened on its published Version has no draft until it is saved once.
    if (!(await flush()) || (!workflow.draft && !(await save()))) return { ok: false, problems: known.current };
    const res = await fetch(`${api}/publish`, { method: "POST" }).catch(() => null);
    const body = ((await res?.json().catch(() => ({}))) ?? {}) as { versionNo?: number; problems?: WorkflowProblem[] };
    if (res?.ok && body.versionNo !== undefined) {
      router.refresh();
      return { ok: true, versionNo: body.versionNo };
    }
    if (body.problems) show(body.problems);
    return { ok: false, problems: body.problems ?? known.current };
  }, [flush, save, workflow.draft, api, router]);

  const labels = useMemo<WorkflowBuilderLabels>(
    () => ({
      map: {
        canvas: tMap("canvas"),
        list: tMap("listName"),
        outcome: tMap("outcome"),
        role: (role) => tRoles(role),
        permission: (permission) => tMap(`permissions.${permission}`),
        outcomeMode: (mode) => tMap(`outcomeModes.${mode}`),
        kind: (kind) => tMap(`kinds.${kind}`),
        position: (key, role) => read.positions.find((p) => p.key === key && p.role === role)?.name[locale] ?? key,
        part: (role) => tMap("part", { role }),
        withCompany: (company) => tMap("withCompany", { company }),
        current: tMap("current"),
        to: tMap("to"),
        overview: tMap("overview"),
        zoomIn: tMap("zoomIn"),
        zoomOut: tMap("zoomOut"),
        fit: tMap("fit"),
      },
      back: t("back"),
      draft: (version) => t("draft", { version }),
      saved: (time) => t("saved", { time }),
      saving: t("saving"),
      unsaved: t("unsaved"),
      saveFailed: t("saveFailed"),
      undo: t("undo"),
      redo: t("redo"),
      autoLayout: t("autoLayout"),
      testRun: t("testRun"),
      validate: t("validate"),
      publish: t("publish"),
      palette: t("palette"),
      add: t("add"),
      step: t("step"),
      end: (stage) => t("end", { stage }),
      templates: t("templates"),
      templateInternal: t("templateInternal"),
      templateConsultant: t("templateConsultant"),
      editor: t("editor"),
      nothingSelected: t("nothingSelected"),
      nothingSelectedHint: t("nothingSelectedHint"),
      thisDraft: t("thisDraft"),
      counts: (steps, transitions) => t("counts", { steps, transitions }),
      stepHeading: t("stepHeading"),
      nameEn: t("nameEn"),
      nameAr: t("nameAr"),
      stage: t("stage"),
      whoHolds: t("whoHolds"),
      role: t("role"),
      permission: t("permission"),
      positions: t("positions"),
      positionsHelp: t("positionsHelp"),
      outcomeHeading: t("outcomeHeading"),
      outcomeNone: t("outcomeNone"),
      draftsVisibleTo: t("draftsVisibleTo"),
      draftsWholeCompany: t("draftsWholeCompany"),
      draftsAuthorOnly: t("draftsAuthorOnly"),
      draftsVisibleHelp: t("draftsVisibleHelp"),
      addTransitionTo: t("addTransitionTo"),
      addTransitionHelp: t("addTransitionHelp"),
      deleteStep: t("deleteStep"),
      endHeading: t("endHeading"),
      transitionHeading: (from, to) => t("transitionHeading", { from, to }),
      labelEn: t("labelEn"),
      labelAr: t("labelAr"),
      kind: t("kind"),
      outcomeCode: t("outcomeCode"),
      noOutcome: t("noOutcome"),
      screen: t("screen"),
      screenHelp: t("screenHelp"),
      internalNoteOnly: t("internalNoteOnly"),
      confirm: t("confirm"),
      deleteTransition: t("deleteTransition"),
      problemsName: t("problemsName"),
      noErrors: t("noErrors"),
      errors: (count) => t("errors", { count }),
      warnings: (count) => t("warnings", { count }),
      showProblem: (message) => t("showProblem", { message }),
      validationPassed: t("validationPassed"),
      errorsToFix: (count) => t("errorsToFix", { count }),
      testRunAt: t("testRunAt"),
      finished: (outcome) => t("finished", { outcome }),
      restart: t("restart"),
      closeTestRun: t("closeTestRun"),
      publishTitle: (version) => t("publishTitle", { version }),
      changesSince: (version) => t("changesSince", { version }),
      firstVersion: t("firstVersion"),
      added: t("added"),
      removed: t("removed"),
      changed: t("changed"),
      noChanges: t("noChanges"),
      checking: t("checking"),
      passed: t("passed"),
      errorsBlock: (count) => t("errorsBlock", { count }),
      showProblems: t("showProblems"),
      appliesToNew: (version) => t("appliesToNew", { version }),
      cancel: t("cancel"),
      publishVersion: (version) => t("publishVersion", { version }),
      published: (version) => t("published", { version }),
      close: t("close"),
      names,
    }),
    [t, tMap, tRoles, read.positions, locale, names],
  );

  const name: BilingualText = workflow.draft?.name ?? workflow.name;
  return (
    <WorkflowBuilder
      // A publish refreshes the page onto the new Version: start again from what the server has.
      key={`${versionNo}:${workflow.publishedVersions.length}`}
      name={name[locale]}
      versionNo={versionNo}
      published={workflow.published}
      definition={start}
      stages={read.stages}
      outcomes={read.outcomes}
      positions={read.positions}
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
