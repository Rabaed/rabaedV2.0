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
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { directionOf, type BaseRole, type Locale, type WorkItemMapPosition, type WorkflowDefinition } from "@rabaed/domain";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowLabels } from "./workflow-labels.ts";
import { bandAt, workflowMap, type MapBand, type MapEdge, type MapNode, type MapStage, type WorkflowMapModel } from "./workflow-map.ts";
import { edgeLook, endIcon, groupTitle, hatched, isConditional, kindIcon, stageVars, stepIcon, stepMeta } from "./workflow-parts.tsx";

/** What the builder has selected on the canvas: a Step or a Transition, by key. */
export type CanvasSelection = { kind: "step" | "transition"; key: string };

/**
 * How a Step or Transition is drawn besides its own look: a test run's path (`done`,
 * `current`, `faded`, and `next` for a Transition it may take), or a comparison's
 * changes (`added`, `removed`, `changed`).
 */
export type CanvasMark = "done" | "current" | "faded" | "next" | "added" | "removed" | "changed";

/** The builder's arrows: curved, or at right angles (a per-viewer choice, RP-555). */
export type ArrowStyle = "curved" | "orthogonal";

/** The drag data a builder palette item carries onto the canvas. */
export const canvasDragType = "application/x-rabaed-workflow-item";

type Point = { x: number; y: number };

/** A Step moved on the canvas: to `at` (left-to-right units), into Stage `stage` when it was dropped in another Stage's band. */
export type CanvasMove = { key: string; at: Point; stage: string | undefined };

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
  /** Edit mode: the selected Step or Transition (the side panel's). */
  selection?: CanvasSelection | null;
  /** Edit mode: Steps and Transitions selected together (Shift-drag), by key. */
  group?: readonly string[];
  onSelect?: (selection: CanvasSelection | null) => void;
  /** Edit mode: a box selection picked several Steps and Transitions. */
  onSelectMany?: (selection: readonly CanvasSelection[]) => void;
  /** Edit mode: a connection was dragged from one Step and dropped on another (on a dot or its card): add a Transition. */
  onConnect?: (from: string, to: string) => void;
  /** Edit mode: a connection was dropped on empty canvas, at `at` (left-to-right units) in Stage `stage`'s band. */
  onConnectToEmpty?: (from: string, at: Point, stage: string | null) => void;
  /** Edit mode: a connection was started from an End, which only receives. */
  onConnectFromEnd?: () => void;
  /** Edit mode: Steps were moved together (one drag, one undo step). */
  onMoveSteps?: (moves: readonly CanvasMove[]) => void;
  /** Edit mode: a palette item (its `canvasDragType` data) was dropped into Stage `stage`'s band (`outcome` for the Outcome band) at `at`. */
  onDropItem?: (item: string, stage: string, at: Point) => void;
  /** Marks by Step or Transition key: a test run, or a comparison. */
  marks?: Readonly<Record<string, CanvasMark>>;
  /** Steps and Transitions with an error (the validation's): a red badge on each. */
  errors?: ReadonlySet<string>;
  /** Transitions whose Screen creates items (a table of items to create): the list icon on their label. */
  createsItems?: ReadonlySet<string>;
  /** Centres the canvas on this Step whenever `nonce` changes (a problem was picked). */
  focus?: { key: string; nonce: number } | null;
  /** Fits the whole Workflow in view whenever it changes (after Auto-layout). */
  fitNonce?: number;
  /** Shows the small overview at the canvas's start corner, as the design's builder does. */
  minimap?: boolean;
  /** Edit mode: the arrows' style. */
  arrowStyle?: ArrowStyle;
  /** Edit mode: Steps snap to a 20px grid as they are moved. */
  snapToGrid?: boolean;
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
  onSelect: ((selection: CanvasSelection | null) => void) | undefined;
  /** The builder's Steps entered by a Transition with Restrict rules: they wear the condition badge. */
  conditional: ReadonlySet<string>;
  errors: ReadonlySet<string>;
  createsItems: ReadonlySet<string>;
  orthogonal: boolean;
};
type BandData = { band: MapBand; height: number; ctx: Ctx };
type ItemData = { node: MapNode; ctx: Ctx; edit: boolean };
/** `fan`: an arrow into an End among `of` others, its label stacked at the End's side (`at` its place). */
type EdgeData = { edge: MapEdge; lane: number; fan: { at: number; of: number } | null; ctx: Ctx };
// A folded part is node type "part": React Flow styles its own "group" type.
type CanvasNode = Node<BandData, "band"> | Node<ItemData, "step" | "end" | "part">;
type CanvasEdge = Edge<EdgeData, "transition">;

