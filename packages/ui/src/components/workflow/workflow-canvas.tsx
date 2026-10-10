"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { directionOf, type BaseRole, type Locale, type WorkItemMapPosition, type WorkflowDefinition } from "@rabaed/domain";
import { useMemo, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowLabels } from "./workflow-labels.ts";
import { workflowMap, type MapBand, type MapEdge, type MapNode, type MapStage, type WorkflowMapModel } from "./workflow-map.ts";
import { edgeLook, endIcon, groupTitle, hatched, kindIcon, stageVars, stepMeta } from "./workflow-parts.tsx";

export type WorkflowCanvasProps = {
  definition: WorkflowDefinition;
  /** The Stages of the Project and Module, in their order. */
  stages: readonly MapStage[];
  locale: Locale;
  labels: WorkflowLabels;
  /** `edit` lets the Steps be dragged (the builder, WF-16); `read` (default) only pans and zooms. */
  mode?: "read" | "edit";
  /** An item's map: the viewer's own Participant role. Every other role's Steps fold into one part (V14). */
  viewerRole?: BaseRole | null;
  /** Where the item is, as the API gives it. */
  position?: WorkItemMapPosition | null;
  /** Shown on the marked Step or part, e.g. its Step Age (aged as the viewer may see it, V14). */
  currentNote?: ReactNode;
  /** Edit mode: a Step was dropped somewhere new. Positions are in left-to-right canvas units, as `layout` stores them. */
  onLayoutChange?: (layout: WorkflowDefinition["layout"]) => void;
  className?: string;
};

type Ctx = { labels: WorkflowLabels; locale: Locale; rtl: boolean; stageNames: Map<string, string>; currentNote: ReactNode };
type BandData = { band: MapBand; height: number; ctx: Ctx };
type ItemData = { node: MapNode; ctx: Ctx; edit: boolean };
type EdgeData = { edge: MapEdge; lane: number; ctx: Ctx };
// A folded part is node type "part": React Flow styles its own "group" type.
type CanvasNode = Node<BandData, "band"> | Node<ItemData, "step" | "end" | "part">;
type CanvasEdge = Edge<EdgeData, "transition">;

/**
 * A Workflow on a canvas (RP-438, WF-15; workflow-engine.md §11), as in the
 * design's Workflows screen: a band per Stage side by side (right to left in
 * Arabic), Steps as cards in their band, the outcomes as pills, and Transitions as
 * labelled arrows coloured by kind (a Return dashed). Read-only by default; the
 * builder (WF-16) uses `mode="edit"`. Pair it with `WorkflowStepList`, the same
 * map as a list, for keyboard and screen-reader users.
 */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

const nodeTypes = { band: BandNode, step: StepNode, end: EndNode, part: PartNode };
const edgeTypes = { transition: TransitionEdge };

