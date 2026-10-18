"use client";

import {
  formatNumber,
  type Locale,
  type SnagBulkCandidates,
  type SnagBulkResult,
  type SnagBulkSkipReason,
  type WorkItemList as WorkItemListData,
} from "@rabaed/domain";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { RadioGroup } from "../form/radio-group.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StageDot } from "../status/stage-pill.tsx";

// The Snag List's bulk bar and its two dialogs (RP-629, spec RP-619; design/reference/claude-design/ui_kits/app/snag-list.html,
// "Bulk select"): with rows chosen, "Reassign" (within the viewer's own Company), "Move Stage" and "Export". Both dialogs
// act item by item through the API and then say which items were done and which were skipped, and why. They name only
// items the viewer sees (V3). No due date or deadline anywhere: Step Age only.

/** The bulk bar's and the dialogs' words, from the app's messages. */
export type SnagBulkLabels = {
  /** The bar's count: `n` is `count` written for the locale. */
  selected: (n: string, count: number) => string;
  clearSelection: string;
  /** The header checkbox's name, e.g. "Select all on this page". */
  selectAll: string;
  /** A row's checkbox, e.g. "Select Cable tray not bonded". */
  selectRow: (subject: string) => string;
  reassign: string;
  moveStage: string;
  /** The bar's Excel button for the chosen rows. */
  exportSelected: string;
  /** The toolbar's Excel button for every row the filters match. */
  exportAll: string;
  /** "Exported 42 snags (Excel)": `n` is `count` written for the locale. */
  exported: (n: string, count: number) => string;
  /** The toast text when the export stopped at its cap. */
  exportedCapped: (n: string, count: number) => string;
  exportFailed: string;
  close: string;
  cancel: string;
  working: string;
  reassignTitle: string;
  reassignDescription: (n: string, count: number) => string;
  reassignTo: string;
  /** A colleague, with how many of the chosen items they could take: "Ali Sonour (2 of 3)". */
  colleague: (name: string, n: string, of: string) => string;
  /** The chosen items none of the viewer's Company holds, or that the viewer may not reassign. */
  nothingToReassign: string;
  reassignConfirm: string;
  moveTitle: string;
  moveDescription: (n: string, count: number) => string;
  moveTo: string;
  /** A line under the Stages: each move is signed and recorded as if taken one by one. */
  moveHint: string;
  moveConfirm: string;
  /** The result's first line: "3 items reassigned" / "3 items moved". */
  doneCount: (n: string, count: number) => string;
  /** The result's second line: "2 items skipped". */
  skippedCount: (n: string, count: number) => string;
  /** The reason an item was skipped, by code. */
  reasons: Record<SnagBulkSkipReason, string>;
  /** Skipped items the viewer no longer sees, counted without a name: "1 item you can no longer see". */
  unseen: (n: string, count: number) => string;
  failed: string;
};

/** What the bulk bar calls: the web wires each to the API. */
export type SnagBulkActions = {
  labels: SnagBulkLabels;
  /** The Members of the viewer's own Company who could take the chosen items. Null when it couldn't be read. */
  candidates: (ids: string[]) => Promise<SnagBulkCandidates | null>;
  reassign: (ids: string[], toMemberId: string) => Promise<SnagBulkResult | null>;
  move: (ids: string[], stage: string) => Promise<SnagBulkResult | null>;
  /** After anything changed: the page reads again. */
  onChanged: () => void;
};

type Stage = WorkItemListData["stages"][number];

/** What a dialog is doing: choosing, working, or showing what happened. */
type Phase = { kind: "choose" } | { kind: "working" } | { kind: "done"; result: SnagBulkResult } | { kind: "failed" };

