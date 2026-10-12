"use client";

import {
  baseRoles,
  formatNumber,
  formFields,
  functionPermissions,
  itemsToCreateKey,
  outcomeModes,
  parseActionForm,
  stepEditsForm,
  transitionKinds,
  transitionRuleFields,
  updateStep,
  updateTransition,
  type BaseRole,
  type BilingualText,
  type FormField,
  type FormSchema,
  type Locale,
  type PositionOption,
  type WorkflowDefinition,
  type WorkflowProblem,
  type WorkflowScreenOption,
  type WorkflowStep,
  type WorkflowTransition,
} from "@rabaed/domain";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Checkbox } from "../form/checkbox.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import { stageColour } from "../status/stage-colour.ts";
import type { ActionFieldKind, WorkflowBuilderLabels } from "./workflow-builder-labels.ts";
import type { CanvasSelection } from "./workflow-canvas.tsx";
import type { MapStage } from "./workflow-map.ts";
import { edgeLook, stageVars } from "./workflow-parts.tsx";
import { TransitionNotifications, TransitionRules } from "./workflow-transition-rules.tsx";

/** An outcome of the Type's set, as the builder offers it to a closing Transition. */
type Outcome = { code: string; name: BilingualText; closing: boolean };

export type SideEditorProps = {
  definition: WorkflowDefinition;
  selection: CanvasSelection | null;
  /** Several selected together (Shift-drag), by key. */
  group: readonly string[];
  stages: readonly MapStage[];
  openStages: readonly MapStage[];
  outcomes: readonly Outcome[];
  positions: readonly PositionOption[];
  form: FormSchema | null;
  screens: readonly WorkflowScreenOption[];
  problems: readonly WorkflowProblem[];
  locale: Locale;
  labels: WorkflowBuilderLabels;
  /** Where the Screens are edited (Settings → Screens); none: no link. */
  screensHref?: string | undefined;
  isTerminal: (s: WorkflowStep) => boolean;
  onCommit: (definition: WorkflowDefinition, coalesce?: string | null) => void;
  onConnect: (from: string, to: string) => void;
  onDelete: () => void;
  /** A Transition picked from a Step's or an End's list: select it and bring it into view. */
  onPick: (selection: CanvasSelection) => void;
  /** Opens the chosen Screen's pop-up as the holder sees it. */
  onPreview: (transition: string) => void;
};

/** The danger-tint pill a delete takes, as the reference's. */
const deleteLook = cn(
  "inline-flex h-7 items-center gap-1.5 self-start rounded-sm bg-danger-tint px-2.5 text-[12.5px] font-semibold text-danger-fg hover:bg-[color-mix(in_srgb,var(--danger)_18%,var(--surface))] [&_svg]:size-4",
  focusRing,
);

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mt-1.5 mb-1 text-[10.5px] font-bold tracking-wider text-muted uppercase">{children}</h2>;
}

/** A Transition's colour on the canvas, for the dot beside it in a list. */
function transitionColour(t: WorkflowTransition, stages: readonly MapStage[], definition: WorkflowDefinition): string {
  const to = definition.steps.find((s) => s.key === t.to);
  const stage = stages.find((s) => s.key === to?.stage);
  const closing = to && stage && to.actor === null ? stageColour(stage) : null;
  return edgeLook({ transition: t, targetColour: closing }).colour;
}

