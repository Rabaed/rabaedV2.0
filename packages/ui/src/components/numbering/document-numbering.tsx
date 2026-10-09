"use client";

import type { NumberingAttributes, NumberingCounter, NumberingPattern } from "@rabaed/domain";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Field } from "../form/field.tsx";
import { Icon } from "../icon/icon.tsx";
import { SettingsSection } from "../settings/settings-layout.tsx";
import { NumberingDrawer, NumberingModal, TypeCode } from "./numbering-drawer.tsx";
import { comfortableLength, maxSegments, nextSequences, patternNumber, samePattern, sharesCounter } from "./numbering-model.ts";
import { PatternNumber, rich, toneClasses, type NumberingText } from "./numbering-text.tsx";
import { AddSegments, PatternWarnings, SegmentChips, SequenceOptions } from "./pattern-editor.tsx";

// Project Settings → Document Numbering (RP-412 rebuild; kit settings-numbering.html,
// settings/numbering.js and .css; brief design/prompts/document-numbering-settings.md):
// the live preview, the Project pattern edited in place, its sequence, the table of
// Work Item Types with their Custom patterns (edited in a drawer), the fixed revision
// suffix, and the floating "Unsaved changes" bar that opens the save confirmation.
// Every Project Member reads it; only a Project Admin (`canEdit`) gets the controls.
//
// Visibility (visibility.md scenario 55, RP-412-2): real next numbers come only from
// `counters`, which the page passes to Project Admins only, who read counters
// anyway. Everyone else sees examples from their own Participant, sequence from 1.

/** Where example numbers are built from: a Participant and Trade, labelled, e.g. "TMC Constructions · Electrical". */
export type NumberingContext = { label: string; attributes: Omit<NumberingAttributes, "typeCode"> };

/** A Work Item Type with its Custom pattern (null: it uses the Project pattern). */
export type NumberingTypeRow = { id: string; code: string; name: string; custom: NumberingPattern | null };

/** One pattern to save: the Project's (`workItemTypeId` null) or a Type's; a Type's null pattern uses the Project pattern again. */
export type PatternChange = { workItemTypeId: string | null; pattern: NumberingPattern | null };

