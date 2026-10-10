import type { Locale, TransitionKind, WorkflowStep } from "@rabaed/domain";
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
  const positions = (step.actor.positions ?? []).map((p) => labels.position?.(p) ?? p);
  return [labels.role(step.actor.role), labels.permission(step.actor.permission), ...positions].join(" · ");
}

export const endIcon = (colour: StageKey): IconName =>
  colour === "rejected" ? "x" : colour === "resubmitted" ? "refresh" : colour === "cancelled" ? "ban" : "check";

export const kindIcon = (kind: TransitionKind): IconName =>
  kind === "submit" ? "send" : kind === "return" || kind === "send_back" ? "arrow-back-up" : kind === "close" ? "circle-check" : kind === "cancel" ? "ban" : "arrow-right";

/** An edge's colour and dash, by its Transition's kind (and the outcome it closes into). */
export function edgeLook(edge: Pick<MapEdge, "transition" | "targetColour">): { colour: string; dashed: boolean } {
  switch (edge.transition.kind) {
    case "submit":
      return { colour: "var(--primary)", dashed: false };
    case "return":
    case "send_back":
      return { colour: "var(--stage-resubmitted-dot)", dashed: true };
    case "close":
      return { colour: stageVars(edge.targetColour ?? "approved").dot, dashed: false };
    case "cancel":
      return { colour: "var(--stage-cancelled-dot)", dashed: false };
    default:
      return { colour: "var(--text-secondary)", dashed: false };
  }
}

/** A folded part's title: "With <Company>" where the item is, else the role's part. */
export function groupTitle(node: Extract<MapNode, { kind: "group" }>, labels: WorkflowLabels, locale: Locale): string {
  return node.current && node.companyName ? labels.withCompany(node.companyName[locale]) : labels.part(labels.role(node.role));
}

export const hatched: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--border) 45%, transparent) 6px 7px)",
};
