import { directionOf, type BaseRole, type Locale, type WorkItemMapPosition, type WorkflowDefinition } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowLabels } from "./workflow-labels.ts";
import { workflowMap, type MapNode, type MapStage } from "./workflow-map.ts";
import { edgeLook, endIcon, groupTitle, kindIcon, stageVars, stepMeta } from "./workflow-parts.tsx";

export type WorkflowStepListProps = {
  definition: WorkflowDefinition;
  stages: readonly MapStage[];
  locale: Locale;
  labels: WorkflowLabels;
  /** As on `WorkflowCanvas`: an item's map folds every other role's Steps (V14). */
  viewerRole?: BaseRole | null;
  position?: WorkItemMapPosition | null;
  className?: string;
};

/**
 * The Workflow canvas as a list (RP-438): its Stages in order, each Step with
 * what it does and the Transitions leaving it, and the outcomes. The same map as
 * the canvas, so it folds and marks exactly what the canvas does; plain text,
 * read in order by keyboard and screen-reader users, and on a phone.
 */
export function WorkflowStepList({ definition, stages, locale, labels, viewerRole, position, className }: WorkflowStepListProps) {
  const map = workflowMap({ definition, stages, dir: directionOf(locale), viewerRole, position });
  const bandIndex = (n: MapNode) => map.bands.findIndex((b) => n.x + n.width / 2 >= b.x && n.x + n.width / 2 <= b.x + b.width);
  const ordered = map.nodes.toSorted((a, b) => bandIndex(a) - bandIndex(b) || a.y - b.y);
  const names = new Map(map.nodes.map((n) => [n.id, n.kind === "group" ? groupTitle(n, labels, locale) : n.step.name[locale]]));
  const stageName = new Map(stages.map((s) => [s.key, s.name[locale]]));

  return (
    <ol aria-label={labels.list} className={cn("flex flex-col gap-2", className)}>
      {ordered.map((node) => {
        const out = map.edges.filter((e) => e.source === node.id);
        const colour = stageVars(node.colour);
        return (
          <li
            key={node.id}
            aria-current={node.current ? "step" : undefined}
            className={cn("rounded-xl border bg-surface p-3", node.current ? "border-2 border-primary" : "border-border")}
            style={node.kind === "step" ? { borderTop: `3px solid ${colour.dot}` } : undefined}
          >
            <div className="flex items-start gap-2.5">
              <span
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
                style={node.kind === "end" ? { background: colour.bg, color: colour.fg } : { background: "var(--surface-subtle)", color: "var(--text-secondary)" }}
              >
                {/* eslint-disable-next-line rabaed/no-avoid-terms -- the Tabler icon's name: a person holds the Step. */}
                <Icon name={node.kind === "group" ? "lock" : node.kind === "end" ? endIcon(node.colour) : "user"} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text">{names.get(node.id)}</span>
                  {node.current && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-on-primary">{labels.current}</span>}
                </div>
                <div className="text-caption text-muted">
                  {node.kind === "group"
                    ? node.stepStages.map((k) => stageName.get(k) ?? k).join(" · ")
                    : node.kind === "step"
                      ? [stageName.get(node.step.stage) ?? node.step.stage, stepMeta(node.step, labels)].join(" · ")
                      : labels.outcome}
                </div>
                {node.kind === "step" && node.step.outcomeMode !== "none" && (
                  <span className="mt-1 inline-flex rounded-md bg-stage-pending-bg px-1.5 py-0.5 text-[11px] font-semibold text-stage-pending-fg">
                    {labels.outcomeMode(node.step.outcomeMode)}
                  </span>
                )}
                {out.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {out.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-1.5 text-caption text-text-secondary">
                        <Icon name={kindIcon(e.transition.kind)} size={13} style={{ color: edgeLook(e).colour }} />
                        <span className="font-semibold text-text">{e.transition.label[locale]}</span>
                        <span className="text-muted">({labels.kind(e.transition.kind)})</span>
                        <span>
                          {labels.to} {names.get(e.target)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
