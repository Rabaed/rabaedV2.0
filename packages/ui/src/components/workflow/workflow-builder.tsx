"use client";

import {
  addStep,
  baseRoles,
  conditionFields,
  connectSteps,
  evaluateCondition,
  formatDate,
  formatNumber,
  formFields,
  functionPermissions,
  moveStep,
  outcomeModes,
  parseActionForm,
  readsAttrs,
  removeStep,
  removeTransition,
  ruleFieldsOf,
  stepEditsForm,
  transitionKinds,
  transitionRuleFields,
  updateStep,
  updateTransition,
  type BaseRole,
  type Condition,
  type FormSchema,
  type Locale,
  type PositionOption,
  type RuleField,
  type WorkflowDefinition,
  type WorkflowOutcomeOption,
  type WorkflowProblem,
  type WorkflowScreenOption,
  type WorkflowStep,
  type WorkflowTransition,
} from "@rabaed/domain";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { ToastProvider, useToast } from "../overlay/toast.tsx";
import { TransitionNotifications, TransitionRules } from "./workflow-transition-rules.tsx";
import type { WorkflowBuilderLabels } from "./workflow-builder-labels.ts";
import { canvasDragType, WorkflowCanvas, type CanvasMark, type CanvasSelection } from "./workflow-canvas.tsx";
import { WorkflowChangeList } from "./workflow-changes.tsx";
import { placedLayout, workflowMap, type MapStage } from "./workflow-map.ts";
import { referenceModal, referenceModalBody, referenceModalFooter, stageVars } from "./workflow-parts.tsx";
import { stageColour } from "../status/stage-colour.ts";

/** Where the draft's saving stands, as the page saving it through WF-4's API knows it; `opened` until the first save. */
export type WorkflowSaveState = { kind: "opened" } | { kind: "saved"; at: Date } | { kind: "saving" } | { kind: "unsaved" } | { kind: "failed" };

/** An outcome of the Work Item Type's set, for a closing Transition: the builder read's, without its polarity. */
export type WorkflowBuilderOutcome = Pick<WorkflowOutcomeOption, "code" | "name" | "closing">;

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
  /** The Positions a Step may name. */
  positions: readonly PositionOption[];
  /** The Type's published Form: a rule's pickers list only its fields, as publish check 6 accepts them (RP-440). */
  form: FormSchema | null;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  /** Every publish problem of the draft as last checked (WF-4's validate). */
  problems: readonly WorkflowProblem[];
  saveState: WorkflowSaveState;
  /** The back link to the Workflows. */
  backHref: string;
  /** Every edit, for the page to save the draft and check it again. */
  onChange: (definition: WorkflowDefinition) => void;
  /**
   * The Screens a Transition may show (ADR 0019; RP-555's Screen picker), as the builder
   * read gives them; none: the picker offers only the Internal Note.
   */
  screens?: readonly WorkflowScreenOption[];
  /** How many items the author sees run on each published Version: the publish dialog says they keep it. */
  running?: readonly { versionNo: number; count: number }[];
  /** Checks the draft on the server now (saving anything pending first): its problems. */
  onValidate: () => Promise<readonly WorkflowProblem[]>;
  /** Publishes the draft with its change note (the server checks it again). */
  onPublish: (changeNote: string) => Promise<WorkflowPublishResult>;
};

type History = { past: WorkflowDefinition[]; present: WorkflowDefinition; future: WorkflowDefinition[] };
type TestRun = { at: string; path: string[]; edges: string[] };
/** A test run's sample answers, by field key, for the fields the draft's Restrict conditions read. */
type Sample = Record<string, unknown>;
type PublishState = { phase: "checking" } | { phase: "ready"; problems: readonly WorkflowProblem[] } | { phase: "publishing" };

const open = new Set(["draft", "in_progress"]);
const noScreens: readonly WorkflowScreenOption[] = [];
const noRunning: readonly { versionNo: number; count: number }[] = [];

/** A blank draft (no Step at all) with the one Draft Step it starts with, selected; any other draft as it is. */
function seedBlank(definition: WorkflowDefinition, stages: readonly MapStage[], labels: WorkflowBuilderLabels): { definition: WorkflowDefinition; key: string | null } {
  const draftStage = stages.find((s) => s.category === "draft");
  if (definition.steps.length > 0 || !draftStage) return { definition, key: null };
  const added = addStep(definition, { name: labels.names.firstStep ?? labels.names.newStep, stage: draftStage.key, actor: { role: "contractor", permission: "create" }, at: { x: 55, y: 80 } });
  return added;
}

