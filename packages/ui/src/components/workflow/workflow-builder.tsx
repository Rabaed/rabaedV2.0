"use client";

import {
  addStep,
  connectSteps,
  formatDate,
  formatNumber,
  moveStep,
  removeStep,
  removeTransition,
  updateStep,
  updateTransition,
  type BaseRole,
  type BilingualText,
  type FormSchema,
  type Locale,
  type PositionOption,
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
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Switch } from "../form/switch.tsx";
import { Textarea } from "../form/textarea.tsx";
import type { ActionFormLabels } from "../form-engine/action-form.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import { Dialog, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { ToastProvider, useToast } from "../overlay/toast.tsx";
import { stageColour } from "../status/stage-colour.ts";
import type { WorkflowBuilderLabels } from "./workflow-builder-labels.ts";
import { ActionPopup } from "./workflow-builder-popup.tsx";
import { askedForm, createsItemsOf, Heading, SideEditor } from "./workflow-builder-side.tsx";
import { defaultSample, offeredWith, sampledFields, TestRunBar, type Sample, type TestRun } from "./workflow-builder-test-run.tsx";
import { canvasDragType, WorkflowCanvas, type ArrowStyle, type CanvasMark, type CanvasMove, type CanvasSelection } from "./workflow-canvas.tsx";
import { WorkflowChangeList } from "./workflow-changes.tsx";
import { arrangedLayout, placedLayout, workflowMap, type MapStage } from "./workflow-map.ts";
import { referenceModal, referenceModalBody, referenceModalFooter, stageVars, typographic } from "./workflow-parts.tsx";

/** Where the draft's saving stands, as the page saving it through WF-4's API knows it; `opened` until the first save. */
export type WorkflowSaveState = { kind: "opened" } | { kind: "saved"; at: Date } | { kind: "saving" } | { kind: "unsaved" } | { kind: "failed" };

/** An outcome of the Work Item Type's set, for a closing Transition: the builder read's, without its polarity. */
export type WorkflowBuilderOutcome = Pick<WorkflowOutcomeOption, "code" | "name" | "closing" | "createsItems">;

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
  /** The Work Item Type's code, before the test run's sample ("MAR · Cost impact"). */
  typeCode?: string;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  /** The Form engine's words, for the pop-up as the holder sees it; without them the pop-up draws plain boxes. */
  actionFormLabels?: ActionFormLabels;
  /** Every publish problem of the draft as last checked (WF-4's validate). */
  problems: readonly WorkflowProblem[];
  saveState: WorkflowSaveState;
  /** The back link to the Workflows. */
  backHref: string;
  /** A published Version's page, for the published toast's "View Versions"; none: no link. */
  versionsHref?: (versionNo: number) => string;
  /** Settings → Screens, where a Transition's Screen is edited; none: no link. */
  screensHref?: string;
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
type PublishState = { phase: "checking" } | { phase: "ready"; problems: readonly WorkflowProblem[] } | { phase: "publishing" };
type Popup = { transition: string; mode: "preview" | "test" };

const open = new Set(["draft", "in_progress"]);
const noScreens: readonly WorkflowScreenOption[] = [];
const noRunning: readonly { versionNo: number; count: number }[] = [];

/** The canvas's view, each viewer's own (owner's decision 9): kept in the browser, never in the Workflow. */
type ViewPrefs = { arrowStyle: ArrowStyle; snap: boolean; minimap: boolean };
const viewDefaults: ViewPrefs = { arrowStyle: "curved", snap: true, minimap: true };
const viewKey = "rabaed.workflowBuilder.view";

function useViewPrefs(): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const [prefs, setPrefs] = useState<ViewPrefs>(viewDefaults);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(viewKey);
      if (saved) setPrefs({ ...viewDefaults, ...(JSON.parse(saved) as Partial<ViewPrefs>) });
    } catch {
      // No storage (a private window, blocked site data): the defaults.
    }
  }, []);
  const update = useCallback((patch: Partial<ViewPrefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch };
      try {
        localStorage.setItem(viewKey, JSON.stringify(next));
      } catch {
        // Kept for this visit only.
      }
      return next;
    });
  }, []);
  return [prefs, update];
}

