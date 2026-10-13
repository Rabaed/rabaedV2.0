import type { Locale, TransitionKind, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import type { CSSProperties } from "react";
import type { StageKey } from "../../tokens/themes.ts";
import type { IconName } from "../icon/icon.tsx";
import type { WorkflowLabels } from "./workflow-labels.ts";
import type { MapEdge, MapNode } from "./workflow-map.ts";

// What the canvas and the Step list say and draw the same way.

/** A Stage colour's CSS variables, for inline styles (full names, read at run time). */
export const stageVars = (colour: StageKey) => ({
  dot: `var(--stage-${colour}-dot)`,
  bg: `var(--stage-${colour}-bg)`,
  fg: `var(--stage-${colour}-fg)`,
});

/** "Contractor · Review · Engineer": the Step's role, Function Permission and Positions. */
export function stepMeta(step: WorkflowStep, labels: WorkflowLabels): string {
  if (!step.actor) return "";
  const { role } = step.actor;
  const positions = (step.actor.positions ?? []).map((p) => labels.position(p, role));
  return [labels.role(step.actor.role), labels.permission(step.actor.permission), ...positions].join(" · ");
}

/**
 * A Step's icon, as the reference builder gives each Step its own (RP-555), derived from
 * who holds it and what it does, since the format stores none: an owner's Step a
 * building, a deciding one a gavel, one recommending a code a reviewer searching, a
 * review a checked person, the raiser's (create) a person.
 */
export function stepIcon(step: WorkflowStep): IconName {
  // Tabler's icon names, not Rabaed terms: a person holds the Step.
  /* eslint-disable rabaed/no-avoid-terms */
  const actor = step.actor;
  if (!actor) return "user";
  if (actor.role === "owner" || actor.role === "owner_representative") return "building";
  if (step.outcomeMode === "issue_outcome" || actor.permission === "approve" || actor.permission === "close") return "gavel";
  if (step.outcomeMode === "recommend_code") return "user-search";
  if (actor.permission === "create" || actor.permission === "submit") return "user";
  return "user-check";
  /* eslint-enable rabaed/no-avoid-terms */
}

/** Whether a Transition has Restrict rules: it is offered only when they hold (the canvas's filter icon, RP-555). */
export const isConditional = (transition: Pick<WorkflowTransition, "rules">): boolean => (transition.rules?.restrict?.length ?? 0) > 0;

export const endIcon = (colour: StageKey): IconName =>
  colour === "rejected" ? "x" : colour === "resubmitted" ? "refresh" : colour === "cancelled" ? "ban" : "check";

export const kindIcon = (kind: TransitionKind): IconName =>
  kind === "submit" ? "send" : kind === "return" || kind === "send_back" ? "arrow-back-up" : kind === "close" ? "circle-check" : kind === "cancel" ? "ban" : "arrow-right";

/**
 * An edge's colour and dash, by its Transition's kind (and the outcome it closes into), and its
 * selected label's fill: the same hue darkened only as far as white text needs for 4.5:1 (RP-555
 * review), so a Return stays orange and a Code A green. The dots are one shade in every theme.
 */
export function edgeLook(edge: Pick<MapEdge, "transition" | "targetColour">): { colour: string; dashed: boolean; fill: string } {
  const shade = (colour: string, percent: number) => (percent === 0 ? colour : `color-mix(in srgb, ${colour}, black ${percent}%)`);
  // The least black mix reaching 4.5:1 with white, per tone (green 28%, amber 34%, red 9%; slate-600 and the primary pass as they are).
  const closeShade: Partial<Record<StageKey, number>> = { approved: 28, resubmitted: 34, rejected: 9, draft: 27 };
  switch (edge.transition.kind) {
    case "submit":
      return { colour: "var(--primary)", dashed: false, fill: "var(--primary)" };
    case "return":
    case "send_back":
      return { colour: "var(--stage-resubmitted-dot)", dashed: true, fill: shade("var(--stage-resubmitted-dot)", 34) };
    case "close": {
      const target = edge.targetColour ?? "approved";
      return { colour: stageVars(target).dot, dashed: false, fill: shade(stageVars(target).dot, closeShade[target] ?? 30) };
    }
    case "cancel":
      return { colour: "var(--stage-cancelled-dot)", dashed: false, fill: "var(--stage-cancelled-dot)" };
    default:
      // A Send's arrow is the text colour, light in dark themes: its fill is the neutral slate that reads white text in both.
      return { colour: "var(--text-secondary)", dashed: false, fill: "var(--stage-cancelled-dot)" };
  }
}

/** A folded part's title: "With <Company>" where the item is, else the role's part. */
export function groupTitle(node: Extract<MapNode, { kind: "group" }>, labels: WorkflowLabels, locale: Locale): string {
  return node.current && node.companyName ? labels.withCompany(node.companyName[locale]) : labels.part(labels.role(node.role));
}

/**
 * The builder's dialogs in the reference's look (RP-555; the reference's `.wmdl`): a header
 * row under a rule, 16px bold title, the body padded 16px by 20px, and the footer on the
 * subtle surface (`referenceModalBody`, `referenceModalFooter`). Radius 16px (`rounded-lg`:
 * the kit's scale has no `2xl`, which drew square corners).
 */
export const referenceModal =
  "gap-0 rounded-lg p-0 *:first:items-center *:first:border-b *:first:border-border-subtle *:first:px-5 *:first:py-4 [&_h2]:text-lg [&_h2]:leading-snug";
export const referenceModalBody = "flex flex-col gap-3 px-5 py-4";
export const referenceModalFooter = "mt-0 border-t border-border-subtle bg-surface-subtle px-5 py-3";

/** A message's straight quotes as the language writes them: “ ” in English, « » in Arabic (RP-555 review). */
export const typographic = (text: string, locale: Locale): string => text.replace(/"([^"]*)"/g, locale === "ar" ? "«$1»" : "“$1”");

export const hatched: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--border) 45%, transparent) 6px 7px)",
};
