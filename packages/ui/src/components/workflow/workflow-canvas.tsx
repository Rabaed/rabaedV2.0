"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
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
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowLabels } from "./workflow-labels.ts";
import { bandAt, workflowMap, type MapBand, type MapEdge, type MapNode, type MapStage, type WorkflowMapModel } from "./workflow-map.ts";
import { edgeLook, endIcon, groupTitle, hatched, kindIcon, stageVars, stepMeta } from "./workflow-parts.tsx";

/** What the builder has selected on the canvas: a Step or a Transition, by key. */
export type CanvasSelection = { kind: "step" | "transition"; key: string };

/**
 * How a Step or Transition is drawn besides its own look: a test run's path (`done`,
 * `current`, `faded`, and `next` for a Transition it may take), or a comparison's
 * changes (`added`, `removed`, `changed`).
 */
export type CanvasMark = "done" | "current" | "faded" | "next" | "added" | "removed" | "changed";

/** The drag data a builder palette item carries onto the canvas. */
export const canvasDragType = "application/x-rabaed-workflow-item";

type Point = { x: number; y: number };

export type WorkflowCanvasProps = {
  definition: WorkflowDefinition;
  /** The Stages of the Project and Module, in their order. */
  stages: readonly MapStage[];
  locale: Locale;
  labels: WorkflowLabels;
  /** `edit` (the builder, WF-16) lets Steps be selected, moved, connected and dropped in; `read` (default) only pans and zooms. */
  mode?: "read" | "edit";
  /** An item's map: the viewer's own Participant role. Every other role's Steps fold into one part (V14). */
  viewerRole?: BaseRole | null;
  /** Where the item is, as the API gives it. */
  position?: WorkItemMapPosition | null;
  /** Shown on the marked Step or part, e.g. its Step Age (aged as the viewer may see it, V14). */
  currentDetail?: ReactNode;
  /** Edit mode: a Step was dropped somewhere new. Positions are in left-to-right canvas units, as `layout` stores them. */
  onLayoutChange?: (layout: WorkflowDefinition["layout"]) => void;
  /** Edit mode: the selected Step or Transition. */
  selection?: CanvasSelection | null;
  onSelect?: (selection: CanvasSelection | null) => void;
  /** Edit mode: a Step was dragged onto another: add a Transition between them. */
  onConnect?: (from: string, to: string) => void;
  /** Edit mode: a Step was moved, to `at` (left-to-right units), and into Stage `stage` when it was dropped in another Stage's band. */
  onMoveStep?: (key: string, at: Point, stage: string | undefined) => void;
  /** Edit mode: a palette item (its `canvasDragType` data) was dropped into Stage `stage`'s band (`outcome` for the Outcome band) at `at`. */
  onDropItem?: (item: string, stage: string, at: Point) => void;
  /** Marks by Step or Transition key: a test run, or a comparison. */
  marks?: Readonly<Record<string, CanvasMark>>;
  /** Centres the canvas on this Step whenever `nonce` changes (a validation problem was picked). */
  focus?: { key: string; nonce: number } | null;
  /** Shows the small overview at the canvas's start corner, as the design's builder does. */
  minimap?: boolean;
  /** Drawn over the canvas, e.g. the builder's test run bar. */
  children?: ReactNode;
  className?: string;
};

type Ctx = {
  labels: WorkflowLabels;
  locale: Locale;
  rtl: boolean;
  edit: boolean;
  stageNames: Map<string, string>;
  currentDetail: ReactNode;
  marks: Readonly<Record<string, CanvasMark>>;
  selected: string | null;
  onSelect: ((selection: CanvasSelection | null) => void) | undefined;
};
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
 * builder (WF-16) uses `mode="edit"`: a band for every open Stage, Steps selected
 * by click or keyboard (Tab, then Enter), moved by dragging, connected by dragging
 * from one Step's edge to another, and palette items dropped into a band. Pair it
 * with `WorkflowStepList`, the same map as a list, for keyboard and screen-reader users.
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
const noMarks: Readonly<Record<string, CanvasMark>> = {};