export type DocumentNumberingProps = {
  t: NumberingText;
  canEdit: boolean;
  /** The Project pattern in effect: the saved one, or the Rabaed Default. */
  projectPattern: NumberingPattern;
  isRabaedDefault: boolean;
  types: readonly NumberingTypeRow[];
  /** The live preview's item: the viewer's own Participant and the Project's first Trade. */
  preview: NumberingContext;
  /** The items of the "Next numbers" box and the scope's counters. */
  samples: readonly NumberingContext[];
  /** A Project Admin's counters: the numbers become real next numbers. Absent for anyone else. */
  counters?: readonly NumberingCounter[];
  /** Two of the Project's Trade codes, for the scope's explanation. */
  tradeCodes: readonly string[];
  /** Saves the changes, Project pattern first; true only when the shared-counter warning applies and was accepted. */
  onSave: (changes: PatternChange[], sharedCounterAccepted: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;
};

const withType = (context: NumberingContext, typeCode: string): NumberingAttributes => ({ ...context.attributes, typeCode });

/** The Document Numbering page's settings, below its header. */
export function DocumentNumbering({ t, canEdit, projectPattern, isRabaedDefault, types, preview, samples, counters, tradeCodes, onSave }: DocumentNumberingProps) {
  const firstType = types[0];
  const firstCode = firstType?.code ?? "MAR";
  const savedCustoms = () => Object.fromEntries(types.map((type) => [type.id, type.custom])) as Record<string, NumberingPattern | null>;

  // What is saved, and the Project Admin's edits not saved yet.
  const [saved, setSaved] = useState({ project: projectPattern, customs: savedCustoms() });
  const [project, setProject] = useState(projectPattern);
  const [customs, setCustoms] = useState(savedCustoms);
  const [drawer, setDrawer] = useState<{ type: NumberingTypeRow; pattern: NumberingPattern } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A page refresh brings the saved patterns again; drop the edits only once they match.
  const savedKey = JSON.stringify([projectPattern, types.map((type) => type.custom)]);
  useEffect(() => {
    const next = { project: projectPattern, customs: savedCustoms() };
    setSaved(next);
  }, [savedKey]);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 2600);
    return () => clearTimeout(id);
  }, [done]);

  const changes: PatternChange[] = [
    ...(samePattern(project, saved.project) ? [] : [{ workItemTypeId: null, pattern: project }]),
    ...types.flatMap((type) => (samePattern(customs[type.id] ?? null, saved.customs[type.id] ?? null) ? [] : [{ workItemTypeId: type.id, pattern: customs[type.id] ?? null }])),
  ];
  const dirty = canEdit && changes.length > 0;
  const needsAcceptance = changes.some((c) => c.pattern !== null && sharesCounter(c.pattern));

  const numberFor = (pattern: NumberingPattern, contexts: readonly NumberingContext[], typeCode: string) => {
    const items = contexts.map((c) => withType(c, typeCode));
    const seqs = nextSequences(pattern, items, counters);
    return items.map((item, i) => patternNumber(pattern, item, seqs[i]!));
  };
  const [previewNumber] = numberFor(project, [preview], firstCode);
  const typeName = firstType?.name ?? firstCode;
  const previewContext = `${preview.label} · ${typeName}`;
  const sampleNumbers = numberFor(project, samples, firstCode);

  const discard = () => {
    setProject(saved.project);
    setCustoms(saved.customs);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    const result = await onSave(changes, needsAcceptance && accepted).catch(() => ({ ok: false as const, error: t("unavailable") }));
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved({ project, customs });
    setReviewing(false);
    setDone(true);
  };

  const editProject = canEdit ? setProject : undefined;
  const legendKinds = [...new Set(project.segments.map((s) => s.kind))];

  return (
    <>
      {/* Live preview */}
      <SettingsSection
        title={t("previewTitle")}
        description={t(counters ? "previewNext" : "previewExample", { context: previewContext })}
        data-testid="numbering-preview"
      >
        <div className="grid items-center gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <PatternNumber parts={previewNumber!.parts} separator={project.separator} size="lg" />
            <ul aria-label={t("legend")} className="mt-3 flex flex-wrap gap-x-[14px] gap-y-1.5 text-caption text-muted">
              {[...legendKinds, "sequence" as const].map((kind) => (
                <li key={kind} className="inline-flex items-center gap-1.5">
                  <i aria-hidden="true" className={cn("size-2 rounded-[3px]", toneClasses[kind].solid)} />
                  {t(`kinds.${kind}`)}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-caption text-muted">
              {t("length")}:{" "}
              <b className={cn("tabular-nums", previewNumber!.text.length > comfortableLength ? "text-warning-fg" : "text-text")}>
                {previewNumber!.text.length}
              </b>{" "}
              / {comfortableLength}
            </p>
          </div>
          {counters && sampleNumbers.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2 rounded-md bg-surface-subtle px-[14px] py-3 shadow-[inset_0_0_0_1px_var(--border-subtle)]" data-testid="next-numbers">
              <h3 className="text-[10.5px] font-bold text-muted uppercase ltr:tracking-[0.06em]">{t("nextNumbers")}</h3>
              <ul className="flex flex-col gap-2">
                {sampleNumbers.map((n, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-text-secondary">
                    <span className="min-w-0 truncate">{samples[i]!.label}</span>
                    <bdi
                      dir="ltr"
                      translate="no"
                      className="ms-auto rounded-[6px] bg-surface px-[7px] py-[3px] font-semibold whitespace-nowrap text-text tabular-nums shadow-[inset_0_0_0_1px_var(--border)]"
                    >
                      {n.text}
                    </bdi>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* The Project pattern */}
      <SettingsSection
        title={t("patternTitle")}
        description={isRabaedDefault && samePattern(project, saved.project) ? t("rabaedDefault") : canEdit ? t("patternHint") : t("patternHintReadOnly")}
        actions={<span className="text-caption font-semibold text-muted tabular-nums">{t("segmentCount", { n: project.segments.length, max: maxSegments })}</span>}
        data-testid="numbering-project-pattern"
      >
        <div>
          <SegmentChips t={t} pattern={project} example={withType(preview, firstCode)} onChange={editProject} />
          {editProject && <AddSegments t={t} pattern={project} example={withType(preview, firstCode)} onChange={editProject} />}
          <PatternWarnings t={t} pattern={project} length={previewNumber!.text.length} onChange={editProject} />
        </div>
      </SettingsSection>

      {/* The sequence */}
      <SettingsSection title={t("sequenceTitle")}>
        <SequenceOptions
          t={t}
          pattern={project}
          onChange={editProject}
          tradeCodes={tradeCodes}
          examples={sampleNumbers.map((n, i) => ({ label: samples[i]!.label, next: n.parts.at(-1)!.text }))}
        />
      </SettingsSection>

      {/* Per Work Item Type */}
      <SettingsSection title={t("typesTitle")} description={t("typesIntro")} bodyClassName="px-0 pt-[14px] pb-0" data-testid="numbering-types">
        <div role="region" aria-label={t("typesTitle")} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-surface-subtle">
                <th scope="col" className="border-b border-border-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted">
                  {t("colType")}
                </th>
                <th scope="col" className="border-b border-border-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted">
                  {t("colPattern")}
                </th>
                <th scope="col" className="border-b border-border-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted">
                  {counters ? t("colNext") : t("colExample")}
                </th>
                {canEdit && (
                  <th scope="col" className="border-b border-border-subtle px-5 py-2.5">
                    <span className="sr-only">{t("colChange")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {types.map((type) => {
                const custom = customs[type.id] ?? null;
                const [n] = numberFor(custom ?? project, [preview], type.code);
                return (
                  <tr key={type.id} className="border-b border-border-subtle last:border-b-0" data-testid="numbering-type-row">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-2.5">
                        <TypeCode code={type.code} />
                        <b className="font-semibold text-text">{type.name}</b>
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {custom ? (
                        <Badge tone="brand" className="h-[22px] gap-[5px] rounded-[6px] px-2 text-[11.5px]">
                          <Icon name="edit" size={13} />
                          {t("custom")}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" className="h-[22px] rounded-[6px] px-2 text-[11.5px]">
                          {t("usesProject")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <bdi dir="ltr" translate="no" className="text-[12.5px] font-semibold text-text tabular-nums">
                        {n!.text}
                      </bdi>
                    </td>
                    {canEdit && (
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="flex justify-end gap-1.5">
                          {custom ? (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => setDrawer({ type, pattern: custom })}>
                                <Icon name="edit" />
                                {t("edit")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setCustoms({ ...customs, [type.id]: null })}>
                                {t("useProject")}
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => setDrawer({ type, pattern: project })}>
                              {t("customize")}
                            </Button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      {/* Revision suffix */}
      <SettingsSection
        title={t("revisionTitle")}
        description={t("revisionIntro")}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-neutral-tint px-2.5 py-[5px] text-[12.5px] font-semibold text-neutral-fg">
            <Icon name="lock" size={14} />
            {t("fixed")}
          </span>
        }
      >
        <p className="flex flex-wrap items-center gap-[14px]">
          {[0, 1, 2].map((rev) => (
            <span key={rev} className="inline-flex items-center gap-[14px]">
              {rev > 0 && <Icon name="arrow-right" size={16} className="text-faint" />}
              <bdi dir="ltr" translate="no" className="text-[15px] font-bold text-text tabular-nums">
                {previewNumber!.text}
                {rev > 0 && <em className="text-brand-fg not-italic"> Rev {rev}</em>}
              </bdi>
            </span>
          ))}
        </p>
      </SettingsSection>

      {dirty && (
        <div
          role="region"
          aria-label={t("unsaved")}
          className="fixed end-7 bottom-[18px] z-40 flex items-center gap-3 rounded-md bg-inverse py-2.5 ps-4 pe-3 text-[13.5px] font-semibold whitespace-nowrap text-on-inverse shadow-lg"
          data-testid="unsaved-bar"
        >
          <Icon name="alert-circle" size={17} />
          {t("unsaved")}
          <Button size="sm" variant="ghost" className="text-on-inverse hover:bg-on-inverse/15 active:bg-on-inverse/25" onClick={discard}>
            {t("discard")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setAccepted(false);
              setError(null);
              setReviewing(true);
            }}
          >
            {t("reviewSave")}
          </Button>
        </div>
      )}

      {done && (
        <div
          role="status"
          className="fixed end-7 bottom-[18px] z-40 flex items-center gap-2 rounded-md bg-inverse px-4 py-2.5 text-[13.5px] font-semibold text-on-inverse shadow-lg"
        >
          <Icon name="circle-check" size={17} />
          {t("saved")}
        </div>
      )}

      <SaveModal
        t={t}
        open={reviewing}
        onOpenChange={setReviewing}
        changes={changes}
        saved={saved}
        types={types}
        preview={preview}
        numberFor={numberFor}
        needsAcceptance={needsAcceptance}
        accepted={accepted}
        onAccept={setAccepted}
        pending={pending}
        error={error}
        onConfirm={confirm}
      />

      {drawer && (
        <CustomPatternDrawer
          t={t}
          type={drawer.type}
          pattern={drawer.pattern}
          projectPattern={project}
          onChange={(pattern) => setDrawer({ ...drawer, pattern })}
          onClose={() => setDrawer(null)}
          onApply={() => {
            setCustoms({ ...customs, [drawer.type.id]: drawer.pattern });
            setDrawer(null);
          }}
          preview={preview}
          samples={samples}
          tradeCodes={tradeCodes}
          numberFor={numberFor}
        />
      )}
    </>
  );
}

type NumberFor = (pattern: NumberingPattern, contexts: readonly NumberingContext[], typeCode: string) => ReturnType<typeof patternNumber>[];

/** The save confirmation: before → after of each pattern that changes, the guarantees, and the shared-counter acceptance where it applies. */
function SaveModal({
  t,
  open,
  onOpenChange,
  changes,
  saved,
  types,
  preview,
  numberFor,
  needsAcceptance,
  accepted,
  onAccept,
  pending,
  error,
  onConfirm,
}: {
  t: NumberingText;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: PatternChange[];
  saved: { project: NumberingPattern; customs: Record<string, NumberingPattern | null> };
  types: readonly NumberingTypeRow[];
  preview: NumberingContext;
  numberFor: NumberFor;
  needsAcceptance: boolean;
  accepted: boolean;
  onAccept: (accepted: boolean) => void;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const acceptId = useId();
  const firstCode = types[0]?.code ?? "MAR";
  const typeChanges = changes.filter((c) => c.workItemTypeId !== null);
  const project = changes.find((c) => c.workItemTypeId === null);
  // The Project pattern's before and after (unchanged when only Types change), as in the kit.
  const after = project?.pattern ?? saved.project;
  const [beforeNumber] = numberFor(saved.project, [preview], firstCode);
  const [afterNumber] = numberFor(after, [preview], firstCode);
  return (
    <NumberingModal
      open={open}
      onOpenChange={onOpenChange}
      title={t("modalTitle")}
      description={rich(t, "modalIntro", { strong: <b className="font-semibold text-text">{t("modalIntroStrong")}</b> })}
      testId="numbering-save-modal"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={pending || (needsAcceptance && !accepted)} onClick={onConfirm}>
            <Icon name="check" />
            {pending ? t("saving") : t("saveNew")}
          </Button>
        </>
      }
    >
      <BeforeAfter t={t} label={project ? undefined : t("projectScope")} before={beforeNumber!.text} after={afterNumber!.text} />
      {typeChanges.map((change) => {
        const type = types.find((x) => x.id === change.workItemTypeId)!;
        const [b] = numberFor(saved.customs[type.id] ?? saved.project, [preview], type.code);
        const [a] = numberFor(change.pattern ?? after, [preview], type.code);
        return <BeforeAfter key={type.id} t={t} label={type.code} before={b!.text} after={a!.text} />;
      })}
      <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
        {[t("keepsRegister"), t("keepsRevisions"), ...(typeChanges.length > 0 ? [t("typesSaved", { types: typeChanges.map((c) => types.find((x) => x.id === c.workItemTypeId)!.code).join(", ") })] : [])].map(
          (line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="circle-check" size={16} className="mt-px shrink-0 text-success" />
              {line}
            </li>
          ),
        )}
      </ul>
      {needsAcceptance && (
        <div className="flex flex-col gap-2 rounded-[10px] bg-warning-tint px-3 py-2.5 text-sm text-warning-fg" data-testid="shared-counter-acceptance">
          <p className="flex items-start gap-2.5">
            <Icon name="alert-triangle" size={17} className="mt-px shrink-0" />
            <span>
              <b>{t("sharedTitle")}.</b> {t("sharedBody")}
            </span>
          </p>
          <Field label={t("sharedAccept")} layout="inline" id={acceptId} className="text-text">
            <Checkbox checked={accepted} onCheckedChange={(c) => onAccept(c === true)} />
          </Field>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </NumberingModal>
  );
}

function BeforeAfter({ t, label, before, after }: { t: NumberingText; label?: string; before: string; after: string }) {
  return (
    <div className="grid grid-cols-[70px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md bg-surface-subtle p-[14px] shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      {label !== undefined && (
        <bdi dir="auto" className="col-span-2 text-caption font-semibold text-muted">
          {label}
        </bdi>
      )}
      <small className="text-[11.5px] font-bold text-muted uppercase ltr:tracking-[0.04em]">{t("before")}</small>
      <bdi dir="ltr" translate="no" className="text-start text-lg font-bold break-all text-muted tabular-nums">
        {before}
      </bdi>
      <Icon name="arrow-down" size={14} className="col-start-2 text-faint" />
      <small className="text-[11.5px] font-bold text-muted uppercase ltr:tracking-[0.04em]">{t("after")}</small>
      <bdi dir="ltr" translate="no" className="text-start text-lg font-bold break-all text-text tabular-nums" data-testid="after-number">
        {after}
      </bdi>
    </div>
  );
}

/** The drawer of a Type's Custom pattern: preview, segments and sequence, applied to the page's edits. */
function CustomPatternDrawer({
  t,
  type,
  pattern,
  projectPattern,
  onChange,
  onClose,
  onApply,
  preview,
  samples,
  tradeCodes,
  numberFor,
}: {
  t: NumberingText;
  type: NumberingTypeRow;
  pattern: NumberingPattern;
  projectPattern: NumberingPattern;
  onChange: (pattern: NumberingPattern) => void;
  onClose: () => void;
  onApply: () => void;
  preview: NumberingContext;
  samples: readonly NumberingContext[];
  tradeCodes: readonly string[];
  numberFor: NumberFor;
}) {
  const [n] = numberFor(pattern, [preview], type.code);
  const examples = numberFor(pattern, samples, type.code);
  const example = withType(preview, type.code);
  return (
    <NumberingDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      code={type.code}
      title={t("drawerTitle", { type: type.name })}
      description={t("drawerIntro")}
      closeLabel={t("close")}
      testId="custom-pattern-drawer"
      footer={
        <>
          <Button variant="ghost" onClick={() => onChange(projectPattern)}>
            {t("startFromProject")}
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={onApply}>
            <Icon name="check" />
            {t("apply")}
          </Button>
        </>
      }
    >
      <DrawerCard>
        <PatternNumber parts={n!.parts} separator={pattern.separator} size="lg" />
      </DrawerCard>
      <DrawerCard title={t("segmentsTitle")}>
        <SegmentChips t={t} pattern={pattern} example={example} onChange={onChange} />
        <AddSegments t={t} pattern={pattern} example={example} onChange={onChange} />
        <PatternWarnings t={t} pattern={pattern} length={n!.text.length} onChange={onChange} />
      </DrawerCard>
      <DrawerCard>
        <SequenceOptions
          t={t}
          pattern={pattern}
          onChange={onChange}
          tradeCodes={tradeCodes}
          examples={examples.map((e, i) => ({ label: samples[i]!.label, next: e.parts.at(-1)!.text }))}
        />
      </DrawerCard>
    </NumberingDrawer>
  );
}

function DrawerCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface">
      {title && <h3 className="px-5 pt-4 text-[15.5px] font-bold text-text">{title}</h3>}
      <div className="px-5 pt-4 pb-5">{children}</div>
    </section>
  );
}