/** The plain Restrict conditions of a Transition: those a test run can check with sample answers (none reading an item attribute). */
function sampledConditions(t: WorkflowTransition): Condition[] {
  return (t.rules?.restrict ?? []).flatMap((r) => (r.type === "condition" && !readsAttrs(r.condition) ? [r.condition] : []));
}

/** The Form fields the draft's Restrict conditions read, in the order first read (a field the Form lacks is a publish problem, not sampled). */
function sampledFields(definition: WorkflowDefinition, form: FormSchema | null): RuleField[] {
  const known = ruleFieldsOf(form, null);
  const keys = [...new Set(definition.transitions.flatMap((t) => sampledConditions(t).flatMap(conditionFields)))];
  return keys.flatMap((key) => known.filter((f) => f.key === key));
}

/** Sample answers that make the first condition on each field hold, so a test run starts on its conditional route. */
function defaultSample(definition: WorkflowDefinition, fields: readonly RuleField[]): Sample {
  const out: Sample = {};
  const visit = (c: Condition) => {
    if ("all" in c) return c.all.forEach(visit);
    if ("any" in c) return c.any.forEach(visit);
    if ("not" in c) return visit(c.not);
    if (c.field === undefined || c.field in out || !("value" in c)) return;
    const value = Array.isArray(c.value) ? c.value[0] : c.value;
    out[c.field] = typeof value === "number" ? (c.op === ">" ? value + 1 : c.op === "<" ? value - 1 : value) : value;
  };
  for (const t of definition.transitions) sampledConditions(t).forEach(visit);
  for (const f of fields) if (!(f.key in out)) out[f.key] = f.type === "yes_no" ? true : "";
  return out;
}

/** Whether a test run offers `t` with `sample`: every plain Restrict condition holds; other rules aren't sampled. */
function offeredWith(t: WorkflowTransition, sample: Sample): boolean {
  return sampledConditions(t).every((c) => evaluateCondition(c, { fields: sample }));
}

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
  return (
    <ToastProvider label={props.labels.alertsRegion} closeLabel={props.labels.dismiss}>
      <Builder {...props} />
    </ToastProvider>
  );
}