/** A blank draft (no Step at all) with the one Draft Step it starts with, selected; any other draft as it is. */
function seedBlank(definition: WorkflowDefinition, stages: readonly MapStage[], labels: WorkflowBuilderLabels): { definition: WorkflowDefinition; key: string | null } {
  const draftStage = stages.find((s) => s.category === "draft");
  if (definition.steps.length > 0 || !draftStage) return { definition, key: null };
  return addStep(definition, { name: labels.names.firstStep ?? labels.names.newStep, stage: draftStage.key, actor: { role: "contractor", permission: "create" }, at: { x: 40, y: 240 } });
}

/** A problem's message as the panel lists it: without a closing full stop, as the reference's. */
const listed = (message: string, locale: Locale) => typographic(message, locale).replace(/[.。]\s*$/, "");

/**
 * The Workflow builder (RP-439, WF-16; workflow-engine.md §11), as the owner's V2 reference
 * (RP-555, `Rabaed Workflow Builder V2`): a bar with the arrow style, undo, redo, Auto-layout,
 * test run, validate and publish; the palette (a Step, an End, Ready-made Steps, dragged onto
 * the canvas or clicked; the canvas switches); the editable canvas; the side panel for the
 * selected Step, End or Transition; and the validation problems under the canvas, each
 * selecting what it concerns. A Transition picks a Screen (ADR 0019), shown read-only and
 * previewed as its pop-up. Every edit goes to `onChange`; the page saves the draft through
 * WF-4's API. Used by Project Settings, the Library and Rabaed Admin.
 */
export function WorkflowBuilder(props: WorkflowBuilderProps) {
  return (
    // Toasts at the bottom centre, as the reference's, clear of the side panel in both directions.
    <ToastProvider label={props.labels.alertsRegion} closeLabel={props.labels.dismiss} placement="center" look="dark">
      <Builder {...props} />
    </ToastProvider>
  );
}