function Canvas({ definition, stages, locale, labels, mode = "read", viewerRole, position, currentNote, onLayoutChange, className }: WorkflowCanvasProps) {
  const dir = directionOf(locale);
  const edit = mode === "edit";
  const model = useMemo(() => workflowMap({ definition, stages, dir, viewerRole, position }), [definition, stages, dir, viewerRole, position]);
  const ctx = useMemo<Ctx>(
    () => ({ labels, locale, rtl: dir === "rtl", stageNames: new Map(stages.map((s) => [s.key, s.name[locale]])), currentNote }),
    [labels, locale, dir, stages, currentNote],
  );
  const { nodes, edges } = useMemo(() => toFlow(model, ctx, edit), [model, ctx, edit]);

  return (
    <div
      role="group"
      aria-label={labels.canvas}
      dir="ltr"
      className={cn("relative h-full min-h-[420px] overflow-hidden rounded-lg border border-border bg-surface", className)}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        // The model mirrors itself for Arabic; React Flow always lays out left to right.
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.04 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={edit}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={edit}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll
        attributionPosition={dir === "rtl" ? "bottom-right" : "bottom-left"}
        onNodeDragStop={
          onLayoutChange
            ? (_event, _node, moved) => {
                const layout = { ...definition.layout };
                for (const n of moved) {
                  if (n.type !== "step" && n.type !== "end") continue;
                  const w = (n.data as ItemData).node.width;
                  layout[n.id] = { x: Math.round(dir === "rtl" ? model.width - n.position.x - w : n.position.x), y: Math.round(n.position.y) };
                }
                onLayoutChange(layout);
              }
            : undefined
        }
        key={`${dir}:${definition.steps.length}:${viewerRole ?? ""}:${JSON.stringify(position ?? null)}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--border-strong)" />
        <Zoom labels={labels} rtl={dir === "rtl"} />
      </ReactFlow>
    </div>
  );
}

function toFlow(model: WorkflowMapModel, ctx: Ctx, edit: boolean): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const bands: CanvasNode[] = model.bands.map((band) => ({
    id: `band:${band.key}`,
    type: "band",
    position: { x: band.x, y: 0 },
    width: band.width,
    height: model.height,
    data: { band, height: model.height, ctx },
    draggable: false,
    selectable: false,
    zIndex: -1,
  }));
  const items: CanvasNode[] = model.nodes.map((node) => ({
    id: node.id,
    type: node.kind === "group" ? "part" : node.kind,
    position: { x: node.x, y: node.y },
    // Measured by React Flow: a note on the marked one makes it taller.
    data: { node, ctx, edit },
    draggable: edit && node.kind !== "group",
    selectable: edit && node.kind !== "group",
  }));
  // Transitions between the same two Steps (Approve · A and · B) get their own label lanes.
  const seen = new Map<string, number>();
  const edges: CanvasEdge[] = model.edges.map((edge) => {
    const pair = [edge.source, edge.target].toSorted().join("|");
    const lane = seen.get(pair) ?? 0;
    seen.set(pair, lane + 1);
    const { colour } = edgeLook(edge);
    const [sourceHandle, targetHandle] = edge.vertical
      ? (model.nodes.find((n) => n.id === edge.target)!.y > model.nodes.find((n) => n.id === edge.source)!.y ? ["bottom-out", "top-in"] : ["top-out", "bottom-in"])
      : edge.backwards
        ? ["bottom-out", "bottom-in"]
        : ["out", "in"];
    return {
      id: edge.id,
      type: "transition",
      source: edge.source,
      target: edge.target,
      sourceHandle,
      targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
      data: { edge, lane, ctx },
    };
  });
  return { nodes: [...bands, ...items], edges };
}

/** The handles every node carries: along the flow (out at its end side, in at its start side), and above and below. */
function Handles({ rtl }: { rtl: boolean }) {
  const hidden = "!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";
  return (
    <>
      <Handle id="in" type="target" position={rtl ? Position.Right : Position.Left} isConnectable={false} className={hidden} />
      <Handle id="out" type="source" position={rtl ? Position.Left : Position.Right} isConnectable={false} className={hidden} />
      <Handle id="top-in" type="target" position={Position.Top} isConnectable={false} className={hidden} />
      <Handle id="top-out" type="source" position={Position.Top} isConnectable={false} className={hidden} />
      <Handle id="bottom-in" type="target" position={Position.Bottom} isConnectable={false} className={hidden} />
      <Handle id="bottom-out" type="source" position={Position.Bottom} isConnectable={false} className={hidden} />
    </>
  );
}

function BandNode({ data }: NodeProps<Node<BandData, "band">>) {
  const { band, height, ctx } = data;
  const colour = band.colour ? stageVars(band.colour) : null;
  const name = band.key === "outcome" ? ctx.labels.outcome : (band.name?.[ctx.locale] ?? band.key);
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      className="h-full border-e border-border-subtle px-3 pt-3"
      style={{ height, background: colour ? `color-mix(in srgb, ${colour.bg} 70%, transparent)` : undefined }}
    >
      <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: colour?.fg }}>
        {name}
      </span>
    </div>
  );
}

function StepNode({ data }: NodeProps<Node<ItemData, "step">>) {
  const { node, ctx, edit } = data;
  if (node.kind !== "step") return null;
  const { step } = node;
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      className={cn(
        "flex w-[200px] gap-2.5 rounded-xl border border-border bg-surface p-3 text-start shadow-sm",
        edit && "cursor-grab",
        node.current && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
      )}
      style={{ borderTop: `3px solid ${stageVars(node.colour).dot}`, minHeight: node.height }}
    >
      <Handles rtl={ctx.rtl} />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-text-secondary">
        <Icon name="user" size={15} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[13px] leading-snug font-semibold text-text">{step.name[ctx.locale]}</div>
        <div className="text-[11.5px] leading-snug text-muted">{stepMeta(step, ctx.labels)}</div>
        {step.outcomeMode !== "none" && (
          <span className="inline-flex rounded-md bg-stage-pending-bg px-1.5 py-0.5 text-[11px] font-semibold text-stage-pending-fg">
            {ctx.labels.outcomeMode(step.outcomeMode)}
          </span>
        )}
        {node.current && <CurrentNote ctx={ctx} />}
      </div>
    </div>
  );
}

function EndNode({ data }: NodeProps<Node<ItemData, "end">>) {
  const { node, ctx } = data;
  if (node.kind !== "end") return null;
  const colour = stageVars(node.colour);
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      className={cn(
        "flex h-[46px] w-[170px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold",
        node.current && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
      )}
      style={{ border: `1.5px solid ${colour.dot}`, background: colour.bg, color: colour.fg }}
    >
      <Handles rtl={ctx.rtl} />
      <Icon name={endIcon(node.colour)} size={15} />
      <span className="truncate">{node.step.name[ctx.locale]}</span>
      {node.current && <span className="sr-only">{ctx.labels.current}</span>}
    </div>
  );
}

function PartNode({ data }: NodeProps<Node<ItemData, "part">>) {
  const { node, ctx } = data;
  if (node.kind !== "group") return null;
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      className={cn("flex gap-2.5 rounded-xl border bg-surface p-3 text-start shadow-sm", node.current ? "border-2 border-primary" : "border-border")}
      style={{
        width: node.width,
        minHeight: node.height,
        ...hatched,
        boxShadow: node.current ? "0 0 0 6px color-mix(in srgb, var(--primary) 18%, transparent)" : undefined,
      }}
    >
      <Handles rtl={ctx.rtl} />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-text-secondary">
        <Icon name="lock" size={15} />
      </span>
      <div className="min-w-0 space-y-1">
        <div className="text-[13px] leading-snug font-semibold text-text">{groupTitle(node, ctx.labels, ctx.locale)}</div>
        <div className="text-[11.5px] text-muted">{groupStages(node, ctx).join(" · ")}</div>
        {node.current && <CurrentNote ctx={ctx} />}
      </div>
    </div>
  );
}

/** "Current", for screen readers, and the caller's note (Step Age) on the marked Step or part. */
function CurrentNote({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <span className="sr-only">{ctx.labels.current}</span>
      {ctx.currentNote && <div className="border-t border-border-subtle pt-1.5 text-[11.5px] text-text-secondary">{ctx.currentNote}</div>}
    </>
  );
}

/** The Stages a folded part spans, by name: what its Steps are for, not which holds the item. */
function groupStages(node: Extract<MapNode, { kind: "group" }>, ctx: Ctx): string[] {
  return [...new Set(node.stepStages.map((key) => ctx.stageNames.get(key) ?? key))];
}

function TransitionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<CanvasEdge>) {
  if (!data) return null;
  const { edge, lane, ctx } = data;
  const { colour, dashed } = edgeLook(edge);
  let path: string;
  let labelX: number;
  let labelY: number;
  if (edge.vertical) {
    path = `M${sourceX} ${sourceY} L${targetX} ${targetY}`;
    labelX = sourceX;
    labelY = (sourceY + targetY) / 2;
  } else if (edge.backwards) {
    // Under the Steps, as the design draws a Return.
    const below = Math.max(sourceY, targetY) + 48 + lane * 20;
    path = `M${sourceX} ${sourceY} C${sourceX} ${below} ${targetX} ${below} ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = 0.125 * (sourceY + targetY) + 0.75 * below;
  } else {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  }
  labelY += lane * 22;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: colour, strokeWidth: 1.6, strokeDasharray: dashed ? "6 4" : undefined }} />
      <EdgeLabelRenderer>
        <span
          dir={ctx.rtl ? "rtl" : "ltr"}
          title={ctx.labels.kind(edge.transition.kind)}
          className="nodrag nopan pointer-events-none absolute inline-flex max-w-[180px] items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap text-text shadow-xs"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: colour }}
        >
          <Icon name={kindIcon(edge.transition.kind)} size={12} style={{ color: colour }} />
          <span className="truncate">{edge.transition.label[ctx.locale]}</span>
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

/** Zoom in, zoom out and fit, at the canvas's end corner as in the design. */
function Zoom({ labels, rtl }: { labels: WorkflowLabels; rtl: boolean }) {
  const flow = useReactFlow();
  const button = "flex size-8 items-center justify-center rounded-md text-text-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus";
  return (
    <div className={cn("absolute bottom-3 z-10 flex gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-sm", rtl ? "left-3" : "right-3")}>
      <button type="button" className={button} aria-label={labels.zoomOut} onClick={() => flow.zoomOut()}>
        <Icon name="zoom-out" size={17} />
      </button>
      <button type="button" className={button} aria-label={labels.zoomIn} onClick={() => flow.zoomIn()}>
        <Icon name="zoom-in" size={17} />
      </button>
      <button type="button" className={button} aria-label={labels.fit} onClick={() => flow.fitView({ padding: 0.04 })}>
        <Icon name="maximize" size={17} />
      </button>
    </div>
  );
}
