"use client";

import {
  addStep,
  baseRoles,
  connectSteps,
  formatDate,
  formatNumber,
  formFields,
  functionPermissions,
  moveStep,
  outcomeModes,
  parseActionForm,
  removeStep,
  ruleFieldsOf,
  removeTransition,
  transitionKinds,
  updateStep,
  updateTransition,
  type BaseRole,
  type BilingualText,
  type Locale,
  type RuleField,
  type WorkflowDefinition,
  type WorkflowProblem,
  type WorkflowStep,
  type WorkflowTransition,
} from "@rabaed/domain";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Select } from "../form/select.tsx";
import { Icon } from "../icon/icon.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../navigation/tabs.tsx";
import { Dialog, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { TransitionNotifications, TransitionRules } from "./workflow-transition-rules.tsx";
import type { WorkflowBuilderLabels } from "./workflow-builder-labels.ts";
import { canvasDragType, WorkflowCanvas, type CanvasMark, type CanvasSelection } from "./workflow-canvas.tsx";
import { WorkflowChangeList } from "./workflow-changes.tsx";
import { placedLayout, workflowMap, type MapStage } from "./workflow-map.ts";
import { stageVars } from "./workflow-parts.tsx";
import { stageColour } from "../status/stage-colour.ts";

/** Where the draft's saving stands, as the page saving it through WF-4's API knows it. */
export type WorkflowSaveState = { kind: "saved"; at: Date } | { kind: "saving" } | { kind: "unsaved" } | { kind: "failed" };

/** An outcome of the Work Item Type's set, for a closing Transition. */
export type WorkflowBuilderOutcome = { code: string; name: BilingualText; closing: boolean };

/** A Position a Step may name. */
export type WorkflowBuilderPosition = { role: BaseRole; key: string; name: BilingualText };

export type WorkflowPublishResult = { ok: true; versionNo: number } | { ok: false; problems: readonly WorkflowProblem[] };

export type WorkflowBuilderProps = {
  /** The Workflow's name, in the viewer's language. */
  name: string;
  /** The draft's Version number: the Version publishing creates. */
  versionNo: number;
  /** The latest published Version, to list what changed since; null before the first. */
  published: { versionNo: number; definition: WorkflowDefinition } | null;
  /** The draft as it opens. */
  definition: WorkflowDefinition;
  /** The Module's Stages, in order. */
  stages: readonly MapStage[];
  /** The Work Item Type's outcome set. */
  outcomes: readonly WorkflowBuilderOutcome[];
  positions: readonly WorkflowBuilderPosition[];
  /** The fields of the Type's published Form: the only ones a rule's picker lists (RP-440). */
  fields: readonly RuleField[];
  locale: Locale;
  labels: WorkflowBuilderLabels;
  /** Every publish problem of the draft as last checked (WF-4's validate). */
  problems: readonly WorkflowProblem[];
  saveState: WorkflowSaveState;
  /** The back link to the Workflows. */
  backHref: string;
  /** Every edit, for the page to save the draft and check it again. */
  onChange: (definition: WorkflowDefinition) => void;
  /** Checks the draft on the server now (saving anything pending first): its problems. */
  onValidate: () => Promise<readonly WorkflowProblem[]>;
  /** Publishes the draft (the server checks it again). */
  onPublish: () => Promise<WorkflowPublishResult>;
};

type History = { past: WorkflowDefinition[]; present: WorkflowDefinition; future: WorkflowDefinition[] };
type TestRun = { at: string; path: string[]; edges: string[] };
type PublishState = { phase: "checking" } | { phase: "ready"; problems: readonly WorkflowProblem[] } | { phase: "publishing" };

const open = new Set(["draft", "in_progress"]);

/**
 * The Workflow builder (RP-439, WF-16; workflow-engine.md §11), as the design's
 * Settings → Workflows builder (`settings-workflows.html`, `wf/wf.js`): a bar with
 * undo, redo, auto-layout, test run, validate and publish; the palette (a Step,
 * an outcome, a template, clicked or dragged into a Stage's band); the editable
 * canvas; the side editor for the selected Step or Transition; and the validation
 * problems under the canvas, each selecting what it concerns. A Transition shows
 * the Screen it asks (its Action Form) read-only, edited in Settings → Screens.
 * Every edit goes to `onChange`; the page saves the draft through WF-4's API.
 */
export function WorkflowBuilder(props: WorkflowBuilderProps) {
  const { name, versionNo, published, stages, outcomes, positions, fields, locale, labels, problems, saveState, backHref, onChange, onValidate, onPublish } = props;
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    // Pinned where the canvas draws it, so the first Step moved keeps every other one in place.
    present: { ...props.definition, layout: placedLayout(props.definition, stages, true) },
    future: [],
  }));
  const definition = history.present;
  const coalescing = useRef<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [focus, setFocus] = useState<{ key: string; nonce: number } | null>(null);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [publish, setPublish] = useState<PublishState | null>(null);
  const v = (n: number) => formatNumber(n, locale);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Applies an edit. Edits sharing `coalesce` (typing into one field) make one undo step. */
  const commit = useCallback(
    (next: WorkflowDefinition, coalesce: string | null = null) => {
      const merge = coalesce !== null && coalesce === coalescing.current;
      coalescing.current = coalesce;
      setHistory((h) => ({ past: merge ? h.past : [...h.past, h.present].slice(-100), present: next, future: [] }));
      onChange(next);
    },
    [onChange],
  );
  const undo = useCallback(() => {
    const previous = history.past.at(-1);
    if (!previous) return;
    coalescing.current = null;
    setHistory((h) => ({ past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] }));
    onChange(previous);
  }, [history.past, onChange]);
  const redo = useCallback(() => {
    const next = history.future[0];
    if (!next) return;
    coalescing.current = null;
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: h.future.slice(1) }));
    onChange(next);
  }, [history.future, onChange]);

  const select = useCallback((next: CanvasSelection | null) => {
    coalescing.current = null;
    setSelection(next);
  }, []);

  const openStages = useMemo(() => stages.filter((s) => open.has(s.category)), [stages]);
  const endStages = useMemo(() => stages.filter((s) => !open.has(s.category)), [stages]);
  const stepOf = (key: string) => definition.steps.find((s) => s.key === key);
  const isTerminal = (s: WorkflowStep) => s.actor === null || endStages.some((e) => e.key === s.stage);

  /** Where a new Step or outcome goes in a band when it isn't dropped: under what the band holds. */
  const freeSpot = (stage: string, terminal: boolean) => {
    const model = workflowMap({ definition, stages, dir: "ltr", everyStage: true });
    const band = model.bands.find((b) => b.key === (terminal ? "outcome" : stage)) ?? model.bands[0]!;
    const inBand = model.nodes.filter((n) => n.x >= band.x && n.x < band.x + band.width);
    const y = inBand.length === 0 ? 80 : Math.max(...inBand.map((n) => n.y + n.height)) + 40;
    return { x: band.x + (terminal ? 70 : 55), y };
  };

  const addItem = (item: string, stage: string | null, at?: { x: number; y: number }) => {
    if (item === "step") {
      const into = stage && openStages.some((s) => s.key === stage) ? stage : (openStages.find((s) => s.category === "in_progress") ?? openStages[0])?.key;
      if (!into) return;
      const added = addStep(definition, { name: labels.names.newStep, stage: into, actor: { role: "contractor", permission: "review" }, at: at ?? freeSpot(into, false) });
      commit(added.definition);
      select({ kind: "step", key: added.key });
      return;
    }
    if (item.startsWith("end:")) {
      const end = endStages.find((s) => s.key === item.slice(4));
      if (!end) return;
      const added = addStep(definition, { name: end.name, stage: end.key, actor: null, at: at ?? freeSpot(end.key, true) });
      commit(added.definition);
      select({ kind: "step", key: added.key });
      return;
    }
    const internal = item === "template:internal";
    const inProgress = openStages.filter((s) => s.category === "in_progress");
    const into = stage && inProgress.some((s) => s.key === stage) ? stage : (internal ? inProgress[0] : (inProgress[1] ?? inProgress[0]))?.key;
    if (!into) return;
    const base = at ?? freeSpot(into, false);
    const role: BaseRole = internal ? "contractor" : "consultant";
    const first = addStep(definition, {
      name: internal ? labels.names.engineerReview : labels.names.consultantEngineer,
      stage: into,
      actor: { role, permission: "review" },
      at: base,
    });
    const second = addStep(first.definition, {
      name: internal ? labels.names.pmReview : labels.names.consultantManager,
      stage: into,
      actor: { role, permission: "approve" },
      at: { x: base.x, y: base.y + 140 },
    });
    let next = internal ? second.definition : updateStep(second.definition, second.key, { outcomeMode: "issue_outcome" });
    next = connectSteps(next, first.key, second.key, labels.names.send).definition;
    next = connectSteps(next, second.key, first.key, labels.names.return).definition;
    commit(next);
    select(null);
  };

  const connect = (from: string, to: string) => {
    const source = stepOf(from);
    if (!source || isTerminal(source) || !stepOf(to)) return;
    const added = connectSteps(definition, from, to, labels.names.newTransition);
    commit(added.definition);
    select({ kind: "transition", key: added.key });
  };

  const remove = useCallback(() => {
    if (!selection) return;
    commit(selection.kind === "step" ? removeStep(definition, selection.key) : removeTransition(definition, selection.key));
    select(null);
  }, [selection, definition, commit, select]);

  // Keys: Delete removes the selection, Escape clears it, Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=dialog], [role=listbox]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection && !testRun) {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape" && !publish) {
        select(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo, remove, select, selection, testRun, publish]);

  const autoLayout = () => commit({ ...definition, layout: placedLayout({ ...definition, layout: {} }, stages, true) });

  // Test run: from the Draft Step, take a Transition at each Step; the path stays lit, the rest fades.
  const startStep = definition.steps.find((s) => stages.find((st) => st.key === s.stage)?.category === "draft") ?? definition.steps[0];
  const toggleTestRun = () => {
    select(null);
    setTestRun((run) => (run || !startStep ? null : { at: startStep.key, path: [startStep.key], edges: [] }));
  };
  const marks = useMemo(() => {
    if (!testRun) return undefined;
    const out: Record<string, CanvasMark> = {};
    for (const s of definition.steps) out[s.key] = testRun.path.includes(s.key) ? "done" : "faded";
    out[testRun.at] = "current";
    for (const t of definition.transitions) out[t.key] = testRun.edges.includes(t.key) ? "done" : t.from === testRun.at ? "next" : "faded";
    return out;
  }, [testRun, definition]);

  const showProblem = (p: WorkflowProblem) => {
    if (p.transition) {
      select({ kind: "transition", key: p.transition });
      const t = definition.transitions.find((x) => x.key === p.transition);
      if (t) setFocus({ key: t.from, nonce: Date.now() });
    } else if (p.step) {
      select({ kind: "step", key: p.step });
      setFocus({ key: p.step, nonce: Date.now() });
    }
  };

  const validate = async () => {
    const found = await onValidate();
    const errors = found.filter((p) => p.severity === "error").length;
    setToast(errors ? labels.errorsToFix(v(errors)) : labels.validationPassed);
  };

  const openPublish = async () => {
    setPublish({ phase: "checking" });
    setPublish({ phase: "ready", problems: await onValidate() });
  };
  const doPublish = async () => {
    setPublish({ phase: "publishing" });
    const result = await onPublish();
    if (result.ok) {
      setPublish(null);
      setToast(labels.published(v(result.versionNo)));
    } else {
      setPublish({ phase: "ready", problems: result.problems });
    }
  };

  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.length - errors.length;
  const status =
    saveState.kind === "saved"
      ? labels.saved(formatDate(saveState.at, locale, { timeStyle: "short" }))
      : saveState.kind === "saving"
        ? labels.saving
        : saveState.kind === "unsaved"
          ? labels.unsaved
          : labels.saveFailed;

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-2.5 p-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={backHref} aria-label={labels.back} title={labels.back} className="inline-flex size-8 items-center justify-center rounded-sm text-on-ghost hover:bg-ghost-hover">
          <Icon name="arrow-left" size={16} />
        </a>
        <h1 className="text-base font-semibold">{name}</h1>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-warning-tint px-2 text-[11.5px] font-bold whitespace-nowrap text-warning-fg">
          <Icon name="edit" size={12} />
          {labels.draft(v(versionNo))}
          <span aria-live="polite" className={cn("font-medium", saveState.kind === "failed" && "text-danger-fg")}>
            · {status}
          </span>
        </span>
        <span className="flex-1" />
        <IconButton label={labels.undo} variant="secondary" onClick={undo} disabled={history.past.length === 0}>
          <Icon name="arrow-back-up" />
        </IconButton>
        <IconButton label={labels.redo} variant="secondary" onClick={redo} disabled={history.future.length === 0}>
          <Icon name="arrow-forward-up" />
        </IconButton>
        <Button variant="secondary" onClick={autoLayout}>
          <Icon name="layout-grid" />
          {labels.autoLayout}
        </Button>
        <Button variant="secondary" aria-pressed={!!testRun} onClick={toggleTestRun} className={cn(testRun && "ring-2 ring-primary")}>
          <Icon name="player-play" />
          {labels.testRun}
        </Button>
        <Button variant="secondary" onClick={() => void validate()}>
          <Icon name={errors.length ? "alert-triangle" : "circle-check"} />
          {labels.validate}
        </Button>
        <Button onClick={() => void openPublish()}>
          <Icon name="upload" />
          {labels.publish}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[200px_minmax(0,1fr)_330px] lg:grid-rows-[minmax(0,1fr)_auto]">
        <aside aria-label={labels.palette} className="flex flex-col gap-1.5 overflow-auto rounded-xl border border-border bg-surface p-3 lg:row-span-2">
          <Heading>{labels.add}</Heading>
          <PaletteItem item="step" icon="square-plus" onAdd={() => addItem("step", selectedStage())}>
            {labels.step}
          </PaletteItem>
          {endStages.map((s) => {
            const colour = stageVars(stageColour(s));
            return (
              <PaletteItem
                key={s.key}
                item={`end:${s.key}`}
                onAdd={() => addItem(`end:${s.key}`, null)}
                swatch={<i aria-hidden="true" className="size-[14px] shrink-0 rounded-full" style={{ background: colour.bg, boxShadow: `inset 0 0 0 2px ${colour.dot}` }} />}
              >
                {labels.end(s.name[locale])}
              </PaletteItem>
            );
          })}
          <Heading>{labels.templates}</Heading>
          <PaletteItem item="template:internal" icon="template" onAdd={() => addItem("template:internal", null)}>
            {labels.templateInternal}
          </PaletteItem>
          <PaletteItem item="template:consultant" icon="template" onAdd={() => addItem("template:consultant", null)}>
            {labels.templateConsultant}
          </PaletteItem>
        </aside>

        <section className="relative min-h-[420px] lg:col-start-2 lg:row-start-1">
          <WorkflowCanvas
            definition={definition}
            stages={stages}
            locale={locale}
            labels={labels.map}
            mode="edit"
            selection={testRun ? null : selection}
            onSelect={testRun ? undefined : select}
            onConnect={testRun ? undefined : connect}
            onMoveStep={(key, at, stage) => commit(moveStep(definition, key, at, stage))}
            onDropItem={(item, stage, at) => addItem(item, stage === "outcome" ? null : stage, at)}
            marks={marks}
            focus={focus}
            minimap
            className="h-full rounded-xl"
          >
            {testRun && (
              <TestRunBar
                run={testRun}
                definition={definition}
                locale={locale}
                labels={labels}
                terminal={(key) => {
                  const s = stepOf(key);
                  return !!s && isTerminal(s);
                }}
                onTake={(t) => setTestRun((run) => run && { at: t.to, path: [...run.path, t.to], edges: [...run.edges, t.key] })}
                onRestart={() => startStep && setTestRun({ at: startStep.key, path: [startStep.key], edges: [] })}
                onClose={() => setTestRun(null)}
              />
            )}
          </WorkflowCanvas>
        </section>

        <aside aria-label={labels.editor} className="flex flex-col gap-2.5 overflow-auto rounded-xl border border-border bg-surface px-4 py-3 lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <SideEditor
            definition={definition}
            selection={selection}
            stages={stages}
            openStages={openStages}
            outcomes={outcomes}
            positions={positions}
            fields={fields}
            problems={problems}
            locale={locale}
            labels={labels}
            isTerminal={isTerminal}
            onCommit={commit}
            onConnect={connect}
            onDelete={remove}
          />
        </aside>

        <section aria-label={labels.problemsName} className="max-h-[150px] overflow-auto rounded-xl border border-border bg-surface px-3 py-2 lg:col-start-2 lg:row-start-2">
          <div className="mb-1 flex items-center gap-2 text-[12.5px] font-bold">
            <Icon name={errors.length ? "alert-triangle" : "circle-check"} size={16} style={{ color: errors.length ? "var(--danger)" : "var(--success)" }} />
            {errors.length ? labels.errors(v(errors.length)) : labels.noErrors}
            {warnings > 0 && <span>· {labels.warnings(v(warnings))}</span>}
          </div>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.code}:${p.step ?? ""}:${p.transition ?? ""}:${p.detail ?? ""}:${i}`}>
                <button
                  type="button"
                  onClick={() => showProblem(p)}
                  aria-label={labels.showProblem(p.message[locale])}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] text-text hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <Icon
                    name={p.severity === "error" ? "circle-x" : "alert-triangle"}
                    size={15}
                    className="shrink-0"
                    style={{ color: p.severity === "error" ? "var(--danger)" : "var(--warning-fg)" }}
                  />
                  <span className="flex-1">{p.message[locale]}</span>
                  <Icon name="focus-2" size={15} className="shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {publish && (
        <PublishDialog
          state={publish}
          versionNo={versionNo}
          published={published}
          definition={definition}
          locale={locale}
          labels={labels}
          onClose={() => setPublish(null)}
          onPublish={() => void doPublish()}
          onShowProblems={() => setPublish(null)}
        />
      )}

      {toast && (
        <div role="status" className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-lg bg-inverse px-4 py-2.5 text-sm font-medium text-on-inverse shadow-lg">
          <Icon name="circle-check" size={16} />
          {toast}
        </div>
      )}
    </div>
  );

  function selectedStage(): string | null {
    if (selection?.kind !== "step") return null;
    return stepOf(selection.key)?.stage ?? null;
  }
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mt-1.5 mb-1 text-[10.5px] font-bold tracking-wider text-muted uppercase">{children}</h2>;
}

/** A palette item: click to add it, or drag it into a Stage's band. */
function PaletteItem({ item, icon, swatch, onAdd, children }: { item: string; icon?: "square-plus" | "template"; swatch?: ReactNode; onAdd: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e: DragEvent<HTMLButtonElement>) => {
        e.dataTransfer.setData(canvasDragType, item);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      className="flex items-center gap-2 rounded-lg bg-surface-subtle px-2.5 py-2 text-start text-[12.5px] font-semibold text-text shadow-[inset_0_0_0_1px_var(--border-subtle)] hover:shadow-[inset_0_0_0_1px_var(--primary)] focus-visible:outline-2 focus-visible:outline-focus"
    >
      {swatch ?? (icon && <Icon name={icon} size={16} className="shrink-0" />)}
      {children}
    </button>
  );
}

type SideEditorProps = {
  definition: WorkflowDefinition;
  selection: CanvasSelection | null;
  stages: readonly MapStage[];
  openStages: readonly MapStage[];
  outcomes: readonly WorkflowBuilderOutcome[];
  positions: readonly WorkflowBuilderPosition[];
  fields: readonly RuleField[];
  problems: readonly WorkflowProblem[];
  locale: Locale;
  labels: WorkflowBuilderLabels;
  isTerminal: (s: WorkflowStep) => boolean;
  onCommit: (definition: WorkflowDefinition, coalesce?: string | null) => void;
  onConnect: (from: string, to: string) => void;
  onDelete: () => void;
};

/** The side editor: the selected Step or Transition, or what the draft holds. */
function SideEditor(props: SideEditorProps) {
  const { definition, selection, locale, labels } = props;
  const step = selection?.kind === "step" ? definition.steps.find((s) => s.key === selection.key) : undefined;
  const transition = selection?.kind === "transition" ? definition.transitions.find((t) => t.key === selection.key) : undefined;
  if (step) return <StepEditor {...props} step={step} />;
  if (transition) return <TransitionEditor {...props} transition={transition} />;
  const steps = definition.steps.filter((s) => !props.isTerminal(s)).length;
  return (
    <>
      <Heading>{labels.nothingSelected}</Heading>
      <p className="m-0 text-[13px] leading-normal text-muted">{labels.nothingSelectedHint}</p>
      <Heading>{labels.thisDraft}</Heading>
      <p className="m-0 text-[13px]">{labels.counts(formatNumber(steps, locale), formatNumber(definition.transitions.length, locale))}</p>
    </>
  );
}

function StepEditor({ definition, step, openStages, stages, positions, locale, labels, isTerminal, onCommit, onConnect, onDelete }: SideEditorProps & { step: WorkflowStep }) {
  const set = (patch: Partial<Omit<WorkflowStep, "key">>, coalesce: string | null = null) => onCommit(updateStep(definition, step.key, patch), coalesce);
  const nameFields = (
    <>
      <Field label={labels.nameEn}>
        <Input value={step.name.en} dir="ltr" onChange={(e) => set({ name: { ...step.name, en: e.target.value } }, `${step.key}:en`)} />
      </Field>
      <Field label={labels.nameAr}>
        <Input value={step.name.ar} dir="rtl" onChange={(e) => set({ name: { ...step.name, ar: e.target.value } }, `${step.key}:ar`)} />
      </Field>
    </>
  );
  const remove = (
    <Button variant="ghost" size="sm" className="self-start text-danger-fg" onClick={onDelete}>
      <Icon name="trash" />
      {labels.deleteStep}
    </Button>
  );
  if (isTerminal(step)) {
    return (
      <>
        <Heading>{labels.endHeading}</Heading>
        {nameFields}
        {remove}
      </>
    );
  }
  const actor = step.actor ?? { role: "contractor" as BaseRole, permission: "review" as const };
  const isDraft = stages.find((s) => s.key === step.stage)?.category === "draft";
  const ofRole = positions.filter((p) => p.role === actor.role);
  const targets = definition.steps.filter((s) => s.key !== step.key);
  return (
    <>
      <Heading>{labels.stepHeading}</Heading>
      {nameFields}
      <Field label={labels.stage}>
        <Select value={step.stage} onValueChange={(stage) => set({ stage })} options={openStages.map((s) => ({ value: s.key, label: s.name[locale] }))} />
      </Field>
      <Heading>{labels.whoHolds}</Heading>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label={labels.role}>
          <Select
            value={actor.role}
            onValueChange={(role) => set({ actor: { role: role as BaseRole, permission: actor.permission } })}
            options={baseRoles.map((r) => ({ value: r, label: labels.map.role(r) }))}
          />
        </Field>
        <Field label={labels.permission}>
          <Select
            value={actor.permission}
            onValueChange={(permission) => set({ actor: { ...actor, permission: permission as typeof actor.permission } })}
            options={functionPermissions.map((p) => ({ value: p, label: labels.map.permission(p) }))}
          />
        </Field>
      </div>
      {ofRole.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-body font-medium text-text">{labels.positions}</legend>
          {ofRole.map((p) => {
            const chosen = actor.positions?.includes(p.key) ?? false;
            const id = `position-${step.key}-${p.key}`;
            return (
              <div key={p.key} className="flex items-center gap-2 text-[12.5px]">
                <Checkbox
                  id={id}
                  checked={chosen}
                  onCheckedChange={(on) => {
                    const next = on === true ? [...(actor.positions ?? []), p.key] : (actor.positions ?? []).filter((k) => k !== p.key);
                    const { positions: _old, ...rest } = actor;
                    set({ actor: next.length > 0 ? { ...rest, positions: next } : rest });
                  }}
                />
                <label htmlFor={id}>{p.name[locale]}</label>
              </div>
            );
          })}
          <p className="m-0 text-caption text-muted">{labels.positionsHelp}</p>
        </fieldset>
      )}
      <Heading>{labels.outcomeHeading}</Heading>
      <Field label={labels.outcomeHeading} className="[&>label]:sr-only">
        <Select
          value={step.outcomeMode}
          onValueChange={(mode) => set({ outcomeMode: mode as WorkflowStep["outcomeMode"] })}
          options={outcomeModes.map((m) => ({ value: m, label: m === "none" ? labels.outcomeNone : labels.map.outcomeMode(m) }))}
        />
      </Field>
      {isDraft && (
        <>
          <Heading>{labels.draftsVisibleTo}</Heading>
          {/* Read-only until the Draft Step's setting is stored (RP-514): today a Draft is read by the author's whole Company. */}
          <Field label={labels.draftsVisibleTo} help={labels.draftsVisibleHelp} readOnly className="[&>label]:sr-only">
            <Select
              value="company"
              options={[
                { value: "company", label: labels.draftsWholeCompany },
                { value: "author", label: labels.draftsAuthorOnly },
              ]}
            />
          </Field>
        </>
      )}
      <Field label={labels.addTransitionTo} help={labels.addTransitionHelp}>
        <Select
          value=""
          placeholder="—"
          onValueChange={(to) => to && onConnect(step.key, to)}
          options={targets.map((s) => ({ value: s.key, label: s.name[locale] }))}
        />
      </Field>
      {remove}
    </>
  );
}

function TransitionEditor({ definition, transition, outcomes, positions, fields: formPickerFields, problems, locale, labels, onCommit, onDelete }: SideEditorProps & { transition: WorkflowTransition }) {
  const set = (patch: Partial<Omit<WorkflowTransition, "key" | "from" | "to">>, coalesce: string | null = null) =>
    onCommit(updateTransition(definition, transition.key, patch), coalesce);
  const nameOf = (key: string) => definition.steps.find((s) => s.key === key)?.name[locale] ?? key;
  const form = actionFormOf(transition.actionForm);
  // The fields it asks: display items (headings, instructions, dividers) ask nothing.
  const fields = (form ? formFields(form) : []).flatMap((f) => ("label" in f ? [f] : []));
  // The Form's fields, then this Transition's own Action Form's: what a rule may name (publish check 6).
  const ruleFields = [...formPickerFields, ...ruleFieldsOf(null, transition.actionForm)];
  const actingRole = definition.steps.find((s) => s.key === transition.from)?.actor?.role;
  const actingPositions = positions.filter((p) => p.role === actingRole);
  return (
    <Tabs key={transition.key} defaultValue="settings" className="flex flex-col gap-2.5">
      <TabsList aria-label={labels.rules.tabsName} className="gap-4">
        <TabsTrigger value="settings" className="h-9 text-[13px]">
          {labels.rules.tabSettings}
        </TabsTrigger>
        <TabsTrigger value="notifications" className="h-9 text-[13px]">
          {labels.rules.tabNotifications}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="notifications" className="flex flex-col gap-2.5">
        <TransitionNotifications
          definition={definition}
          transition={transition}
          steps={definition.steps}
          positionOptions={positions}
          locale={locale}
          labels={labels.rules}
          onCommit={onCommit}
        />
      </TabsContent>
      <TabsContent value="settings" className="flex flex-col gap-2.5">
      <Heading>{labels.transitionHeading(nameOf(transition.from), nameOf(transition.to))}</Heading>
      <Field label={labels.labelEn}>
        <Input value={transition.label.en} dir="ltr" onChange={(e) => set({ label: { ...transition.label, en: e.target.value } }, `${transition.key}:en`)} />
      </Field>
      <Field label={labels.labelAr}>
        <Input value={transition.label.ar} dir="rtl" onChange={(e) => set({ label: { ...transition.label, ar: e.target.value } }, `${transition.key}:ar`)} />
      </Field>
      <Field label={labels.kind} group>
        <SegmentedControl
          value={transition.kind}
          onValueChange={(kind) => set({ kind: kind as WorkflowTransition["kind"], ...(kind === "close" ? {} : { outcome: null }) })}
          options={transitionKinds.map((k) => ({ value: k, label: labels.map.kind(k) }))}
          className="flex-wrap [&>button]:h-7 [&>button]:px-2 [&>button]:text-xs"
        />
      </Field>
      <Field label={labels.outcomeCode}>
        <Select
          value={transition.outcome ?? "none"}
          onValueChange={(code) => set({ outcome: code === "none" ? null : code })}
          options={[
            { value: "none", label: labels.noOutcome },
            ...outcomes.filter((o) => o.closing).map((o) => ({ value: o.code, label: `${o.code} · ${o.name[locale]}` })),
          ]}
        />
      </Field>
      <TransitionRules
        definition={definition}
        transition={transition}
        fields={ruleFields}
        positions={actingPositions.map((p) => ({ key: p.key, name: p.name }))}
        problems={problems}
        locale={locale}
        labels={labels.rules}
        onCommit={onCommit}
      />
      <Heading>{labels.screen}</Heading>
      {/* The Screen picker, read-only until Screens are on main (RP-516): the Transition's current Action Form. */}
      <div className="flex flex-col gap-2 rounded-[10px] bg-surface p-3 shadow-[0_0_0_1px_var(--border),var(--shadow-lg)]" aria-describedby={`screen-help-${transition.key}`}>
        <b className="text-[13.5px]">{transition.label[locale]}</b>
        {fields.length === 0 ? (
          <span className="flex h-[26px] items-center rounded-[5px] px-2 text-[11.5px] text-muted shadow-[inset_0_0_0_1px_var(--control-border)]">{labels.internalNoteOnly}</span>
        ) : (
          fields.map((f) => (
            <span key={f.key} className="flex h-[26px] items-center rounded-[5px] px-2 text-[11.5px] text-muted shadow-[inset_0_0_0_1px_var(--control-border)]">
              {f.label[locale]}
              {"required" in f && f.required === true && (
                <span aria-hidden="true" className="ms-0.5 text-danger">
                  *
                </span>
              )}
            </span>
          ))
        )}
        <span className="inline-flex h-8 items-center self-end rounded-sm bg-primary px-3 text-sm font-medium text-on-primary">{labels.confirm}</span>
      </div>
      <p id={`screen-help-${transition.key}`} className="m-0 text-caption text-muted">
        {labels.screenHelp}
      </p>
      <Button variant="ghost" size="sm" className="self-start text-danger-fg" onClick={onDelete}>
        <Icon name="trash" />
        {labels.deleteTransition}
      </Button>
      </TabsContent>
    </Tabs>
  );
}

/** A Transition's Action Form, or null when it has none, or one the format no longer reads (publish check 7 names it). */
function actionFormOf(stored: unknown) {
  try {
    return parseActionForm(stored);
  } catch {
    return null;
  }
}

type TestRunBarProps = {
  run: TestRun;
  definition: WorkflowDefinition;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  terminal: (key: string) => boolean;
  onTake: (t: WorkflowTransition) => void;
  onRestart: () => void;
  onClose: () => void;
};

/** The test run's bar over the canvas: where the run is and the Transitions it may take there. */
function TestRunBar({ run, definition, locale, labels, terminal, onTake, onRestart, onClose }: TestRunBarProps) {
  const at = definition.steps.find((s) => s.key === run.at);
  const next = definition.transitions.filter((t) => t.from === run.at);
  return (
    <div role="region" aria-label={labels.testRun} className="absolute inset-x-3 bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-inverse px-3 py-2.5 text-[12.5px] text-on-inverse" dir={locale === "ar" ? "rtl" : "ltr"}>
      <Icon name="player-play" size={16} />
      <b>{labels.testRun}</b>
      <span className="opacity-70">·</span>
      {at && terminal(at.key) ? (
        <b>{labels.finished(at.name[locale])}</b>
      ) : (
        <>
          <span>
            {labels.testRunAt} <b>{at?.name[locale]}</b> —
          </span>
          {next.map((t) => (
            <Button key={t.key} size="sm" onClick={() => onTake(t)}>
              {t.label[locale]}
            </Button>
          ))}
        </>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" className="text-on-inverse hover:bg-transparent hover:opacity-80" onClick={onRestart}>
        <Icon name="refresh" />
        {labels.restart}
      </Button>
      <IconButton label={labels.closeTestRun} size="sm" className="text-on-inverse hover:bg-transparent hover:opacity-80" onClick={onClose}>
        <Icon name="x" />
      </IconButton>
    </div>
  );
}

type PublishDialogProps = {
  state: PublishState;
  versionNo: number;
  published: WorkflowBuilderProps["published"];
  definition: WorkflowDefinition;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  onClose: () => void;
  onPublish: () => void;
  onShowProblems: () => void;
};

/**
 * Publish (design: the publish modal): what changed since the published Version,
 * the server's check of the saved draft, and that running items keep their Version.
 */
function PublishDialog({ state, versionNo, published, definition, locale, labels, onClose, onPublish, onShowProblems }: PublishDialogProps) {
  const v = (n: number) => formatNumber(n, locale);
  const errors = state.phase === "ready" ? state.problems.filter((p) => p.severity === "error").length : 0;
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent title={labels.publishTitle(v(versionNo))} closeLabel={labels.close} className="w-[min(620px,calc(100%-2rem))]">
        <h3 className="m-0 text-[11px] font-bold tracking-wider text-muted uppercase">
          {published ? labels.changesSince(v(published.versionNo)) : labels.firstVersion}
        </h3>
        {published && <WorkflowChangeList before={published.definition} after={definition} locale={locale} labels={labels} />}
        <div role="status" aria-live="polite">
          {state.phase === "ready" && errors > 0 ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-danger-tint px-3 py-2.5 text-[13px] font-semibold text-danger-fg">
              <Icon name="circle-x" size={16} />
              {labels.errorsBlock(v(errors))}
              <Button size="sm" variant="secondary" className="ms-auto" onClick={onShowProblems}>
                {labels.showProblems}
              </Button>
            </div>
          ) : state.phase === "ready" ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-success-tint px-3 py-2.5 text-[13px] font-semibold text-success-fg">
              <Icon name="circle-check" size={16} />
              {labels.passed}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[10px] bg-surface-subtle px-3 py-2.5 text-[13px] font-semibold text-muted">
              <Icon name="clock" size={16} />
              {labels.checking}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-[10px] bg-info-tint px-3 py-2.5 text-[13px] font-medium text-info-fg">
          <Icon name="info-circle" size={16} className="shrink-0" />
          {labels.appliesToNew(v(versionNo))}
        </div>
        <DialogFooter className="-mx-6 -mb-6 border-t border-border-subtle bg-surface-subtle px-6 py-3">
          <Button variant="secondary" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button onClick={onPublish} disabled={state.phase !== "ready" || errors > 0}>
            <Icon name="upload" />
            {labels.publishVersion(v(versionNo))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