/**
 * A Workflow on a canvas (RP-438, WF-15; workflow-engine.md §11), as in the
 * design's Workflows screen: a band per Stage side by side (right to left in
 * Arabic), Steps as cards in their band, the outcomes as pills, and Transitions as
 * labelled arrows coloured by kind (a Return dashed). Read-only by default; the
 * builder (WF-16) uses `mode="edit"`, as the owner's V2 reference (RP-555): Steps
 * selected by click or keyboard (Tab, then Enter), several with Shift-drag, moved by
 * dragging (snapped to a grid), connected by dragging from a Step's dot onto another
 * Step or onto empty canvas, and palette items dropped into a band. Pair it with
 * `WorkflowStepList`, the same map as a list, for keyboard and screen-reader users.
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
const noKeys: ReadonlySet<string> = new Set();
const noGroup: readonly string[] = [];
/** The builder's fit, as the reference's: the Steps fill the canvas, with a little room around. */
const FIT = { padding: 0.08, minZoom: 0.25 } as const;
/** The builder's grid, for the dots behind and for snapping. */
const GRID = 20;

function Canvas({
  definition,
  stages,
  locale,
  labels,
  mode = "read",
  viewerRole,
  position,
  currentDetail,
  selection = null,
  group = noGroup,
  onSelect,
  onSelectMany,
  onConnect,
  onConnectToEmpty,
  onConnectFromEnd,
  onMoveSteps,
  onDropItem,
  marks = noMarks,
  errors = noKeys,
  createsItems = noKeys,
  focus,
  fitNonce,
  minimap = false,
  arrowStyle = "curved",
  snapToGrid = false,
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
  const ctx = useMemo<Ctx>(
    () => ({
      labels,
      locale,
      rtl: dir === "rtl",
      edit,
      stageNames: new Map(stages.map((s) => [s.key, s.name[locale]])),
      currentDetail,
      marks,
      onSelect,
      conditional: new Set(edit ? definition.transitions.filter(isConditional).map((t) => t.to) : []),
      errors,
      createsItems,
      orthogonal: arrowStyle === "orthogonal",
    }),
    [labels, locale, dir, edit, stages, currentDetail, marks, onSelect, definition.transitions, errors, createsItems, arrowStyle],
  );
  const chosen = useMemo(() => new Set([...(selection ? [selection.key] : []), ...group]), [selection, group]);
  const box = useRef<HTMLDivElement>(null);
  /** The builder's fit (RP-555, as the reference's): every Step and End in view, the bands behind them. */
  const fit = useCallback(
    (duration = 0) => {
      const items = flow.getNodes().filter((n) => n.type !== "band");
      if (items.length > 0) void flow.fitView({ nodes: items.map((n) => ({ id: n.id })), ...FIT, maxZoom: 1.25, duration });
    },
    [flow],
  );
  const drawn = useMemo(() => toFlow(model, ctx, edit, chosen), [model, ctx, edit, chosen]);
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
  const [connecting, setConnecting] = useState(false);
  const boxing = useRef(false);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    // Centred on it at least at full size, as the reference's; no animation for those who ask for reduced motion.
    if (!focus) return;
    const node = flow.getInternalNode(focus.key);
    if (!node) return;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450;
    const { width = 200, height = 78 } = node.measured;
    void flow.setCenter(node.internals.positionAbsolute.x + width / 2, node.internals.positionAbsolute.y + height / 2, { zoom: Math.max(flow.getZoom(), 1), duration });
  }, [focus, flow]);

  useEffect(() => {
    if (edit && fitNonce !== undefined && fitNonce > 0) fit(matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400);
  }, [edit, fitNonce, fit]);

  // As the reference's: fitted again when the canvas gets noticeably wider or narrower.
  useEffect(() => {
    const el = box.current;
    if (!edit || !el || typeof ResizeObserver === "undefined") return;
    let width = Math.round(el.getBoundingClientRect().width);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? width);
      if (Math.abs(next - width) <= 40) return;
      width = next;
      clearTimeout(timer);
      timer = setTimeout(() => fit(), 60);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [edit, fit]);

  /** A node's place in left-to-right layout units, from its place on the (mirrored in Arabic) canvas. */
  const ltr = (x: number, width: number) => Math.round(dir === "rtl" ? model.width - x - width : x);
  const snap = (v: number) => (snapToGrid ? Math.round(v / GRID) * GRID : Math.round(v));

  const drop = (event: DragEvent<HTMLDivElement>) => {
    setDropping(false);
    const item = event.dataTransfer.getData(canvasDragType);
    if (!item || !onDropItem) return;
    event.preventDefault();
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const band = bandAt(model, at.x);
    // Centred on the pointer: a Step card is 200 wide.
    if (band) onDropItem(item, band.key, { x: snap(ltr(at.x - 100, 200)), y: snap(at.y - 39) });
  };

  /** Where a connection ended when React Flow made none: on a Step's card, or on empty canvas (RP-555, as the reference's). */
  const connectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    setConnecting(false);
    const from = state.fromNode?.id;
    if (state.isValid || !from) return;
    // An End only receives: say so rather than draw nothing.
    if (isEnd(from)) {
      onConnectFromEnd?.();
      return;
    }
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    const under = document.elementFromPoint(point.clientX, point.clientY);
    const card = under?.closest<HTMLElement>(".react-flow__node");
    const target = card?.dataset.id;
    if (target && target !== from && !target.startsWith("band:")) {
      onConnect?.(from, target);
      return;
    }
    if (!under?.closest(".react-flow__pane") || !onConnectToEmpty) return;
    const at = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const band = bandAt(model, at.x);
    onConnectToEmpty(from, { x: snap(ltr(at.x - 100, 200)), y: snap(at.y - 39) }, band && band.key !== "outcome" ? band.key : null);
  };

  /** Which band a moved Step now sits in, when that changed its Stage. */
  const movedTo = (n: CanvasNode): CanvasMove | null => {
    if (n.type !== "step" && n.type !== "end") return null;
    const item = (n.data as ItemData).node;
    const band = n.type === "step" ? bandAt(model, n.position.x + item.width / 2) : null;
    const stage = band && band.key !== "outcome" && item.kind === "step" && band.key !== item.step.stage ? band.key : undefined;
    return { key: n.id, at: { x: ltr(n.position.x, item.width), y: Math.round(n.position.y) }, stage };
  };

  const isEnd = (key: string) => model.nodes.some((n) => n.id === key && n.kind === "end");

  return (
    <div
      ref={box}
      role="group"
      aria-label={labels.canvas}
      dir="ltr"
      className={cn(
        "relative h-full min-h-[420px] overflow-hidden rounded-lg border border-border bg-surface",
        edit && "wf-edit",
        connecting && "wf-connecting",
        className,
      )}
      onDragOver={
        edit
          ? (e) => {
              if (!e.dataTransfer.types.includes(canvasDragType)) return;
              e.preventDefault();
              if (!dropping) setDropping(true);
            }
          : undefined
      }
      onDragLeave={edit ? (e) => !e.currentTarget.contains(e.relatedTarget as globalThis.Node | null) && setDropping(false) : undefined}
      onDrop={edit ? drop : undefined}
    >
      {edit && <Bands model={model} ctx={ctx} />}
      <ReactFlow<CanvasNode, CanvasEdge>
        // The model mirrors itself for Arabic; React Flow always lays out left to right.
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => {
          setNodes((ns) => applyNodeChanges(changes, ns));
          // A Step picked by the author (a click, or Enter on a focused Step); a box selection reports when it ends.
          const picked = boxing.current ? undefined : changes.find((c) => c.type === "select" && c.selected && !c.id.startsWith("band:"));
          if (picked && "id" in picked && !chosen.has(picked.id)) onSelect?.({ kind: "step", key: picked.id });
        }}
        onEdgesChange={(changes) => {
          setEdges((es) => applyEdgeChanges(changes, es));
          const picked = boxing.current ? undefined : changes.find((c) => c.type === "select" && c.selected);
          if (picked && "id" in picked && !chosen.has(picked.id)) onSelect?.({ kind: "transition", key: picked.id });
        }}
        onSelectionStart={
          edit
            ? () => {
                boxing.current = true;
              }
            : undefined
        }
        onSelectionEnd={
          edit
            ? () => {
                // Shift-drag: everything inside the box, selected together.
                boxing.current = false;
                const items: CanvasSelection[] = [
                  ...flow.getNodes().filter((n) => n.selected && (n.type === "step" || n.type === "end")).map((n) => ({ kind: "step" as const, key: n.id })),
                  ...flow.getEdges().filter((e) => e.selected).map((e) => ({ kind: "transition" as const, key: e.id })),
                ];
                if (items.length === 1) onSelect?.(items[0]!);
                else if (items.length > 1) onSelectMany?.(items);
              }
            : undefined
        }
        onPaneClick={edit && onSelect ? () => onSelect(null) : undefined}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // The builder fits its Steps (fit); a map to look at is fitted whole.
        fitView
        fitViewOptions={edit ? FIT : { padding: 0.04 }}
        onInit={edit ? () => fit() : undefined}
        // React Flow's MIT licence asks for no attribution; the builder's overview stays clear of it.
        proOptions={{ hideAttribution: true }}
        minZoom={edit ? FIT.minZoom : 0.2}
        maxZoom={2}
        nodesDraggable={edit}
        nodesConnectable={edit && !!onConnect}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        isValidConnection={(c) => c.source !== c.target && !isEnd(c.source)}
        onConnectStart={edit ? () => setConnecting(true) : undefined}
        onConnectEnd={edit ? connectEnd : undefined}
        nodesFocusable={edit}
        edgesFocusable={edit}
        elementsSelectable={edit}
        // Shift-drag selects a box; Ctrl or Cmd adds to the selection.
        selectionKeyCode="Shift"
        multiSelectionKeyCode={["Meta", "Control"]}
        snapToGrid={edit && snapToGrid}
        snapGrid={[GRID, GRID]}
        // The builder deletes with its own keys, through its undo.
        deleteKeyCode={null}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll
        attributionPosition={dir === "rtl" ? "bottom-right" : "bottom-left"}
        onConnect={onConnect ? (c) => c.source !== c.target && onConnect(c.source, c.target) : undefined}
        onNodeDragStop={
          edit && onMoveSteps
            ? (_event, _node, moved) => {
                const moves = moved.map(movedTo).filter((m): m is CanvasMove => m !== null);
                if (moves.length > 0) onMoveSteps(moves);
              }
            : undefined
        }
        key={edit ? dir : `${dir}:${definition.steps.length}:${viewerRole ?? ""}:${JSON.stringify(position ?? null)}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={edit ? GRID : 18} size={edit ? 1.2 : 1.4} color="var(--border-strong)" />
        <Zoom labels={labels} rtl={dir === "rtl"} onFit={edit ? () => fit(400) : undefined} />
        {minimap && (
          <MiniMap
            position={dir === "rtl" ? "bottom-right" : "bottom-left"}
            pannable
            zoomable
            ariaLabel={labels.overview}
            // As the reference's: each Step in its Stage's colour, each End in its own; the bands left out.
            nodeColor={(n) => (n.type === "band" ? "transparent" : n.type === "step" || n.type === "end" ? stageVars((n.data as ItemData).node.colour).dot : "var(--border-strong)")}
            nodeStrokeColor="transparent"
            nodeBorderRadius={6}
            bgColor="var(--surface)"
            maskColor="color-mix(in srgb, var(--text) 6%, transparent)"
            maskStrokeColor="transparent"
            maskStrokeWidth={0}
            className="!m-3 !h-[96px] !w-[170px] overflow-hidden rounded-lg"
            style={{ width: 170, height: 96 }}
          />
        )}
      </ReactFlow>
      {dropping && (
        // While a palette item is dragged over: where it will land, as the reference's.
        <div aria-hidden="true" className="pointer-events-none absolute inset-2 z-[8] rounded-xl border-2 border-dashed border-primary bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]" />
      )}
      {children}
    </div>
  );
}

/** The Stage bands behind the builder's canvas, moving with it (not nodes: the fit and the overview leave them out). */
function Bands({ model, ctx }: { model: WorkflowMapModel; ctx: Ctx }) {
  const [x, y, zoom] = useStore((s) => s.transform);
  const height = Math.max(model.height + 140, 820);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute start-0 top-0 z-0 origin-top-left" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
      {model.bands.map((band) => {
        const colour = band.colour ? stageVars(band.colour) : null;
        const name = band.key === "outcome" ? ctx.labels.outcome : (band.name?.[ctx.locale] ?? band.key);
        return (
          <div
            key={band.key}
            className="absolute border-e border-dashed border-border-strong"
            // The canvas is laid out left to right (the model mirrors itself for Arabic).
            // eslint-disable-next-line rabaed/no-physical-direction
            style={{ left: band.x, top: -60, width: band.width, height, background: colour?.bg, opacity: 0.85 }}
          >
            <span
              className="absolute top-4 text-[11px] font-extrabold tracking-[.05em] whitespace-nowrap uppercase"
              style={{ color: colour?.fg, ...(ctx.rtl ? { right: 14 } : { left: 14 }) }}
            >
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function toFlow(model: WorkflowMapModel, ctx: Ctx, edit: boolean, chosen: ReadonlySet<string>): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  // The builder draws its bands behind the canvas (Bands); a map to look at has them as nodes, fitted with the rest.
  const bands: CanvasNode[] = edit
    ? []
    : model.bands.map((band) => ({
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
    // Still while the builder lends the canvas to a test run (no onSelect).
    draggable: edit && !!ctx.onSelect && node.kind !== "group",
    selectable: edit && !!ctx.onSelect && node.kind !== "group",
    selected: chosen.has(node.id),
    ariaLabel: node.kind === "group" ? undefined : node.step.name[ctx.locale],
  }));
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  // Arrows into one End from afar: their labels stack at the End's side, top to bottom by where they come from (the reference's fan).
  const fans = new Map<string, MapEdge[]>();
  for (const edge of model.edges) {
    const target = byId.get(edge.target);
    if (target?.kind === "end" && !edge.vertical && !edge.backwards) fans.set(edge.target, [...(fans.get(edge.target) ?? []), edge]);
  }
  const fanOf = new Map<string, { at: number; of: number }>();
  for (const into of fans.values()) {
    into
      .toSorted((a, b) => byId.get(a.source)!.y - byId.get(b.source)!.y || (a.transition.outcome ?? "").localeCompare(b.transition.outcome ?? ""))
      .forEach((edge, at) => fanOf.set(edge.id, { at, of: into.length }));
  }
  // Transitions between the same two Steps (Approve · A and · B) get their own label lanes.
  const seen = new Map<string, number>();
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
      selected: chosen.has(edge.id),
      zIndex: chosen.has(edge.id) ? 2 : 0,
      ariaLabel: edge.transition.label[ctx.locale],
      // eslint-disable-next-line rabaed/no-avoid-terms -- React Flow's arrowhead API, not a Rabaed term.
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
      data: { edge, lane, fan: fanOf.get(edge.id) ?? null, ctx },
    };
  });
  return { nodes: [...bands, ...items], edges };
}

/**
 * The dots every node carries, as the reference's: in at its start side, out at its end side,
 * and above and below (out and in apart, so both can be grabbed). Shown to connect in the
 * builder; an End only receives.
 */
function Handles({ rtl, edit, end = false }: { rtl: boolean; edit: boolean; end?: boolean }) {
  const look = edit ? "" : "!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";
  const connectable = edit;
  return (
    <>
      <Handle id="in" type="target" position={rtl ? Position.Right : Position.Left} isConnectable={connectable} className={look} />
      {!end && <Handle id="out" type="source" position={rtl ? Position.Left : Position.Right} isConnectable={connectable} className={look} />}
      <Handle id="top-in" type="target" position={Position.Top} isConnectable={connectable} className={look} />
      {/* Along the card as the reference places them, on the canvas's own left-to-right axis. */}
      {/* eslint-disable rabaed/no-physical-direction */}
      {!end && <Handle id="top-out" type="source" position={Position.Top} isConnectable={connectable} className={look} style={{ left: "72%" }} />}
      {!end && <Handle id="bottom-out" type="source" position={Position.Bottom} isConnectable={connectable} className={look} style={{ left: "32%" }} />}
      <Handle id="bottom-in" type="target" position={Position.Bottom} isConnectable={connectable} className={look} style={{ left: "68%" }} />
      {/* eslint-enable rabaed/no-physical-direction */}
    </>
  );
}

/** A mark's look on a Step card or outcome pill. */
function markLook(mark: CanvasMark | undefined): string {
  switch (mark) {
    case "faded":
      // Off the test run's path: the card recedes (no shadow, no Stage colour, a dashed edge) while its text keeps its contrast.
      return "wf-faded border-dashed !shadow-none";
    case "current":
      return "wf-current";
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

/** The selected node's ring, as the reference's: the brand colour inside, a soft halo outside, on the node's own shape. */
const selectedRing = "shadow-[inset_0_0_0_2px_var(--primary),0_0_0_4px_var(--brand-tint)]";

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

/** The red badge on a Step with an error (the validation's), at the card's top start corner. */
function ErrorBadge({ label }: { label: string | undefined }) {
  return (
    <span className="absolute -start-[9px] -top-[9px] z-[1] flex size-[22px] items-center justify-center rounded-full bg-danger text-on-danger shadow-[0_0_0_2px_var(--surface)]">
      <Icon name="alert-triangle" size={12} label={label} />
    </span>
  );
}

function StepNode({ data, selected }: NodeProps<Node<ItemData, "step">>) {
  const { node, ctx, edit } = data;
  if (node.kind !== "step") return null;
  const { step } = node;
  const mark = ctx.marks[node.id];
  const faded = mark === "faded";
  return (
    <div
      data-node
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      data-selected={selected || undefined}
      className={cn(
        "group/node relative box-border flex w-[200px] gap-2.5 rounded-xl bg-surface px-3 py-2.5 text-start text-text shadow-[inset_0_0_0_1.5px_var(--border),0_2px_6px_color-mix(in_srgb,var(--text)_6%,transparent)] transition-shadow",
        edit && "cursor-grab",
        node.current && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        selected && selectedRing,
        markLook(mark),
      )}
      style={{ borderTop: `3px solid ${faded ? "var(--border)" : stageVars(node.colour).dot}`, minHeight: node.height }}
    >
      <Handles rtl={ctx.rtl} edit={edit} />
      <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-surface-subtle", faded ? "text-faint" : "text-text-secondary")}>
        <Icon name={stepIcon(step)} size={16} />
      </span>
      {ctx.conditional.has(node.id) && (
        // As the reference's: an amber filter badge at the card's top end corner.
        <span
          title={ctx.labels.conditional}
          className="absolute -end-[9px] -top-[9px] flex size-[22px] items-center justify-center rounded-full bg-stage-resubmitted-dot text-on-primary"
        >
          <Icon name="filter" size={12} label={ctx.labels.conditional} />
        </span>
      )}
      {ctx.edit && ctx.errors.has(node.id) && <ErrorBadge label={ctx.labels.error} />}
      <div className="min-w-0 flex-1">
        <b className="block text-[12.5px] leading-[1.3] font-semibold">{step.name[ctx.locale]}</b>
        <small className="mt-0.5 block text-[11px] text-muted">{stepMeta(step, ctx.labels)}</small>
        {step.outcomeMode !== "none" && (
          <span className="wf-om mt-[5px] inline-flex rounded-[5px] bg-stage-pending-bg px-1.5 py-px text-[10.5px] font-bold text-stage-pending-fg">
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
  const mark = ctx.marks[node.id];
  const faded = mark === "faded";
  return (
    <div
      data-node
      dir={ctx.rtl ? "rtl" : "ltr"}
      data-current={node.current || undefined}
      data-selected={selected || undefined}
      className={cn(
        "group/node relative box-border flex h-[46px] w-[170px] items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold text-text transition-shadow",
        node.current && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        // The selection takes the pill's own shape (RP-555 review: never a square around it).
        selected && selectedRing,
        markLook(mark),
      )}
      style={{
        background: faded ? "var(--surface)" : colour.bg,
        ...(selected || mark === "current" ? {} : { boxShadow: `inset 0 0 0 2px ${faded ? "var(--border)" : colour.dot}` }),
      }}
    >
      <Handles rtl={ctx.rtl} edit={edit} end />
      <Icon name={endIcon(node.colour)} size={16} style={{ color: faded ? "var(--faint)" : colour.dot }} />
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
      {ctx.currentDetail && <div className="mt-1.5 border-t border-border-subtle pt-1.5 text-[11.5px] text-text-secondary">{ctx.currentDetail}</div>}
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

/** An arrow's path and where its label sits (`anchor`: the label's own x offset, -50% centred). */
function edgeRoute(p: Pick<EdgeProps<CanvasEdge>, "sourceX" | "sourceY" | "targetX" | "targetY" | "sourcePosition" | "targetPosition">, data: EdgeData) {
  const { edge, lane, fan, ctx } = data;
  const { sourceX, sourceY, targetX, targetY } = p;
  let path: string;
  let x: number;
  let y: number;
  let anchor = "-50%";
  if (edge.vertical) {
    path = ctx.orthogonal ? getSmoothStepPath({ ...p, borderRadius: 14 })[0] : `M${sourceX} ${sourceY} L${targetX} ${targetY}`;
    // Beside the arrow, never on the cards it joins.
    x = (sourceX + targetX) / 2 + (targetY > sourceY ? -58 : 58);
    y = (sourceY + targetY) / 2;
  } else if (edge.backwards) {
    // Under the Steps, as the design draws a Return.
    const below = Math.max(sourceY, targetY) + 40 + lane * 24;
    if (ctx.orthogonal) {
      [path, x] = getSmoothStepPath({ ...p, sourcePosition: Position.Bottom, targetPosition: Position.Bottom, borderRadius: 16, offset: 40 + lane * 24 });
      y = below;
    } else {
      path = `M${sourceX} ${sourceY} C${sourceX} ${below + 8} ${targetX} ${below + 8} ${targetX} ${targetY}`;
      x = (sourceX + targetX) / 2;
      y = 0.125 * (sourceY + targetY) + 0.75 * (below + 8);
    }
  } else {
    [path, x, y] = ctx.orthogonal ? getSmoothStepPath({ ...p, borderRadius: 14 }) : getBezierPath(p);
    if (fan) {
      // Stacked at the End's side, ending just short of it.
      const forward = targetX > sourceX;
      x = targetX + (forward ? -12 : 12);
      y = targetY + (fan.at - (fan.of - 1) / 2) * 25;
      anchor = forward ? "-100%" : "0%";
    } else {
      y += lane * 26;
      x += lane * 40;
    }
  }
  return { path, x, y, anchor };
}

// eslint-disable-next-line rabaed/no-avoid-terms -- React Flow's arrowhead prop, not a Rabaed term.
function TransitionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps<CanvasEdge>) {
  if (!data) return null;
  const { edge, ctx } = data;
  const look = edgeLook(edge);
  const mark = ctx.marks[edge.id];
  const colour = markColour(mark) ?? look.colour;
  const dashed = look.dashed || mark === "removed";
  const { path, x, y, anchor } = edgeRoute({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }, data);
  const next = mark === "next";
  const faded = mark === "faded";
  const error = ctx.edit && ctx.errors.has(edge.id);
  const label = (
    <>
      {/* As the reference's: a filter icon on a Transition offered only when its rules hold; a list icon when its Screen creates items. */}
      {ctx.edit && isConditional(edge.transition) && <Icon name="filter" size={12} className="wf-label-icon" label={ctx.labels.conditional} />}
      {ctx.edit && ctx.createsItems.has(edge.id) && <Icon name="list-check" size={12} className="wf-label-icon" label={ctx.labels.createsItems} />}
      {!ctx.edit && <Icon name={kindIcon(edge.transition.kind)} size={12} className="wf-label-icon" />}
      <span className="truncate">{edge.transition.label[ctx.locale]}</span>
      {error && <Icon name="alert-triangle" size={12} className="text-danger-fg" label={ctx.labels.error} />}
    </>
  );
  const labelClass = cn(
    "wf-label nodrag nopan absolute inline-flex h-[22px] max-w-[220px] items-center gap-[3px] rounded-full bg-surface px-2 text-[11px] font-semibold whitespace-nowrap text-text",
    "shadow-[inset_0_0_0_1.5px_var(--ec)] [&_.wf-label-icon]:text-[var(--ec)]",
    // Selected: filled in the arrow's colour, as the reference's and the owner chose (RP-555).
    // A shade darker than the arrow, so its white text keeps its contrast (WCAG AA).
    selected && "!bg-[color-mix(in_srgb,var(--ec),black_45%)] !text-on-primary [&_.wf-label-icon]:!text-on-primary",
    next && "!bg-primary !text-on-primary !shadow-none [&_.wf-label-icon]:!text-on-primary",
    faded && "!text-muted shadow-[inset_0_0_0_1.5px_var(--border)] [&_.wf-label-icon]:!text-faint",
    mark === "removed" && "line-through",
  );
  const style: CSSProperties & Record<"--ec", string> = {
    transform: `translate(${x}px, ${y}px) translate(${anchor}, -50%)`,
    "--ec": colour,
    zIndex: selected ? 6 : 5,
  };
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        // eslint-disable-next-line rabaed/no-avoid-terms -- React Flow's arrowhead prop, not a Rabaed term.
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: colour,
          strokeWidth: selected ? 3.5 : mark === "done" || mark === "added" ? 3 : ctx.edit ? 2 : 1.6,
          strokeDasharray: dashed ? "6 4" : undefined,
          opacity: faded ? 0.3 : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {ctx.edit && ctx.onSelect ? (
          <button
            type="button"
            tabIndex={-1}
            dir={ctx.rtl ? "rtl" : "ltr"}
            title={ctx.labels.kind(edge.transition.kind)}
            className={cn(labelClass, "pointer-events-auto cursor-pointer", !selected && !next && "hover:bg-surface-subtle")}
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              ctx.onSelect?.({ kind: "transition", key: edge.id });
            }}
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
function Zoom({ labels, rtl, onFit }: { labels: WorkflowLabels; rtl: boolean; onFit?: (() => void) | undefined }) {
  const flow = useReactFlow();
  return (
    <div
      className={cn(
        "absolute bottom-3 z-10 flex gap-0.5 rounded-[10px] bg-surface p-[3px] shadow-[0_0_0_1px_var(--border),0_2px_8px_color-mix(in_srgb,var(--text)_8%,transparent)]",
        // The canvas is laid out left to right, so its end corner in Arabic is its start.
        rtl ? "start-3" : "end-3",
      )}
    >
      <IconButton label={labels.zoomOut} size="sm" onClick={() => flow.zoomOut({ duration: 200 })}>
        <Icon name="zoom-out" />
      </IconButton>
      <IconButton label={labels.zoomIn} size="sm" onClick={() => flow.zoomIn({ duration: 200 })}>
        <Icon name="zoom-in" />
      </IconButton>
      <IconButton label={labels.fit} size="sm" onClick={() => (onFit ? onFit() : void flow.fitView({ padding: 0.04 }))}>
        <Icon name="maximize" />
      </IconButton>
    </div>
  );
}