function Builder(props: WorkflowBuilderProps) {
  const { name, versionNo, published, stages, outcomes, positions, form, locale, labels, problems, saveState, backHref, onChange, onValidate, onPublish } = props;
  const screens = props.screens ?? noScreens;
  const running = props.running ?? noRunning;
  const toast = useToast();
  const [view, setView] = useViewPrefs();
  // A blank Workflow starts with one Draft Step, as the reference's "Start blank" does (RP-555).
  const [seeded] = useState(() => seedBlank(props.definition, stages, labels));
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    // Pinned where the canvas draws it, so the first Step moved keeps every other one in place.
    present: {
      ...seeded.definition,
      layout: seeded.definition.steps.every((s) => seeded.definition.layout[s.key]) ? placedLayout(seeded.definition, stages, true) : arrangedLayout(seeded.definition, stages),
    },
    future: [],
  }));
  const definition = history.present;
  const coalescing = useRef<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(seeded.key === null ? null : { kind: "step", key: seeded.key });
  const [group, setGroup] = useState<readonly string[]>([]);
  const [focus, setFocus] = useState<{ key: string; nonce: number } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [publish, setPublish] = useState<PublishState | null>(null);
  // Just published: the badge says so and Publish rests until the next edit (owner's decision 4).
  const [publishedNow, setPublishedNow] = useState<number | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [activeProblem, setActiveProblem] = useState<number | null>(null);
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
      setPublishedNow(null);
      onChange(next);
    },
    [onChange],
  );
  const undo = useCallback(() => {
    const previous = history.past.at(-1);
    if (!previous) return;
    coalescing.current = null;
    setHistory((h) => ({ past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] }));
    setPublishedNow(null);
    onChange(previous);
  }, [history.past, onChange]);
  const redo = useCallback(() => {
    const next = history.future[0];
    if (!next) return;
    coalescing.current = null;
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: h.future.slice(1) }));
    setPublishedNow(null);
    onChange(next);
  }, [history.future, onChange]);

  // Selecting never marks the draft changed (a V2 prototype bug, not copied).
  const select = useCallback((next: CanvasSelection | null) => {
    coalescing.current = null;
    setSelection(next);
    setGroup([]);
  }, []);
  const selectMany = useCallback((items: readonly CanvasSelection[]) => {
    coalescing.current = null;
    setSelection(null);
    setGroup(items.map((i) => i.key));
  }, []);

  const openStages = useMemo(() => stages.filter((s) => open.has(s.category)), [stages]);
  const endStages = useMemo(() => stages.filter((s) => !open.has(s.category)), [stages]);
  const stepOf = (key: string, d: WorkflowDefinition = definition) => d.steps.find((s) => s.key === key);
  const isTerminal = useCallback((s: WorkflowStep) => s.actor === null || endStages.some((e) => e.key === s.stage), [endStages]);

  /** Where a new Step or End goes in a band when it isn't dropped: under what the band holds. */
  const freeSpot = (stage: string, terminal: boolean) => {
    const model = workflowMap({ definition, stages, dir: "ltr", everyStage: true });
    const band = model.bands.find((b) => b.key === (terminal ? "outcome" : stage)) ?? model.bands[0]!;
    const inBand = model.nodes.filter((n) => n.x >= band.x && n.x < band.x + band.width);
    const y = inBand.length === 0 ? 80 : Math.max(...inBand.map((n) => n.y + n.height)) + 40;
    return { x: band.x + (terminal ? 40 : 25), y: Math.round(y / 20) * 20 };
  };

  /**
   * `base` with a Transition from `from` to `to`, named by its kind as the reference does (RP-555):
   * a Submit to another Participant, a Return back along the route, a Send otherwise, a Cancel
   * into the Cancelled End, and a Close named after the End it goes to.
   */
  const withTransition = (base: WorkflowDefinition, from: string, to: string): { definition: WorkflowDefinition; key: string; label: BilingualText } | null => {
    const source = stepOf(from, base);
    const target = stepOf(to, base);
    if (!source || !target || from === to) return null;
    const cancel = isTerminal(target) && stages.find((s) => s.key === target.stage)?.category === "cancelled";
    const kind = cancel ? "cancel" : connectSteps(base, from, to, labels.names.newTransition).definition.transitions.at(-1)!.kind;
    const named: Partial<Record<WorkflowTransition["kind"], BilingualText>> = {
      send: labels.names.send,
      submit: labels.names.submit,
      return: labels.names.return,
      cancel: labels.names.cancel,
      close: target.name,
    };
    const label = named[kind] ?? labels.names.newTransition;
    const added = connectSteps(base, from, to, label);
    return { key: added.key, label, definition: cancel ? updateTransition(added.definition, added.key, { kind: "cancel" }) : added.definition };
  };

  const connect = (from: string, to: string) => {
    const source = stepOf(from);
    if (source && isTerminal(source)) {
      toast({ title: labels.endsCannotStart, tone: "danger" });
      return;
    }
    const added = withTransition(definition, from, to);
    if (!added) return;
    commit(added.definition);
    select({ kind: "transition", key: added.key });
    toast({ title: labels.addedTransition(added.label[locale]), tone: "success" });
  };

  /** A connection dropped on empty canvas: a new Step there, of the source's Participant, already connected (one undo step). */
  const connectToEmpty = (from: string, at: { x: number; y: number }, stage: string | null) => {
    const source = stepOf(from);
    if (!source || isTerminal(source)) {
      toast({ title: labels.endsCannotStart, tone: "danger" });
      return;
    }
    const into = stage && openStages.some((s) => s.key === stage) ? stage : openStages.filter((s) => s.category === "in_progress").at(-1)?.key;
    if (!into) return;
    const step = addStep(definition, { name: labels.names.newStep, stage: into, actor: { role: source.actor?.role ?? "contractor", permission: "review" }, at });
    const added = withTransition(step.definition, from, step.key);
    if (!added) return;
    commit(added.definition);
    select({ kind: "transition", key: added.key });
    toast({ title: labels.addedTransition(added.label[locale]), tone: "success" });
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
    // Side by side, as the reference's: the second a column along.
    const second = addStep(first.definition, {
      name: internal ? labels.names.pmReview : labels.names.consultantManager,
      stage: into,
      actor: { role, permission: "approve" },
      at: { x: base.x + 280, y: base.y },
    });
    let next = internal ? second.definition : updateStep(updateStep(second.definition, first.key, { outcomeMode: "recommend_code" }), second.key, { outcomeMode: "issue_outcome" });
    next = connectSteps(next, first.key, second.key, labels.names.send).definition;
    next = connectSteps(next, second.key, first.key, labels.names.return).definition;
    commit(next);
    select(null);
  };

  const remove = useCallback(() => {
    const keys = group.length > 1 ? group : selection ? [selection.key] : [];
    if (keys.length === 0) return;
    let next = definition;
    for (const key of keys) next = next.steps.some((s) => s.key === key) ? removeStep(next, key) : removeTransition(next, key);
    commit(next);
    select(null);
  }, [group, selection, definition, commit, select]);

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
      } else if ((e.key === "Delete" || e.key === "Backspace") && (selection || group.length > 0) && !testRun) {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape" && !publish && !popup) {
        select(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo, remove, select, selection, group, testRun, publish, popup]);

  const autoLayout = () => {
    commit({ ...definition, layout: arrangedLayout(definition, stages) });
    setFitNonce((n) => n + 1);
  };

  // Test run: from the Draft Step, take a Transition at each Step, filling (or skipping) its pop-up; the path stays lit, the rest fades.
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
  const take = (t: WorkflowTransition) => setTestRun((run) => run && { at: t.to, path: [...run.path, t.to], edges: [...run.edges, t.key] });

  const errorKeys = useMemo(
    () => new Set(problems.filter((p) => p.severity === "error").flatMap((p) => [p.transition ?? p.step].filter((k): k is string => k !== undefined))),
    [problems],
  );
  const createsItems = useMemo(() => new Set(definition.transitions.filter((t) => createsItemsOf(askedForm(t, screens))).map((t) => t.key)), [definition.transitions, screens]);

  /** Selects what a problem (or a list's Transition) concerns and brings it into view. */
  const show = (target: { step?: string | undefined; transition?: string | undefined }) => {
    if (target.transition) {
      select({ kind: "transition", key: target.transition });
      const t = definition.transitions.find((x) => x.key === target.transition);
      if (t) setFocus({ key: t.from, nonce: Date.now() });
    } else if (target.step) {
      select({ kind: "step", key: target.step });
      setFocus({ key: target.step, nonce: Date.now() });
    }
  };

  const validate = async () => {
    const found = await onValidate();
    const errors = found.filter((p) => p.severity === "error");
    if (errors.length === 0) {
      toast({ title: labels.validationPassed, tone: "success" });
      return;
    }
    toast({ title: labels.errorsToFix(errors.length, v(errors.length)), tone: "danger" });
    // As the reference's: the first error is selected and brought into view.
    show(errors[0]!);
    setActiveProblem(found.indexOf(errors[0]!));
  };

  const openPublish = async () => {
    setPublish({ phase: "checking" });
    setPublish({ phase: "ready", problems: await onValidate() });
  };
  const doPublish = async (changeNote: string) => {
    setPublish({ phase: "publishing" });
    const result = await onPublish(changeNote);
    if (!result.ok) {
      setPublish({ phase: "ready", problems: result.problems });
      return;
    }
    // As the reference's (owner's decision 4): the builder stays, the badge says published, Publish rests until the next edit.
    setPublish(null);
    setPublishedNow(result.versionNo);
    setHistory((h) => ({ past: [], present: h.present, future: [] }));
    const href = props.versionsHref?.(result.versionNo);
    toast({
      title: labels.published(v(result.versionNo)),
      description: href ? (
        <a href={href} className={cn("font-semibold text-brand-fg underline", focusRing)}>
          {labels.viewVersions}
        </a>
      ) : undefined,
      tone: "success",
    });
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
  const routeOf = (t: WorkflowTransition) => `${stepOf(t.from)?.name[locale] ?? t.from} → ${stepOf(t.to)?.name[locale] ?? t.to}`;
  const popupTransition = popup ? definition.transitions.find((t) => t.key === popup.transition) : undefined;

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-2.5 p-3 sm:px-4">
      <div className="flex items-center gap-2">
        <a
          href={backHref}
          aria-label={labels.back}
          title={labels.back}
          className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-on-ghost hover:bg-ghost-hover", focusRing)}
        >
          <Icon name="arrow-left" size={16} />
        </a>
        <h1 className={cn("m-0 min-w-0 truncate rounded-xs text-[17px] font-bold", focusRing)} title={name} tabIndex={0}>
          {name}
        </h1>
        {publishedNow !== null ? (
          <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md bg-success-tint px-2 text-[11.5px] font-bold whitespace-nowrap text-success-fg">
            <Icon name="check" size={12} />
            {labels.publishedBadge(v(publishedNow))}
          </span>
        ) : (
          <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md bg-warning-tint px-2 text-[11.5px] font-bold whitespace-nowrap text-warning-fg">
            <Icon name="edit" size={12} />
            {labels.draft(v(versionNo))}
            <span aria-live="polite" className={cn("font-medium", saveState.kind === "failed" && "text-danger-fg")}>
              {status !== null && `· ${status}`}
            </span>
          </span>
        )}
        <span className="flex-1" />
        <div role="radiogroup" aria-label={labels.arrowStyle} className="inline-flex shrink-0 gap-0.5 rounded-[7px] bg-field-fill p-0.5 shadow-[inset_0_0_0_1px_var(--control-border)]">
          {(
            [
              ["curved", "route", labels.curved],
              ["orthogonal", "link", labels.orthogonal],
            ] as const
          ).map(([style, icon, text]) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={view.arrowStyle === style}
              title={text}
              onClick={() => setView({ arrowStyle: style })}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-semibold text-muted [&_svg]:size-[15px]",
                view.arrowStyle === style && "bg-surface text-text shadow-[0_1px_2px_color-mix(in_srgb,var(--text)_8%,transparent),inset_0_0_0_1px_var(--control-border)]",
                focusRing,
              )}
            >
              <Icon name={icon} />
              <span className={"lg:max-[1439px]:sr-only"}>{text}</span>
            </button>
          ))}
        </div>
        <IconButton label={labels.undo} title="⌘Z" variant="secondary" onClick={undo} disabled={history.past.length === 0}>
          <Icon name="arrow-back-up" />
        </IconButton>
        <IconButton label={labels.redo} title="⇧⌘Z" variant="secondary" onClick={redo} disabled={history.future.length === 0}>
          <Icon name="arrow-forward-up" />
        </IconButton>
        <Button variant="secondary" onClick={autoLayout}>
          <Icon name="layout-grid" />
          {labels.autoLayout}
        </Button>
        <Button
          variant="secondary"
          aria-pressed={!!testRun}
          onClick={toggleTestRun}
          // While a run is on: the reference's tomato tint.
          className={cn(testRun && "bg-brand-tint text-brand-fg hover:bg-brand-tint")}
        >
          <Icon name="player-play" />
          {labels.testRun}
        </Button>
        <Button variant="secondary" onClick={() => void validate()}>
          <Icon name={errors.length ? "alert-triangle" : "circle-check"} />
          {labels.validate}
        </Button>
        <Button onClick={() => void openPublish()} disabled={publishedNow !== null}>
          <Icon name="upload" />
          {labels.publish}
        </Button>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-2.5 lg:grid-rows-[minmax(0,1fr)_auto]",
          "lg:max-[1439px]:grid-cols-[64px_minmax(0,1fr)_290px] min-[1440px]:grid-cols-[200px_minmax(0,1fr)_330px]",
        )}
      >
        <aside
          aria-label={labels.palette}
          className={cn("flex min-w-0 flex-col gap-1.5 overflow-x-hidden overflow-y-auto rounded-[14px] border border-border bg-surface p-3 lg:row-span-2", "lg:max-[1439px]:p-2")}
        >
          <div className={"lg:max-[1439px]:hidden"}>
            <Heading>{labels.add}</Heading>
          </div>
          <PaletteItem item="step" hint={labels.dragHint} icon={<Icon name="square-plus" size={16} className="shrink-0" />} onAdd={() => addItem("step", selectedStage())}>
            {labels.step}
          </PaletteItem>
          {endStages.map((s) => {
            const colour = stageVars(stageColour(s));
            return (
              <PaletteItem
                key={s.key}
                item={`end:${s.key}`}
                hint={labels.dragHint}
               
                onAdd={() => addItem(`end:${s.key}`, null)}
                icon={<i aria-hidden="true" className="size-[14px] shrink-0 rounded-full" style={{ background: colour.bg, boxShadow: `inset 0 0 0 2px ${colour.dot}` }} />}
              >
                {labels.end(s.name[locale])}
              </PaletteItem>
            );
          })}
          <div className={"lg:max-[1439px]:hidden"}>
            <Heading>{labels.templates}</Heading>
          </div>
          <PaletteItem item="template:internal" hint={labels.dragHint} icon={<Icon name="template" size={16} className="shrink-0" />} onAdd={() => addItem("template:internal", null)}>
            {labels.templateInternal}
          </PaletteItem>
          <PaletteItem item="template:consultant" hint={labels.dragHint} icon={<Icon name="template" size={16} className="shrink-0" />} onAdd={() => addItem("template:consultant", null)}>
            {labels.templateConsultant}
          </PaletteItem>
          <div className={cn("flex flex-col gap-2", "lg:max-[1439px]:hidden")}>
            <Heading>{labels.canvasHeading}</Heading>
            <Field label={labels.snapToGrid} layout="inline" className="text-[12.5px]">
              <Switch checked={view.snap} onCheckedChange={(on) => setView({ snap: on })} />
            </Field>
            <Field label={labels.minimap} layout="inline" className="text-[12.5px]">
              <Switch checked={view.minimap} onCheckedChange={(on) => setView({ minimap: on })} />
            </Field>
          </div>
        </aside>

        <section className="relative min-h-[420px] lg:col-start-2 lg:row-start-1">
          <WorkflowCanvas
            definition={definition}
            stages={stages}
            locale={locale}
            labels={labels.map}
            mode="edit"
            selection={testRun ? null : selection}
            group={testRun ? undefined : group}
            onSelect={testRun ? undefined : select}
            onSelectMany={testRun ? undefined : selectMany}
            onConnect={testRun ? undefined : connect}
            onConnectToEmpty={testRun ? undefined : connectToEmpty}
            onConnectFromEnd={() => toast({ title: labels.endsCannotStart, tone: "danger" })}
            onMoveSteps={(moves: readonly CanvasMove[]) => commit(moves.reduce((d, m) => moveStep(d, m.key, m.at, m.stage), definition))}
            onDropItem={(item, stage, at) => addItem(item, stage === "outcome" ? null : stage, at)}
            marks={marks}
            errors={errorKeys}
            createsItems={createsItems}
            focus={focus}
            fitNonce={fitNonce}
            // The test run's bar covers the overview, as the reference's.
            minimap={view.minimap && !testRun}
            arrowStyle={view.arrowStyle}
            snapToGrid={view.snap}
            className="h-full rounded-[14px]"
          >
            {testRun && (
              <TestRunBar
                run={testRun}
                definition={definition}
                fields={sampleFields}
                form={form}
                sample={sample ?? {}}
                onSample={(key, value) => setSample((s) => ({ ...s, [key]: value }))}
                typeCode={props.typeCode}
                offered={offered}
                locale={locale}
                labels={labels}
                terminal={(key) => {
                  const s = stepOf(key);
                  return !!s && isTerminal(s);
                }}
                // Each move opens its pop-up in test mode (owner's decision 10).
                onTake={(t) => setPopup({ transition: t.key, mode: "test" })}
                onRestart={() => startStep && setTestRun({ at: startStep.key, path: [startStep.key], edges: [] })}
                onClose={() => setTestRun(null)}
              />
            )}
          </WorkflowCanvas>
        </section>

        <aside
          aria-label={labels.editor}
          className="flex min-w-0 flex-col gap-2.5 overflow-auto rounded-[14px] border border-border bg-surface px-[14px] py-3 lg:col-start-3 lg:row-span-2 lg:row-start-1"
        >
          <SideEditor
            definition={definition}
            selection={selection}
            group={group}
            stages={stages}
            openStages={openStages}
            outcomes={outcomes}
            positions={positions}
            form={form}
            screens={screens}
            problems={problems}
            locale={locale}
            labels={labels}
            screensHref={props.screensHref}
            isTerminal={isTerminal}
            onCommit={commit}
            onConnect={connect}
            onDelete={remove}
            onPick={(s) => show(s.kind === "step" ? { step: s.key } : { transition: s.key })}
            onPreview={(key) => setPopup({ transition: key, mode: "preview" })}
          />
        </aside>

        <section aria-label={labels.problemsName} className="max-h-[150px] overflow-auto rounded-[14px] border border-border bg-surface px-3 py-2 lg:col-start-2 lg:row-start-2">
          <div className="mb-1 flex items-center gap-2 text-[12.5px] font-bold">
            <Icon name={errors.length ? "alert-triangle" : "circle-check"} size={16} style={{ color: errors.length ? "var(--danger-fg)" : "var(--success)" }} />
            {errors.length ? labels.errors(errors.length, v(errors.length)) : labels.noErrors}
            {warnings > 0 && <span className="font-semibold text-muted">· {labels.warnings(warnings, v(warnings))}</span>}
          </div>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.code}:${p.step ?? ""}:${p.transition ?? ""}:${p.detail ?? ""}:${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveProblem(i);
                    show(p);
                  }}
                  aria-label={labels.showProblem(p.message[locale])}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] text-text hover:bg-hover", activeProblem === i && "bg-hover", focusRing)}
                >
                  <Icon
                    name={p.severity === "error" ? "circle-x" : "alert-triangle"}
                    size={15}
                    className="shrink-0"
                    style={{ color: p.severity === "error" ? "var(--danger-fg)" : "var(--warning-fg)" }}
                  />
                  <span className="flex-1">{listed(p.message[locale], locale)}</span>
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
          onShowFirstError={(first) => {
            setPublish(null);
            if (first) show(first);
          }}
        />
      )}
      {popup && popupTransition && (
        <ActionPopup
          key={`${popup.transition}:${popup.mode}`}
          transition={popupTransition}
          screens={screens}
          mode={popup.mode}
          route={routeOf(popupTransition)}
          locale={locale}
          labels={labels}
          actionFormLabels={props.actionFormLabels}
          // From a Step that recommends a code, the pop-up asks the Recommended Code (the Type's closing outcomes).
          recommend={stepOf(popupTransition.from)?.outcomeMode === "recommend_code" ? outcomes.filter((o) => o.closing) : null}
          onCancel={() => setPopup(null)}
          onSkip={() => {
            setPopup(null);
            take(popupTransition);
          }}
          onConfirm={(items) => {
            setPopup(null);
            if (popup.mode === "preview") {
              toast({ title: labels.previewOnly, tone: "info" });
              return;
            }
            take(popupTransition);
            const made = outcomes.find((o) => o.code === popupTransition.outcome)?.createsItems;
            toast({
              title: items === 0 ? labels.testRecorded : made ? labels.testWouldCreateOf(items, v(items), made.name[locale]) : labels.testWouldCreate(items, v(items)),
              tone: "info",
            });
          }}
        />
      )}
    </div>
  );

  function selectedStage(): string | null {
    if (selection?.kind !== "step") return null;
    return stepOf(selection.key)?.stage ?? null;
  }
}