/** The side editor: the selected Step, End or Transition, several selected together, or what the draft holds. */
export function SideEditor(props: SideEditorProps) {
  const { definition, selection, group, locale, labels } = props;
  const step = selection?.kind === "step" ? definition.steps.find((s) => s.key === selection.key) : undefined;
  const transition = selection?.kind === "transition" ? definition.transitions.find((t) => t.key === selection.key) : undefined;
  if (step) return props.isTerminal(step) ? <EndEditor {...props} step={step} /> : <StepEditor {...props} step={step} />;
  if (transition) return <TransitionEditor {...props} transition={transition} />;
  if (group.length > 1) {
    return (
      <>
        <Heading>{labels.groupSelected(group.length, formatNumber(group.length, locale))}</Heading>
        <p className="m-0 text-[13px] leading-normal text-muted">{labels.groupHint}</p>
      </>
    );
  }
  const steps = definition.steps.filter((s) => !props.isTerminal(s)).length;
  const transitions = definition.transitions.length;
  const kbd = (key: string) => <kbd className="rounded-[4px] border border-border-strong px-1 font-sans text-[10.5px] font-semibold text-muted">{key}</kbd>;
  const tip = (icon: IconName, text: ReactNode) => (
    <li className="flex gap-2 text-[12.5px] leading-[1.45] text-text-secondary">
      <Icon name={icon} size={16} className="mt-px text-primary" />
      <span>{text}</span>
    </li>
  );
  return (
    <>
      <Heading>{labels.nothingSelected}</Heading>
      <p className="m-0 text-[13px] leading-normal text-muted">{labels.nothingSelectedHint}</p>
      <Heading>{labels.tipsHeading}</Heading>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {tip("git-branch", labels.tipConnect)}
        {tip("hand-move", labels.tipPalette)}
        {tip("pointer", labels.tipBoxSelect)}
        {tip(
          "trash",
          <>
            {kbd("Delete")} {labels.tipDelete} · {kbd("⌘Z")} {labels.tipUndo} · {kbd("⇧⌘Z")} {labels.tipRedo}
          </>,
        )}
      </ul>
      <Heading>{labels.thisDraft}</Heading>
      <p className="m-0 text-[13px]">
        {labels.counts({ steps, stepsN: formatNumber(steps, locale), transitions, transitionsN: formatNumber(transitions, locale) })}
      </p>
    </>
  );
}