function Canvas({
  definition,
  stages,
  locale,
  labels,
  mode = "read",
  viewerRole,
  position,
  currentDetail,
  onLayoutChange,
  selection = null,
  onSelect,
  onConnect,
  onMoveStep,
  onDropItem,
  marks = noMarks,
  focus,
  minimap = false,
  children,
  className,
}: WorkflowCanvasProps) {
  const dir = directionOf(locale);
  const edit = mode === "edit";
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const model = useMemo(
    () => workflowMap({ definition, stages, dir, viewerRole, position, everyStage: edit }),
    [definition, stages, dir, viewerRole, position, edit],
  );
  const selected = selection?.key ?? null;
  const ctx = useMemo<Ctx>(
    () => ({
      labels,
      locale,
      rtl: dir === "rtl",
      edit,
      stageNames: new Map(stages.map((s) => [s.key, s.name[locale]])),
      currentDetail,
      marks,
      selected,
      onSelect,
    }),
    [labels, locale, dir, edit, stages, currentDetail, marks, selected, onSelect],
  );
  const drawn = useMemo(() => toFlow(model, ctx, edit, selection), [model, ctx, edit, selection]);
  // Controlled, so the builder's edits redraw without resetting the view; React Flow moves a dragged node meanwhile.
  const [nodes, setNodes] = useState(drawn.nodes);
  const [edges, setEdges] = useState(drawn.edges);
  const [shown, setShown] = useState(drawn);
  if (shown !== drawn) {
    // Redrawn in the same render (not an effect), so a selection never lags behind the props.
    setShown(drawn);
    setNodes(drawn.nodes);
    setEdges(drawn.edges);
  }

  useEffect(() => {
    if (focus) void flow.fitView({ nodes: [{ id: focus.key }], maxZoom: 1, duration: 200, padding: 0.6 });
  }, [focus, flow]);

  /** A node's place in left-to-right layout units, from its place on the (mirrored in Arabic) canvas. */
  const ltr = (x: number, width: number) => Math.round(dir === "rtl" ? model.width - x - width : x);

  const drop = (event: DragEvent<HTMLDivElement>) => {
    const item = event.dataTransfer.getData(canvasDragType);
    if (!item || !onDropItem) return;
    event.preventDefault();
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const band = bandAt(model, at.x);
    // Centred on the pointer: a Step card is 200 wide.
    if (band) onDropItem(item, band.key, { x: ltr(at.x - 100, 200), y: Math.round(at.y - 40) });
  };

  return (
    <div
      role="group"
      aria-label={labels.canvas}
      dir="ltr"
      className={cn("relative h-full min-h-[420px] overflow-hidden rounded-lg border border-border bg-surface", className)}
      onDragOver={edit ? (e) => e.dataTransfer.types.includes(canvasDragType) && e.preventDefault() : undefined}
      onDrop={edit ? drop : undefined}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        // The model mirrors itself for Arabic; React Flow always lays out left to right.
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => {
          setNodes((ns) => applyNodeChanges(changes, ns));
          // A Step selected by the author (a click, or Enter on a focused Step); selections the props make send no change.
          const picked = changes.find((c) => c.type === "select" && c.selected && !c.id.startsWith("band:"));
          if (picked && "id" in picked && picked.id !== selected) onSelect?.({ kind: "step", key: picked.id });
        }}
        onEdgesChange={(changes) => {
          setEdges((es) => applyEdgeChanges(changes, es));
          const picked = changes.find((c) => c.type === "select" && c.selected);
          if (picked && "id" in picked && picked.id !== selected) onSelect?.({ kind: "transition", key: picked.id });
        }}
        onPaneClick={edit && onSelect ? () => onSelect(null) : undefined}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.04 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={edit}
        nodesConnectable={edit && !!onConnect}
        connectionMode={ConnectionMode.Loose}
        nodesFocusable={edit}
        edgesFocusable={edit}
        elementsSelectable={edit}
        // The builder deletes with its own keys, through its undo.
        deleteKeyCode={null}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll
        attributionPosition={dir === "rtl" ? "bottom-right" : "bottom-left"}
        onConnect={onConnect ? (c) => c.source !== c.target && onConnect(c.source, c.target) : undefined}
        onNodeDragStop={
          edit
            ? (_event, node, moved) => {
                if (onLayoutChange) {
                  const layout = { ...definition.layout };
                  for (const n of moved) {
                    if (n.type !== "step" && n.type !== "end") continue;
                    layout[n.id] = { x: ltr(n.position.x, (n.data as ItemData).node.width), y: Math.round(n.position.y) };
                  }
                  onLayoutChange(layout);
                }
                if (onMoveStep && (node.type === "step" || node.type === "end")) {
                  const item = (node.data as ItemData).node;
                  const band = node.type === "step" ? bandAt(model, node.position.x + item.width / 2) : null;
                  const stage = band && band.key !== "outcome" && item.kind === "step" && band.key !== item.step.stage ? band.key : undefined;
                  onMoveStep(node.id, { x: ltr(node.position.x, item.width), y: Math.round(node.position.y) }, stage);
                }
              }
            : undefined
        }
        key={edit ? dir : `${dir}:${definition.steps.length}:${viewerRole ?? ""}:${JSON.stringify(position ?? null)}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--border-strong)" />
        <Zoom labels={labels} rtl={dir === "rtl"} />
        {minimap && (
          <MiniMap
            position={dir === "rtl" ? "bottom-right" : "bottom-left"}
            pannable
            ariaLabel={labels.overview}
            nodeColor={(n) => (n.type === "band" ? "transparent" : "var(--border-strong)")}
            maskColor="color-mix(in srgb, var(--primary) 8%, transparent)"
            className="!m-3 !h-[85px] !w-[170px] overflow-hidden rounded-md border border-border !bg-surface"
          />
        )}
      </ReactFlow>
      {children}
    </div>
  );
}

function toFlow(model: WorkflowMapModel, ctx: Ctx, edit: boolean, selection: CanvasSelection | null): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const bands: CanvasNode[] = model.bands.map((band) => ({
    id: `band:${band.key}`,
    type: "band",
    position: { x: band.x, y: 0 },
    width: band.width,
    height: model.height,
    data: { band, height: model.height, ctx },
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: -1,
  }));
  const items: CanvasNode[] = model.nodes.map((node) => ({
    id: node.id,
    type: node.kind === "group" ? "part" : node.kind,
    position: { x: node.x, y: node.y },
    // Measured by React Flow: Step Age on the marked one makes it taller.
    data: { node, ctx, edit },
    draggable: edit && node.kind !== "group",
    selectable: edit && node.kind !== "group",
    selected: selection?.kind === "step" && selection.key === node.id,
    ariaLabel: node.kind === "group" ? undefined : node.step.name[ctx.locale],
  }));
  // Transitions between the same two Steps (Approve · A and · B) get their own label lanes.
  const seen = new Map<string, number>();
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const edges: CanvasEdge[] = model.edges.map((edge) => {
    const pair = [edge.source, edge.target].toSorted().join("|");
    const lane = seen.get(pair) ?? 0;
    seen.set(pair, lane + 1);
    const { colour } = edgeLook(edge);
    const [sourceHandle, targetHandle] = edge.vertical
      ? (byId.get(edge.target)!.y > byId.get(edge.source)!.y ? ["bottom-out", "top-in"] : ["top-out", "bottom-in"])
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
      selected: selection?.kind === "transition" && selection.key === edge.id,
      ariaLabel: edge.transition.label[ctx.locale],
      // eslint-disable-next-line rabaed/no-avoid-terms -- React Flow's arrowhead API, not a Rabaed term.
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
      data: { edge, lane, ctx },
    };
  });
  return { nodes: [...bands, ...items], edges };
}

/** The handles every node carries: along the flow (out at its end side, in at its start side), and above and below. Shown to connect in the builder. */
function Handles({ rtl, edit }: { rtl: boolean; edit: boolean }) {
  const look = edit
    ? "!size-2.5 !min-h-0 !min-w-0 !border-2 !border-surface !bg-primary opacity-0 transition-opacity group-hover/node:opacity-100"
    : "!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";
  return (
    <>
      <Handle id="in" type="target" position={rtl ? Position.Right : Position.Left} isConnectable={edit} className={look} />
      <Handle id="out" type="source" position={rtl ? Position.Left : Position.Right} isConnectable={edit} className={look} />
      <Handle id="top-in" type="target" position={Position.Top} isConnectable={edit} className={look} />
      <Handle id="top-out" type="source" position={Position.Top} isConnectable={edit} className={look} />
      <Handle id="bottom-in" type="target" position={Position.Bottom} isConnectable={edit} className={look} />
      <Handle id="bottom-out" type="source" position={Position.Bottom} isConnectable={edit} className={look} />
    </>
  );
}

/** A mark's look on a Step card or outcome pill. */
function markLook(mark: CanvasMark | undefined): string {
  switch (mark) {
    case "faded":
      // Receded without fading its text, which must stay readable.
      return "border-dashed !bg-surface-subtle !shadow-none";
    case "current":
      return "ring-[2.5px] ring-primary ring-offset-2 ring-offset-surface animate-pulse";
    case "added":
      return "ring-2 ring-success !bg-success-tint";
    case "removed":
      return "ring-2 ring-danger !bg-danger-tint opacity-80";
    case "changed":
      return "ring-2 ring-stage-resubmitted-dot";
    default:
      return "";
  }
}

function BandNode({ data }: NodeProps<Node<BandData, "band">>) {
  const { band, height, ctx } = data;
  const colour = band.colour ? stageVars(band.colour) : null;
  const name = band.key === "outcome" ? ctx.labels.outcome : (band.name?.[ctx.locale] ?? band.key);
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      className="h-full border-e border-dashed border-border-strong px-3 pt-3"
      style={{ height, background: colour ? `color-mix(in srgb, ${colour.bg} 70%, transparent)` : undefined }}
    >
      <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: colour?.fg }}>
        {name}
      </span>
    </div>
  );
}

function StepNode({ data, selected }: NodeProps<Node<ItemData, "step">>) {
  const { node, ctx, edit } = data;
  if (node.kind !== "step") return null;
  const { step } = node;
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      data-selected={selected || undefined}
      className={cn(
        "group/node flex w-[200px] gap-2.5 rounded-xl border border-border bg-surface p-3 text-start shadow-sm",
        edit && "cursor-grab",
        node.current && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        selected && "ring-2 ring-primary ring-offset-0 shadow-[0_0_0_6px_var(--brand-tint)]",
        markLook(ctx.marks[node.id]),
      )}
      style={{ borderTop: `3px solid ${stageVars(node.colour).dot}`, minHeight: node.height }}
    >
      <Handles rtl={ctx.rtl} edit={edit} />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-text-secondary">
        {/* eslint-disable-next-line rabaed/no-avoid-terms -- the Tabler icon's name: a person holds the Step. */}
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
        {node.current && <CurrentDetail ctx={ctx} />}
      </div>
    </div>
  );
}

function EndNode({ data, selected }: NodeProps<Node<ItemData, "end">>) {
  const { node, ctx, edit } = data;
  if (node.kind !== "end") return null;
  const colour = stageVars(node.colour);
  return (
    <div
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      data-selected={selected || undefined}
      className={cn(
        "group/node flex h-[46px] w-[170px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold",
        node.current && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        markLook(ctx.marks[node.id]),
      )}
      style={{ border: `1.5px solid ${colour.dot}`, background: colour.bg, color: colour.fg }}
    >
      <Handles rtl={ctx.rtl} edit={edit} />
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
      <Handles rtl={ctx.rtl} edit={false} />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-text-secondary">
        <Icon name="lock" size={15} />
      </span>
      <div className="min-w-0 space-y-1">
        <div className="text-[13px] leading-snug font-semibold text-text">{groupTitle(node, ctx.labels, ctx.locale)}</div>
        <div className="text-[11.5px] text-muted">{groupStages(node, ctx).join(" · ")}</div>
        {node.current && <CurrentDetail ctx={ctx} />}
      </div>
    </div>
  );
}

/** "Current", for screen readers, and the caller's detail (Step Age) on the marked Step or part. */
function CurrentDetail({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <span className="sr-only">{ctx.labels.current}</span>
      {ctx.currentDetail && <div className="border-t border-border-subtle pt-1.5 text-[11.5px] text-text-secondary">{ctx.currentDetail}</div>}
    </>
  );
}

/** The Stages a folded part spans, by name: what its Steps are for, not which holds the item. */
function groupStages(node: Extract<MapNode, { kind: "group" }>, ctx: Ctx): string[] {
  return [...new Set(node.stepStages.map((key) => ctx.stageNames.get(key) ?? key))];
}

/** A mark's colour on a Transition, overriding its kind's. */
function markColour(mark: CanvasMark | undefined): string | null {
  return mark === "added" ? "var(--success)" : mark === "removed" ? "var(--danger)" : mark === "changed" ? "var(--stage-resubmitted-dot)" : null;
}

// eslint-disable-next-line rabaed/no-avoid-terms -- React Flow's arrowhead prop, not a Rabaed term.
function TransitionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps<CanvasEdge>) {
  if (!data) return null;
  const { edge, lane, ctx } = data;
  const look = edgeLook(edge);
  const mark = ctx.marks[edge.id];
  const colour = markColour(mark) ?? look.colour;
  const dashed = look.dashed || mark === "removed";
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
  const label = (
    <>
      <Icon name={kindIcon(edge.transition.kind)} size={12} style={{ color: selected || mark === "next" ? undefined : colour }} />
      <span className="truncate">{edge.transition.label[ctx.locale]}</span>
    </>
  );
  const labelClass = cn(
    "nodrag nopan absolute inline-flex max-w-[180px] items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap text-text shadow-xs",
    (selected || mark === "next") && "!bg-primary !text-on-primary !border-primary",
    mark === "faded" && "border-dashed !bg-surface-subtle",
    mark === "removed" && "line-through",
  );
  const style = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: colour };
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        // eslint-disable-next-line rabaed/no-avoid-terms -- React Flow's arrowhead prop, not a Rabaed term.
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{
          stroke: colour,
          strokeWidth: selected ? 3.5 : mark === "done" || mark === "added" ? 3 : 1.6,
          strokeDasharray: dashed ? "6 4" : undefined,
          opacity: mark === "faded" ? 0.3 : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {ctx.edit && ctx.onSelect ? (
          <button
            type="button"
            tabIndex={-1}
            dir={ctx.rtl ? "rtl" : "ltr"}
            title={ctx.labels.kind(edge.transition.kind)}
            className={cn(labelClass, "pointer-events-auto cursor-pointer")}
            style={style}
            onClick={() => ctx.onSelect?.({ kind: "transition", key: edge.id })}
          >
            {label}
          </button>
        ) : (
          <span dir={ctx.rtl ? "rtl" : "ltr"} title={ctx.labels.kind(edge.transition.kind)} className={cn(labelClass, "pointer-events-none")} style={style}>
            {label}
          </span>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

/** Zoom in, zoom out and fit, at the canvas's end corner as in the design. */
function Zoom({ labels, rtl }: { labels: WorkflowLabels; rtl: boolean }) {
  const flow = useReactFlow();
  return (
    <div
      className={cn(
        "absolute bottom-3 z-10 flex gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-sm",
        // The canvas is laid out left to right, so its end corner in Arabic is its start.
        rtl ? "start-3" : "end-3",
      )}
    >
      <IconButton label={labels.zoomOut} size="sm" onClick={() => flow.zoomOut()}>
        <Icon name="zoom-out" />
      </IconButton>
      <IconButton label={labels.zoomIn} size="sm" onClick={() => flow.zoomIn()}>
        <Icon name="zoom-in" />
      </IconButton>
      <IconButton label={labels.fit} size="sm" onClick={() => flow.fitView({ padding: 0.04 })}>
        <Icon name="maximize" />
      </IconButton>
    </div>
  );
}