/** A palette item, as the reference's: dragged onto the canvas or clicked to add; below 1440px wide only its icon shows (its name stays for screen readers and as its tooltip). */
function PaletteItem({ item, icon, hint, onAdd, children }: { item: string; icon: ReactNode; hint: string; onAdd: () => void; children: string }) {
  return (
    <button
      type="button"
      draggable
      title={`${children} · ${hint}`}
      onDragStart={(e: DragEvent<HTMLButtonElement>) => {
        e.dataTransfer.setData(canvasDragType, item);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      className={cn(
        "flex w-full min-w-0 cursor-grab items-center gap-2 rounded-[9px] bg-surface-subtle px-2.5 py-[9px] text-start text-[12.5px] font-semibold text-text shadow-[inset_0_0_0_1px_var(--border-subtle)] hover:shadow-[inset_0_0_0_1px_var(--primary)] active:cursor-grabbing",
        "lg:max-[1439px]:justify-center lg:max-[1439px]:px-0 lg:max-[1439px]:py-2.5 lg:max-[1439px]:[&_svg]:size-[18px]",
        focusRing,
      )}
    >
      {icon}
      {/* Whole names, wrapped when long (the reference clipped them at 1920: not copied). */}
      <span className={cn("min-w-0 leading-snug", "lg:max-[1439px]:sr-only")}>{children}</span>
      <Icon name="grip-vertical" size={14} className={cn("ms-auto text-faint", "lg:max-[1439px]:hidden")} />
    </button>
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
  /** Closes the dialog and brings the first error into view. */
  onShowFirstError: (first: WorkflowProblem | undefined) => void;
};

/**
 * Publish (the reference's publish modal, RP-555): what changed since the published Version,
 * the server's check of the saved draft, the required change note the Version keeps, and how
 * many items (of those the author sees) keep their Version.
 */
function PublishDialog({ state, versionNo, published, running, definition, locale, labels, onClose, onPublish, onShowFirstError }: PublishDialogProps) {
  const v = (n: number) => formatNumber(n, locale);
  const errors = state.phase === "ready" ? state.problems.filter((p) => p.severity === "error") : [];
  const [changeNote, setChangeNote] = useState("");
  const [changeNoteMissing, setChangeNoteMissing] = useState(false);
  const changeNoteBox = useRef<HTMLTextAreaElement>(null);
  const latest = published ? (running.find((r) => r.versionNo === published.versionNo)?.count ?? 0) : 0;
  const older = running.filter((r) => published && r.versionNo !== published.versionNo).reduce((sum, r) => sum + r.count, 0);
  const submit = () => {
    if (changeNote.trim() === "") {
      setChangeNoteMissing(true);
      changeNoteBox.current?.focus();
      return;
    }
    onPublish(changeNote.trim());
  };
  const box = (tone: "danger" | "success" | "info" | "neutral", icon: IconName, children: ReactNode) => (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold",
        tone === "danger" ? "bg-danger-tint text-danger-fg" : tone === "success" ? "bg-success-tint text-success-fg" : tone === "info" ? "bg-info-tint font-medium text-info-fg" : "bg-surface-subtle text-muted",
      )}
    >
      <Icon name={icon} size={16} className="shrink-0" />
      {children}
    </div>
  );
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        title={
          <span className="flex items-center gap-2.5 font-sans font-bold">
            <Icon name="upload" size={16} className="text-primary" />
            {labels.publishTitle(v(versionNo))}
          </span>
        }
        closeLabel={labels.close}
        // The change note takes the focus, not the close button.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          changeNoteBox.current?.focus();
        }}
        className={cn(referenceModal, "w-[min(620px,calc(100%-2rem))]")}
      >
        <div className={referenceModalBody}>
          <h3 className="m-0 text-[11px] font-bold tracking-wider text-muted uppercase">{published ? labels.changesSince(v(published.versionNo)) : labels.firstVersion}</h3>
          {published && <WorkflowChangeList before={published.definition} after={definition} locale={locale} labels={labels} />}
          <div role="status" aria-live="polite">
            {state.phase === "ready" && errors.length > 0 ? (
              box(
                "danger",
                "circle-x",
                <>
                  {labels.errorsBlock(errors.length, v(errors.length))}
                  <Button size="sm" variant="secondary" className="ms-auto" onClick={() => onShowFirstError(errors[0])}>
                    {labels.showFirstError}
                  </Button>
                </>,
              )
            ) : state.phase === "ready" ? (
              box("success", "circle-check", labels.passed)
            ) : (
              box("neutral", "clock", labels.checking)
            )}
          </div>
          <Field label={labels.changeNote} required error={changeNoteMissing && changeNote.trim() === "" ? labels.changeNoteRequired : undefined}>
            <Textarea ref={changeNoteBox} value={changeNote} rows={3} maxLength={1000} placeholder={labels.changeNotePlaceholder} onChange={(e) => setChangeNote(e.target.value)} />
          </Field>
          {box(
            "info",
            "info-circle",
            published && latest + older > 0
              ? labels.keepVersions({ latest, latestN: v(latest), older, olderN: v(older), version: v(published.versionNo), next: v(versionNo) })
              : labels.appliesToNew(v(versionNo)),
          )}
        </div>
        <DialogFooter className={referenceModalFooter}>
          <Button variant="secondary" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button onClick={submit} disabled={state.phase !== "ready" || errors.length > 0}>
            <Icon name="upload" />
            {labels.publishVersion(v(versionNo))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