/** Transitions as the reference lists them under a Step or an End: a dot in the arrow's colour, the label, where it goes. */
function TransitionList({ items, props, showTarget }: { items: WorkflowTransition[]; props: SideEditorProps; showTarget: boolean }) {
  const { definition, stages, locale, onPick } = props;
  const nameOf = (key: string) => definition.steps.find((s) => s.key === key)?.name[locale] ?? key;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((t) => (
        <li key={t.key}>
          <button
            type="button"
            onClick={() => onPick({ kind: "transition", key: t.key })}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg bg-surface-subtle px-[9px] py-[7px] text-start text-[12.5px] text-text hover:shadow-[inset_0_0_0_1px_var(--primary)]",
              focusRing,
            )}
          >
            <i aria-hidden="true" className="h-[3px] w-2.5 shrink-0 rounded-sm" style={{ background: transitionColour(t, stages, definition) }} />
            <bdi className="min-w-0 flex-1 truncate">{t.label[locale]}</bdi>
            {showTarget && (
              <>
                <Icon name="arrow-right" size={14} className="text-faint" />
                <bdi className="max-w-[45%] min-w-0 truncate text-muted">{nameOf(t.to)}</bdi>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A name in both languages, English then Arabic; `fieldLabels` are the two fields' labels in the viewer's language. */
function NameFields({ value, coalesceKey, fieldLabels, onChange }: { value: BilingualText; coalesceKey: string; fieldLabels: [string, string]; onChange: (name: BilingualText, coalesce: string) => void }) {
  return (
    <>
      <Field label={fieldLabels[0]}>
        <Input value={value.en} dir="ltr" onChange={(e) => onChange({ ...value, en: e.target.value }, `${coalesceKey}:en`)} />
      </Field>
      <Field label={fieldLabels[1]}>
        <Input value={value.ar} dir="rtl" onChange={(e) => onChange({ ...value, ar: e.target.value }, `${coalesceKey}:ar`)} />
      </Field>
    </>
  );
}

/** An End, as the reference's: its name (its Stage's), what an End does, the Transitions into it, and Delete. */
function EndEditor(props: SideEditorProps & { step: WorkflowStep }) {
  const { definition, step, locale, labels, onDelete } = props;
  const incoming = definition.transitions.filter((t) => t.to === step.key);
  return (
    <>
      <Heading>{labels.endHeading}</Heading>
      <b className="text-[14px]">{step.name[locale]}</b>
      <p className="m-0 text-[12.5px] text-muted">{labels.endHint}</p>
      <Heading>{labels.incoming(formatNumber(incoming.length, locale))}</Heading>
      <TransitionList items={incoming} props={props} showTarget={false} />
      <button type="button" className={deleteLook} onClick={onDelete}>
        <Icon name="trash" />
        {labels.deleteEnd}
      </button>
    </>
  );
}

function StepEditor(props: SideEditorProps & { step: WorkflowStep }) {
  const { definition, step, openStages, stages, positions, locale, labels, onCommit, onConnect, onDelete } = props;
  const set = (patch: Partial<Omit<WorkflowStep, "key">>, coalesce: string | null = null) => onCommit(updateStep(definition, step.key, patch), coalesce);
  const actor = step.actor ?? { role: "contractor" as BaseRole, permission: "review" as const };
  const isDraft = stages.find((s) => s.key === step.stage)?.category === "draft";
  // The raiser's Steps: those of the Draft Step's Participant role (ADR 0019).
  const raiserRole = definition.steps.find((s) => stages.find((st) => st.key === s.stage)?.category === "draft")?.actor?.role;
  const raiser = raiserRole !== undefined && actor.role === raiserRole;
  const ofRole = positions.filter((p) => p.role === actor.role);
  const targets = definition.steps.filter((s) => s.key !== step.key);
  const outs = definition.transitions.filter((t) => t.from === step.key);
  return (
    <>
      <Heading>{labels.stepHeading}</Heading>
      <NameFields value={step.name} coalesceKey={step.key} fieldLabels={[labels.nameEn, labels.nameAr]} onChange={(name, coalesce) => set({ name }, coalesce)} />
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
      <p className="m-0 flex items-start gap-1.5 rounded-lg bg-info-tint px-2.5 py-2 text-[12px] leading-[1.45] font-medium text-info-fg">
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
          options={outcomeModes.map((m) => ({ value: m, label: labels.outcomeOption(m) }))}
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
      <Heading>{labels.transitionsFrom(formatNumber(outs.length, locale))}</Heading>
      {outs.length > 0 ? (
        <TransitionList items={outs} props={props} showTarget />
      ) : (
        <p className="m-0 rounded-lg bg-warning-tint px-2.5 py-2 text-[12px] leading-[1.45] font-medium text-warning-fg">{labels.deadEndHint}</p>
      )}
      <Field label={labels.addTransitionTo} help={labels.addTransitionHelp}>
        <Select
          value=""
          placeholder={labels.addTransitionPlaceholder}
          onValueChange={(to) => to && onConnect(step.key, to)}
          options={targets.map((s) => ({ value: s.key, label: s.name[locale] }))}
        />
      </Field>
      <button type="button" className={deleteLook} onClick={onDelete}>
        <Icon name="trash" />
        {labels.deleteStep}
      </button>
    </>
  );
}

/** A Transition's own Action Form, or null when it has none, or one the format no longer reads (publish check 7 names it). */
export function actionFormOf(stored: unknown): FormSchema | null {
  try {
    return parseActionForm(stored);
  } catch {
    return null;
  }
}

/** What a Transition asks (ADR 0019): the chosen Screen's Form, else its own Action Form, else nothing but the Internal Note. */
export function askedForm(transition: WorkflowTransition, screens: readonly WorkflowScreenOption[]): FormSchema | null {
  if (transition.screen !== undefined) return screens.find((s) => s.key === transition.screen)?.schema ?? null;
  return actionFormOf(transition.actionForm);
}

/** The fields a Form asks (display items, such as headings and instructions, ask nothing). */
export function askedFields(form: FormSchema | null): Extract<FormField, { label: unknown }>[] {
  return (form ? formFields(form) : []).flatMap((f) => ("label" in f && !["heading", "instructions", "divider"].includes(f.type) ? [f as Extract<FormField, { label: unknown }>] : []));
}

/** Whether a Form's answers create items: it has the table of items to create (WF-11, Code B's Comments). */
export const createsItemsOf = (form: FormSchema | null): boolean => askedFields(form).some((f) => f.key === itemsToCreateKey && f.type === "table");

const kindOf = (type: string): ActionFieldKind => {
  if (["text", "textarea", "email", "phone"].includes(type)) return "text";
  if (["select", "multi_select", "option_list", "member", "participant"].includes(type)) return "choice";
  if (type === "yes_no" || type === "checkbox") return "yesNo";
  if (["number", "currency", "calculated"].includes(type)) return "number";
  if (["date", "time", "datetime"].includes(type)) return "date";
  if (type === "table" || type === "checklist") return "table";
  if (type === "attachments" || type === "photos") return "files";
  return "other";
};
const kindIcon: Record<ActionFieldKind, IconName> = {
  text: "message",
  choice: "list",
  yesNo: "circle-check",
  number: "hash",
  date: "calendar",
  table: "table",
  files: "paperclip",
  other: "forms",
};

/** One read-only block of the Action Form, as the reference's block cards. */
function Block({ icon, title, detail, required, labels, children }: { icon: IconName; title: string; detail: string; required: boolean | null; labels: WorkflowBuilderLabels; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-[10px] bg-surface-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-primary shadow-[inset_0_0_0_1px_var(--border)]">
          <Icon name={icon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-[13px]">{title}</b>
          <small className="mt-px block text-[11.5px] leading-[1.35] text-muted">{detail}</small>
        </div>
        {required !== null && (
          <span className={cn("rounded-[5px] px-1.5 py-px text-[11px] font-semibold", required ? "bg-danger-tint text-danger-fg" : "bg-surface text-muted shadow-[inset_0_0_0_1px_var(--border-subtle)]")}>
            {required ? labels.required : labels.optional}
          </span>
        )}
      </div>
      {children}
    </li>
  );
}

function TransitionEditor(props: SideEditorProps & { transition: WorkflowTransition }) {
  const { definition, transition, stages, outcomes, positions, form, screens, problems, locale, labels, screensHref, onCommit, onDelete, onPreview } = props;
  const set = (patch: Partial<Omit<WorkflowTransition, "key" | "from" | "to">>, coalesce: string | null = null) =>
    onCommit(updateTransition(definition, transition.key, patch), coalesce);
  const nameOf = (key: string) => definition.steps.find((s) => s.key === key)?.name[locale] ?? key;
  const screen = transition.screen === undefined ? undefined : screens.find((s) => s.key === transition.screen);
  const asked = askedForm(transition, screens);
  const fields = askedFields(asked);
  // What each group of rules may name, as publish check 6 accepts it.
  const ruleFields = transitionRuleFields(form, transition, definition, stages);
  const closes = transition.kind === "close";
  const actingRole = definition.steps.find((s) => s.key === transition.from)?.actor?.role;
  const actingPositions = positions.filter((p) => p.role === actingRole);
  const closing = outcomes.filter((o) => o.closing);
  // The Type's outcomes are Review Codes when each is a letter: the Outcome says so, as the reference's.
  const reviewCodes = closing.length > 0 && closing.every((o) => /^[A-Z]$/.test(o.code));
  const ownForm = transition.screen === undefined && transition.actionForm !== null;
  const picked = transition.screen ?? (ownForm ? "__own" : "__none");
  const pick = (value: string) => {
    const { screen: _old, ...rest } = transition;
    const next = value === "__none" ? { ...rest, actionForm: null } : { ...rest, actionForm: null, screen: value };
    onCommit({ ...definition, transitions: definition.transitions.map((t) => (t.key === transition.key ? next : t)) });
  };
  const itemsMissing = problems.some((p) => p.transition === transition.key && p.code === "items_table_missing");
  return (
    <div key={transition.key} className="flex flex-col gap-2.5">
      <Heading>{labels.transitionHeading}</Heading>
      {/* The route, as the reference's box: where it starts → where it goes. */}
      <p className="m-0 flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-subtle px-2.5 py-2 text-[12.5px] font-semibold">
        <bdi>{nameOf(transition.from)}</bdi>
        <Icon name="arrow-right" size={15} className="text-faint" />
        <bdi>{nameOf(transition.to)}</bdi>
      </p>
      <NameFields
        value={transition.label}
        coalesceKey={transition.key}
        fieldLabels={[labels.labelEn, labels.labelAr]}
        onChange={(label, coalesce) => set({ label }, coalesce)}
      />
      <Field label={labels.kind} group>
        <SegmentedControl
          value={transition.kind}
          onValueChange={(kind) => set({ kind: kind as WorkflowTransition["kind"], ...(kind === "close" ? {} : { outcome: null }) })}
          options={transitionKinds.map((k) => ({ value: k, label: labels.map.kind(k) }))}
          // Six kinds, Send Back included: a 3 by 2 grid in the 330px panel.
          className="grid w-full grid-cols-3 [&>button]:h-7 [&>button]:px-1.5 [&>button]:text-xs"
        />
      </Field>
      <Field label={reviewCodes ? labels.outcomeReviewCode : labels.outcomeCode} help={closes ? undefined : labels.outcomeOnlyOnClose} disabled={!closes}>
        <Select
          value={transition.outcome ?? "none"}
          onValueChange={(code) => set({ outcome: code === "none" ? null : code })}
          options={[{ value: "none", label: labels.noOutcome }, ...closing.map((o) => ({ value: o.code, label: `${o.code} · ${o.name[locale]}` }))]}
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
      <Heading>{labels.actionFormHeading}</Heading>
      {/* The Screen picker (owner's decision 1, ADR 0019): a Transition picks a Screen; its blocks below are read-only. */}
      <Field label={labels.screen} help={labels.screenHelp}>
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
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={labels.actionFormHeading}>
        {fields.map((f) => {
          const table = f.key === itemsToCreateKey && f.type === "table";
          const kind = kindOf(f.type);
          return (
            <Block
              key={f.key}
              icon={table ? "list-check" : kindIcon[kind]}
              title={f.label[locale]}
              detail={labels.fieldKind(kind)}
              required={"required" in f && f.required === true}
              labels={labels}
            >
              {table && (
                <p className="m-0 flex items-start gap-1.5 rounded-lg bg-info-tint px-2.5 py-2 text-[12px] leading-[1.45] font-medium text-info-fg">
                  <Icon name="clipboard-list" size={14} className="mt-px" />
                  {labels.createsItems}
                </p>
              )}
            </Block>
          );
        })}
        {/* Fixed under every Action Form (form-engine.md): kept with the Transition, inside the writer's Participant (V5). */}
        <Block icon="message" title={labels.internalNote} detail={labels.internalNoteBlock} required={false} labels={labels} />
      </ul>
      {itemsMissing && (
        <p className="m-0 flex items-start gap-1.5 rounded-lg bg-warning-tint px-2.5 py-2 text-[12px] leading-[1.45] font-medium text-warning-fg">
          <Icon name="alert-triangle" size={14} className="mt-px" />
          {labels.itemsTableMissing}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPreview(transition.key)}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-sm bg-secondary px-2.5 text-[12.5px] font-semibold text-on-secondary hover:bg-secondary-hover [&_svg]:size-4", focusRing)}
        >
          <Icon name="external-link" />
          {labels.previewPopup}
        </button>
        {screensHref && screen && (
          <a href={screensHref} className={cn("inline-flex items-center gap-1 rounded-xs text-[12.5px] font-semibold text-brand-fg hover:underline", focusRing)}>
            {labels.editInScreens}
          </a>
        )}
      </div>
      {/* Inline, as built (owner's decision 2); no "Company admins" or "Distribution list" (visibility.md). */}
      <TransitionNotifications
        definition={definition}
        transition={transition}
        steps={definition.steps}
        positionOptions={positions}
        locale={locale}
        labels={labels.rules}
        onCommit={onCommit}
      />
      <button type="button" className={deleteLook} onClick={onDelete}>
        <Icon name="trash" />
        {labels.deleteTransition}
      </button>
    </div>
  );
}

/** A Stage band's colour, for a Transition's code chip in the pop-up (A and B approved, C resubmit, D rejected). */
export const codeColour = (code: string) => stageVars(code === "C" ? "resubmitted" : code === "D" ? "rejected" : "approved");