/** The bar over the table: how many rows are chosen, and what can be done with them. */
export function SnagBulkBar({
  ids,
  stages,
  locale,
  actions,
  exporting,
  onExport,
  onClear,
}: {
  ids: string[];
  stages: readonly Stage[];
  locale: Locale;
  actions: SnagBulkActions;
  exporting: boolean;
  onExport: () => void;
  onClear: () => void;
}) {
  const { labels } = actions;
  const [dialog, setDialog] = useState<"reassign" | "move" | null>(null);
  const n = (value: number) => formatNumber(value, locale);
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border-subtle bg-brand-tint px-[14px] py-2 text-[13px] font-semibold text-brand-fg">
      <span role="status">{labels.selected(n(ids.length), ids.length)}</span>
      <span className="flex-1" />
      <Button variant="secondary" size="sm" onClick={() => setDialog("reassign")}>
        <Icon name="hand-move" />
        {labels.reassign}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setDialog("move")}>
        <Icon name="arrow-forward-up" />
        {labels.moveStage}
      </Button>
      <Button variant="secondary" size="sm" disabled={exporting} onClick={onExport}>
        <Icon name="file-download" />
        {labels.exportSelected}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {labels.clearSelection}
      </Button>
      {dialog === "reassign" && <ReassignDialog ids={ids} locale={locale} actions={actions} onClose={() => setDialog(null)} />}
      {dialog === "move" && <MoveDialog ids={ids} stages={stages} locale={locale} actions={actions} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The outcome of a bulk action: how many were done, then the items that were not, each with its reason. */
function Outcome({ result, locale, labels }: { result: SnagBulkResult; locale: Locale; labels: SnagBulkLabels }) {
  const n = (value: number) => formatNumber(value, locale);
  const named = result.skipped.filter((s) => s.reason !== "not_found");
  const unseen = result.skipped.length - named.length;
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="flex items-center gap-2 font-semibold text-text">
        <Icon name="circle-check" className="text-success-fg" />
        {labels.doneCount(n(result.done.length), result.done.length)}
      </p>
      {result.skipped.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-semibold text-text">
            <Icon name="alert-triangle" className="text-warning-fg" />
            {labels.skippedCount(n(result.skipped.length), result.skipped.length)}
          </p>
          <ul tabIndex={0} aria-label={labels.skippedCount(n(result.skipped.length), result.skipped.length)} className={cn("flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-sm border border-border-subtle p-2 text-[13px]", focusRing)}>
            {named.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                {s.documentNumber && (
                  <bdi dir="ltr" className="font-ui text-[12.5px] font-semibold text-muted">
                    {s.documentNumber}
                  </bdi>
                )}
                <span dir="auto" className="font-semibold text-text">
                  {s.title}
                </span>
                <span className="text-muted">{labels.reasons[s.reason]}</span>
              </li>
            ))}
            {unseen > 0 && <li className="text-muted">{labels.unseen(n(unseen), unseen)}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Runs one bulk action and keeps its phase; the page reads again once it changed anything. */
function useBulkRun(actions: SnagBulkActions) {
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const run = async (call: () => Promise<SnagBulkResult | null>) => {
    setPhase({ kind: "working" });
    try {
      const result = await call();
      if (result === null) {
        setPhase({ kind: "failed" });
        return;
      }
      setPhase({ kind: "done", result });
      if (result.done.length > 0) actions.onChanged();
    } catch {
      setPhase({ kind: "failed" });
    }
  };
  return { phase, run };
}

function BulkDialog({
  title,
  description,
  labels,
  phase,
  onClose,
  confirm,
  canConfirm,
  children,
  outcome,
}: {
  title: string;
  description: string;
  labels: SnagBulkLabels;
  phase: Phase;
  onClose: () => void;
  confirm: { label: string; run: () => void };
  canConfirm: boolean;
  children: ReactNode;
  outcome: ReactNode;
}) {
  const finished = phase.kind === "done";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description} closeLabel={labels.close}>
        {phase.kind === "done" ? outcome : phase.kind === "failed" ? <p role="alert">{labels.failed}</p> : children}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={phase.kind === "working"}>
            {finished || phase.kind === "failed" ? labels.close : labels.cancel}
          </Button>
          {!finished && phase.kind !== "failed" && (
            <Button onClick={confirm.run} disabled={!canConfirm || phase.kind === "working"}>
              {phase.kind === "working" ? labels.working : confirm.label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reassign: one Member of the viewer's own Company, from the Step Pools of the chosen items they hold. */
function ReassignDialog({ ids, locale, actions, onClose }: { ids: string[]; locale: Locale; actions: SnagBulkActions; onClose: () => void }) {
  const { labels } = actions;
  const n = (value: number) => formatNumber(value, locale);
  const [offered, setOffered] = useState<SnagBulkCandidates | null | "loading">("loading");
  const [member, setMember] = useState("");
  const { phase, run } = useBulkRun(actions);
  const key = ids.join(",");
  useEffect(() => {
    let current = true;
    void actions.candidates(ids).then(
      (got) => current && setOffered(got),
      () => current && setOffered(null),
    );
    return () => {
      current = false;
    };
    // The chosen items are the dialog's whole input: it asks again only for another choice.
  }, [key]);
  const id = useId();
  const choose =
    offered === "loading" ? (
      <p className="text-muted">{labels.working}</p>
    ) : offered === null ? (
      <p role="alert">{labels.failed}</p>
    ) : offered.members.length === 0 ? (
      <p>{labels.nothingToReassign}</p>
    ) : (
      <Field label={labels.reassignTo} group id={`${id}-member`}>
        <RadioGroup
          value={member}
          onValueChange={setMember}
          className={cn("max-h-64 overflow-y-auto")}
          options={[...offered.members]
            .sort((a, b) => a.name[locale].localeCompare(b.name[locale], locale))
            .map((m) => ({ value: m.memberId, label: labels.colleague(m.name[locale], n(m.items), n(offered.reassignable)) }))}
        />
      </Field>
    );
  return (
    <BulkDialog
      title={labels.reassignTitle}
      description={labels.reassignDescription(n(ids.length), ids.length)}
      labels={labels}
      phase={phase}
      onClose={onClose}
      confirm={{ label: labels.reassignConfirm, run: () => void run(() => actions.reassign(ids, member)) }}
      canConfirm={member !== ""}
      outcome={phase.kind === "done" && <Outcome result={phase.result} locale={locale} labels={labels} />}
    >
      {choose}
    </BulkDialog>
  );
}

/** Move Stage: the Stage to move the chosen items to; each goes by the Transition it is offered, if any. */
function MoveDialog({ ids, stages, locale, actions, onClose }: { ids: string[]; stages: readonly Stage[]; locale: Locale; actions: SnagBulkActions; onClose: () => void }) {
  const { labels } = actions;
  const n = (value: number) => formatNumber(value, locale);
  const [stage, setStage] = useState("");
  const { phase, run } = useBulkRun(actions);
  const id = useId();
  return (
    <BulkDialog
      title={labels.moveTitle}
      description={labels.moveDescription(n(ids.length), ids.length)}
      labels={labels}
      phase={phase}
      onClose={onClose}
      confirm={{ label: labels.moveConfirm, run: () => void run(() => actions.move(ids, stage)) }}
      canConfirm={stage !== ""}
      outcome={phase.kind === "done" && <Outcome result={phase.result} locale={locale} labels={labels} />}
    >
      <Field label={labels.moveTo} group id={`${id}-stage`}>
        <RadioGroup
          value={stage}
          onValueChange={setStage}
          options={stages
            .filter((s) => s.category !== "draft")
            .map((s) => ({
              value: s.key,
              label: (
                <span className="inline-flex items-center gap-2">
                  <StageDot stage={stageColour(s)} />
                  {s.name[locale]}
                </span>
              ),
            }))}
        />
      </Field>
      <p className="text-caption text-muted">{labels.moveHint}</p>
    </BulkDialog>
  );
}