function Builder(props: WorkflowBuilderProps) {
  const { name, versionNo, published, stages, outcomes, positions, form, locale, labels, problems, saveState, backHref, onChange, onValidate, onPublish } = props;
  const screens = props.screens ?? noScreens;
  const running = props.running ?? noRunning;
  const toast = useToast();
  // A blank Workflow starts with one Draft Step, as the reference's "Start blank" does (RP-555).
  const [seeded] = useState(() => seedBlank(props.definition, stages, labels));
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    // Pinned where the canvas draws it, so the first Step moved keeps every other one in place.
    present: { ...seeded.definition, layout: placedLayout(seeded.definition, stages, true) },
    future: [],
  }));
  const definition = history.present;
  const coalescing = useRef<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(seeded.key === null ? null : { kind: "step", key: seeded.key });
  const [focus, setFocus] = useState<{ key: string; nonce: number } | null>(null);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [publish, setPublish] = useState<PublishState | null>(null);
  const v = (n: number) => formatNumber(n, locale);

  // The seeded Step is an edit like any other: the page saves it and checks the draft.
  const seededSaved = useRef(false);
  useEffect(() => {
    if (seeded.key === null || seededSaved.current) return;
    seededSaved.current = true;
    onChange(history.present);
  }, [seeded.key, onChange, history.present]);

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
  // The fields the draft's Restrict conditions read: the test run asks a sample value of each (RP-555).
  const sampleFields = useMemo(() => sampledFields(definition, form), [definition, form]);
  const toggleTestRun = () => {
    select(null);
    setSample((s) => s ?? defaultSample(definition, sampleFields));
    setTestRun((run) => (run || !startStep ? null : { at: startStep.key, path: [startStep.key], edges: [] }));
  };
  /** Whether the test run offers `t` with the sample: its Restrict conditions on the Form hold (others aren't sampled). */
  const offered = useCallback((t: WorkflowTransition) => offeredWith(t, sample ?? {}), [sample]);
  const marks = useMemo(() => {
    if (!testRun) return undefined;
    const out: Record<string, CanvasMark> = {};
    for (const s of definition.steps) out[s.key] = testRun.path.includes(s.key) ? "done" : "faded";
    out[testRun.at] = "current";
    for (const t of definition.transitions) out[t.key] = testRun.edges.includes(t.key) ? "done" : t.from === testRun.at && offered(t) ? "next" : "faded";
    return out;
  }, [testRun, definition, offered]);

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
    toast(errors ? { title: labels.errorsToFix(errors, v(errors)), tone: "danger" } : { title: labels.validationPassed, tone: "success" });
  };

  const openPublish = async () => {
    setPublish({ phase: "checking" });
    setPublish({ phase: "ready", problems: await onValidate() });
  };
  const doPublish = async (changeNote: string) => {
    setPublish({ phase: "publishing" });
    const result = await onPublish(changeNote);
    if (result.ok) {
      setPublish(null);
      toast({ title: labels.published(v(result.versionNo)), tone: "success" });
    } else {
      setPublish({ phase: "ready", problems: result.problems });
    }
  };

  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.length - errors.length;
  const status =
    saveState.kind === "opened"
      ? null
      : saveState.kind === "saved"
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
            {status !== null && `· ${status}`}
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
                fields={sampleFields}
                sample={sample ?? {}}
                onSample={(key, value) => setSample((s) => ({ ...s, [key]: value }))}
                offered={offered}
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
            form={form}
            screens={screens}
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
            {errors.length ? labels.errors(errors.length, v(errors.length)) : labels.noErrors}
            {warnings > 0 && <span className="font-semibold text-muted">· {labels.warnings(warnings, v(warnings))}</span>}
          </div>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.code}:${p.step ?? ""}:${p.transition ?? ""}:${p.detail ?? ""}:${i}`}>
                <button
                  type="button"
                  onClick={() => showProblem(p)}
                  aria-label={labels.showProblem(p.message[locale])}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] text-text hover:bg-hover", focusRing)}
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
          running={running}
          definition={definition}
          locale={locale}
          labels={labels}
          onClose={() => setPublish(null)}
          onPublish={(changeNote) => void doPublish(changeNote)}
          onShowProblems={() => setPublish(null)}
        />
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
      className={cn(
        "flex items-center gap-2 rounded-lg bg-surface-subtle px-2.5 py-2 text-start text-[12.5px] font-semibold text-text shadow-[inset_0_0_0_1px_var(--border-subtle)] hover:shadow-[inset_0_0_0_1px_var(--primary)]",
        focusRing,
      )}
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
  positions: readonly PositionOption[];
  form: FormSchema | null;
  screens: readonly WorkflowScreenOption[];
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
  // The raiser's Steps: those of the Draft Step's Participant role (ADR 0019).
  const raiserRole = definition.steps.find((s) => stages.find((st) => st.key === s.stage)?.category === "draft")?.actor?.role;
  const raiser = raiserRole !== undefined && actor.role === raiserRole;
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
      {/* The reference's compact pair: the heading names them, the labels stay for screen readers. */}
      <div className="grid grid-cols-2 gap-1.5">
        <Field label={labels.role} className="[&>label]:sr-only">
          <Select
            value={actor.role}
            onValueChange={(role) => set({ actor: { role: role as BaseRole, permission: actor.permission } })}
            options={baseRoles.map((r) => ({ value: r, label: labels.map.role(r) }))}
          />
        </Field>
        <Field label={labels.permission} className="[&>label]:sr-only">
          <Select
            value={actor.permission}
            onValueChange={(permission) => set({ actor: { ...actor, permission: permission as typeof actor.permission } })}
            options={functionPermissions.map((p) => ({ value: p, label: labels.map.permission(p) }))}
          />
        </Field>
      </div>
      {/* Who may hold it, naming no one: the builder names no Member (visibility.md, RP-439; owner's decision 2). */}
      <p className="m-0 flex items-start gap-1.5 rounded-lg bg-info-tint px-2.5 py-2 text-[12px] leading-snug font-medium text-info-fg">
        {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name: the people who may hold it. */}
        <Icon name="users" size={14} className="mt-px" />
        {labels.poolHint(
          [labels.map.role(actor.role), labels.map.permission(actor.permission), ...(actor.positions ?? []).map((k) => labels.map.position(k, actor.role))].join(" · "),
        )}
      </p>
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
      {raiser && (
        // The reference's "Editable form sections", as ADR 0019 allows it: one setting, on the raiser's Steps only (owner's decision 3).
        <Field label={labels.editsForm} help={labels.editsFormHelp} layout="inline">
          <Switch checked={stepEditsForm(definition, step, stages)} onCheckedChange={(on) => set({ editsForm: on })} />
        </Field>
      )}
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

function TransitionEditor({ definition, transition, stages, outcomes, positions, form, screens, problems, locale, labels, onCommit, onDelete }: SideEditorProps & { transition: WorkflowTransition }) {
  const set = (patch: Partial<Omit<WorkflowTransition, "key" | "from" | "to">>, coalesce: string | null = null) =>
    onCommit(updateTransition(definition, transition.key, patch), coalesce);
  const nameOf = (key: string) => definition.steps.find((s) => s.key === key)?.name[locale] ?? key;
  // What it asks: the chosen Screen's Form (ADR 0019), else its own Action Form, else the Internal Note only.
  const screen = transition.screen === undefined ? undefined : screens.find((s) => s.key === transition.screen);
  const actionForm = screen ? screen.schema : transition.screen === undefined ? actionFormOf(transition.actionForm) : null;
  // The fields it asks: display items (headings, instructions, dividers) ask nothing.
  const fields = (actionForm ? formFields(actionForm) : []).flatMap((f) => ("label" in f ? [f] : []));
  // What each group of rules may name, as publish check 6 accepts it.
  const ruleFields = transitionRuleFields(form, transition, definition, stages);
  const closes = transition.kind === "close";
  const actingRole = definition.steps.find((s) => s.key === transition.from)?.actor?.role;
  const actingPositions = positions.filter((p) => p.role === actingRole);
  const closing = outcomes.filter((o) => o.closing);
  const ownForm = transition.screen === undefined && transition.actionForm !== null;
  const picked = transition.screen ?? (ownForm ? "__own" : "__none");
  const pick = (value: string) => {
    const { screen: _old, ...rest } = transition;
    const next = value === "__none" ? { ...rest, actionForm: null } : { ...rest, actionForm: null, screen: value };
    onCommit({ ...definition, transitions: definition.transitions.map((t) => (t.key === transition.key ? next : t)) });
  };
  return (
    <div key={transition.key} className="flex flex-col gap-2.5">
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
          // Six kinds, Send Back included: a 3 by 2 grid in the 330px panel.
          className="grid w-full grid-cols-3 [&>button]:h-7 [&>button]:px-1.5 [&>button]:text-xs"
        />
      </Field>
      <Field label={labels.outcomeCode} help={closes ? undefined : labels.outcomeOnlyOnClose} disabled={!closes}>
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
        positions={actingPositions}
        problems={problems}
        locale={locale}
        labels={labels.rules}
        onCommit={onCommit}
      />
      <Heading>{labels.screen}</Heading>
      {/* The Screen picker (owner's decision 6, ADR 0019): it replaces the reference's Comments / Attach / Pick code ticks. */}
      <Field label={labels.screen} help={labels.screenHelp} className="[&>label]:sr-only">
        <Select
          value={picked}
          onValueChange={pick}
          options={[
            { value: "__none", label: labels.screenNone },
            ...(ownForm ? [{ value: "__own", label: labels.screenOwn }] : []),
            ...(transition.screen !== undefined && !screen ? [{ value: transition.screen, label: labels.screenMissing(transition.screen) }] : []),
            ...screens.map((s) => ({ value: s.key, label: s.name[locale] })),
          ]}
        />
      </Field>
      {/* The reference's preview card, of the chosen Screen; no signature line (ADR 0017: every Transition is confirmed and recorded). */}
      <div className="flex flex-col gap-2 rounded-[10px] bg-surface p-3 shadow-[0_0_0_1px_var(--border),var(--shadow-lg)]">
        <b className="text-[13.5px]">{transition.label[locale]}</b>
        {closes && closing.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {closing.map((o) => {
              const colour = stageVars(o.code === "C" ? "resubmitted" : o.code === "D" ? "rejected" : "approved");
              const on = o.code === transition.outcome;
              return (
                <span
                  key={o.code}
                  className="inline-flex h-[22px] items-center rounded-[5px] px-1.5 text-[11px] font-bold"
                  style={on ? { background: colour.dot, color: "var(--on-primary)" } : { background: colour.bg, color: colour.fg }}
                >
                  {o.code}
                </span>
              );
            })}
          </div>
        )}
        {fields.length === 0 ? (
          <span className="flex h-[26px] items-center rounded-[5px] px-2 text-[11.5px] text-muted shadow-[inset_0_0_0_1px_var(--control-border)]">{labels.internalNoteOnly}</span>
        ) : (
          fields.map((f) => (
            <span key={f.key} className="flex h-[26px] items-center rounded-[5px] px-2 text-[11.5px] text-muted shadow-[inset_0_0_0_1px_var(--control-border)]">
              {f.label[locale]}
              {"required" in f && f.required === true && (
                <span aria-hidden="true" className="ms-0.5 text-danger-fg">
                  *
                </span>
              )}
            </span>
          ))
        )}
        <span className="inline-flex h-8 items-center self-end rounded-sm bg-primary px-3 text-sm font-medium text-on-primary">{labels.confirm}</span>
      </div>
      {/* Inline, as the reference's (owner's decision 7); no "Company admins" or "Distribution list" (visibility.md). */}
      <TransitionNotifications
        definition={definition}
        transition={transition}
        steps={definition.steps}
        positionOptions={positions}
        locale={locale}
        labels={labels.rules}
        onCommit={onCommit}
      />
      <Button variant="ghost" size="sm" className="self-start text-danger-fg" onClick={onDelete}>
        <Icon name="trash" />
        {labels.deleteTransition}
      </Button>
    </div>
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
  /** The fields the conditions read, and their sample answers. */
  fields: readonly RuleField[];
  sample: Sample;
  onSample: (key: string, value: unknown) => void;
  /** Whether a Transition is offered with the sample. */
  offered: (t: WorkflowTransition) => boolean;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  terminal: (key: string) => boolean;
  onTake: (t: WorkflowTransition) => void;
  onRestart: () => void;
  onClose: () => void;
};

/**
 * The test run's bar over the canvas (the reference's): the sample answers the conditions read,
 * where the run is, and the Transitions it may take there with them: a conditional one only
 * when the sample meets its condition.
 */
function TestRunBar({ run, definition, fields, sample, onSample, offered, locale, labels, terminal, onTake, onRestart, onClose }: TestRunBarProps) {
  const at = definition.steps.find((s) => s.key === run.at);
  const next = definition.transitions.filter((t) => t.from === run.at && offered(t));
  return (
    <div role="region" aria-label={labels.testRun} className="absolute inset-x-3 bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-inverse px-3 py-2.5 text-[12.5px] text-on-inverse" dir={locale === "ar" ? "rtl" : "ltr"}>
      <Icon name="player-play" size={16} />
      <b>{labels.testRun}</b>
      {fields.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          {labels.sample}
          {fields.map((f) => (
            <SampleInput key={f.key} field={f} value={sample[f.key]} locale={locale} yes={labels.rules.yes} no={labels.rules.no} onChange={(value) => onSample(f.key, value)} />
          ))}
        </span>
      )}
      <span className="opacity-70">·</span>
      {at && terminal(at.key) ? (
        <b>{labels.finished(at.name[locale])}</b>
      ) : (
        <>
          <span>
            {labels.testRunAt} <b>{at?.name[locale]}</b> —
          </span>
          {next.length === 0 && <span className="opacity-80">{labels.noWayOn}</span>}
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

/** One sample answer in the test run bar, by the field's type: a number (Latin digits), a choice, yes or no, or text. */
function SampleInput({ field, value, locale, yes, no, onChange }: { field: RuleField; value: unknown; locale: Locale; yes: string; no: string; onChange: (value: unknown) => void }) {
  const name = field.label[locale];
  const look = "h-[26px] rounded-[5px] border-0 bg-surface px-1.5 text-[12px] text-text";
  if (field.type === "yes_no") {
    return (
      <label className="inline-flex items-center gap-1">
        {name}
        <select aria-label={name} className={look} value={value === false ? "no" : "yes"} onChange={(e) => onChange(e.target.value === "yes")}>
          <option value="yes">{yes}</option>
          <option value="no">{no}</option>
        </select>
      </label>
    );
  }
  if (field.options && field.options.length > 0) {
    return (
      <label className="inline-flex items-center gap-1">
        {name}
        <select aria-label={name} className={look} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label[locale]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const numeric = field.type === "number" || field.type === "currency";
  return (
    <label className="inline-flex items-center gap-1">
      {name}
      <input
        aria-label={name}
        dir="ltr"
        inputMode={numeric ? "decimal" : undefined}
        className={cn(look, "w-28")}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(numeric ? (e.target.value === "" || Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) : e.target.value)}
      />
    </label>
  );
}

type PublishDialogProps = {
  state: PublishState;
  versionNo: number;
  published: WorkflowBuilderProps["published"];
  running: readonly { versionNo: number; count: number }[];
  definition: WorkflowDefinition;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  onClose: () => void;
  onPublish: (changeNote: string) => void;
  onShowProblems: () => void;
};

/**
 * Publish (the reference's publish modal, RP-555): what changed since the published Version,
 * the server's check of the saved draft, the required change note the Version keeps, and how
 * many items (of those the author sees) keep their Version.
 */
function PublishDialog({ state, versionNo, published, running, definition, locale, labels, onClose, onPublish, onShowProblems }: PublishDialogProps) {
  const v = (n: number) => formatNumber(n, locale);
  const errors = state.phase === "ready" ? state.problems.filter((p) => p.severity === "error").length : 0;
  const [changeNote, setChangeNote] = useState("");
  const [changeNoteMissing, setChangeNoteMissing] = useState(false);
  const latest = published ? (running.find((r) => r.versionNo === published.versionNo)?.count ?? 0) : 0;
  const older = running.filter((r) => published && r.versionNo !== published.versionNo).reduce((sum, r) => sum + r.count, 0);
  const submit = () => {
    if (changeNote.trim() === "") {
      setChangeNoteMissing(true);
      return;
    }
    onPublish(changeNote.trim());
  };
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        title={
          <span className="flex items-center gap-2.5">
            <Icon name="upload" size={18} className="text-primary" />
            {labels.publishTitle(v(versionNo))}
          </span>
        }
        closeLabel={labels.close}
        className={cn(referenceModal, "w-[min(620px,calc(100%-2rem))]")}
      >
        <div className={referenceModalBody}>
        <h3 className="m-0 text-[11px] font-bold tracking-wider text-muted uppercase">
          {published ? labels.changesSince(v(published.versionNo)) : labels.firstVersion}
        </h3>
        {published && <WorkflowChangeList before={published.definition} after={definition} locale={locale} labels={labels} />}
        <div role="status" aria-live="polite">
          {state.phase === "ready" && errors > 0 ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-danger-tint px-3 py-2.5 text-[13px] font-semibold text-danger-fg">
              <Icon name="circle-x" size={16} />
              {labels.errorsBlock(errors, v(errors))}
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
        <Field label={labels.changeNote} required error={changeNoteMissing && changeNote.trim() === "" ? labels.changeNoteRequired : undefined}>
          <Textarea
            value={changeNote}
            rows={3}
            maxLength={1000}
            placeholder={labels.changeNotePlaceholder}
            onChange={(e) => setChangeNote(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-2 rounded-[10px] bg-info-tint px-3 py-2.5 text-[13px] font-medium text-info-fg">
          <Icon name="info-circle" size={16} className="shrink-0" />
          {published && latest + older > 0
            ? labels.keepVersions({ latest, latestN: v(latest), older, olderN: v(older), version: v(published.versionNo), next: v(versionNo) })
            : labels.appliesToNew(v(versionNo))}
        </div>
        </div>
        <DialogFooter className={referenceModalFooter}>
          <Button variant="secondary" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button onClick={submit} disabled={state.phase !== "ready" || errors > 0}>
            <Icon name="upload" />
            {labels.publishVersion(v(versionNo))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
