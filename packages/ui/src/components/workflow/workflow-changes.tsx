"use client";

import { definitionChanges, formatNumber, type Locale, type WorkflowDefinition } from "@rabaed/domain";
import { useMemo } from "react";
import { Dialog, DialogContent } from "../overlay/dialog.tsx";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowCompareLabels } from "./workflow-builder-labels.ts";
import { WorkflowCanvas, type CanvasMark } from "./workflow-canvas.tsx";
import type { MapStage } from "./workflow-map.ts";

type ChangeWords = { added: string; removed: string; changed: string; noChanges: string };

/** What changed between two definitions, line by line: added, removed, changed (the publish and compare dialogs). */
export function WorkflowChangeList({ before, after, locale, labels }: { before: WorkflowDefinition; after: WorkflowDefinition; locale: Locale; labels: ChangeWords }) {
  const changes = definitionChanges(before, after);
  if (changes.length === 0) return <p className="text-sm text-muted">{labels.noChanges}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {changes.map((c) => (
        <li key={`${c.change}:${c.kind}:${c.key}`} className="flex items-start gap-2 text-sm">
          <Icon
            name={c.change === "added" ? "plus" : c.change === "removed" ? "minus" : "edit"}
            size={15}
            className="mt-0.5 shrink-0"
            style={{ color: c.change === "added" ? "var(--success)" : c.change === "removed" ? "var(--danger)" : "var(--stage-resubmitted-dot)" }}
          />
          <span>
            {labels[c.change]} {c.name[locale]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Marks for a comparison: on the earlier Version what was removed or changed, on the later what was added or changed. */
export function compareMarks(before: WorkflowDefinition, after: WorkflowDefinition): { before: Record<string, CanvasMark>; after: Record<string, CanvasMark> } {
  const marks = { before: {} as Record<string, CanvasMark>, after: {} as Record<string, CanvasMark> };
  for (const c of definitionChanges(before, after)) {
    if (c.change !== "added") marks.before[c.key] = c.change;
    if (c.change !== "removed") marks.after[c.key] = c.change;
  }
  return marks;
}

export type WorkflowCompareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  before: { versionNo: number; definition: WorkflowDefinition };
  after: { versionNo: number; definition: WorkflowDefinition };
  stages: readonly MapStage[];
  locale: Locale;
  labels: WorkflowCompareLabels;
};

/**
 * Two Versions of a Workflow side by side (design: settings-workflows.html's
 * Compare): what was added (green), removed (red) and changed (orange), on both
 * maps and as a list.
 */
export function WorkflowCompareDialog({ open, onOpenChange, before, after, stages, locale, labels }: WorkflowCompareDialogProps) {
  const marks = useMemo(() => compareMarks(before.definition, after.definition), [before.definition, after.definition]);
  const v = (n: number) => formatNumber(n, locale);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={labels.title(v(before.versionNo), v(after.versionNo))}
        description={
          <span className="flex flex-wrap gap-3 text-caption">
            <span className="text-success-fg">■ {labels.legendAdded}</span>
            <span className="text-danger-fg">■ {labels.legendRemoved}</span>
            <span className="text-stage-resubmitted-fg">■ {labels.legendChanged}</span>
          </span>
        }
        closeLabel={labels.close}
        className="w-[min(1180px,calc(100%-2rem))]"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { side: before, mark: marks.before },
            { side: after, mark: marks.after },
          ].map(({ side, mark }) => (
            <section key={side.versionNo} aria-label={labels.version(v(side.versionNo))} className="flex flex-col gap-1.5">
              <b className="text-sm">{labels.version(v(side.versionNo))}</b>
              <div className="h-[420px]">
                <WorkflowCanvas definition={side.definition} stages={stages} locale={locale} labels={labels.map} marks={mark} className="h-full" />
              </div>
            </section>
          ))}
        </div>
        <WorkflowChangeList before={before.definition} after={after.definition} locale={locale} labels={labels} />
      </DialogContent>
    </Dialog>
  );
}
