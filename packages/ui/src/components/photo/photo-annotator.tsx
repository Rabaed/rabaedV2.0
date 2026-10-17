"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { drawMarks, fittedSize, isMark, markColours, markTools, type Mark, type MarkColourKey, type MarkTool, type Point } from "./annotate-marks.ts";

// The annotate view (RP-656): a photo full screen, to mark up with an arrow, a
// rectangle or circle, a freehand pen and text labels, in a few colours (red by
// default), with undo, and Save. Touch first, in portrait. Saving draws the
// marks onto a copy of the photo at its own size and hands the image back: the
// page stores it as the annotated copy beside the original, which never changes.

/** The annotate view's words, from the app's messages. */
export type PhotoAnnotatorLabels = {
  /** The view's heading, e.g. "Annotate ceiling.jpg". */
  title: (fileName: string) => string;
  cancel: string;
  undo: string;
  save: string;
  saving: string;
  /** Saving failed; the marks are kept to try again. */
  failed: string;
  /** The photo's accessible name while it is marked up. */
  canvas: string;
  tools: string;
  tool: Record<MarkTool, string>;
  colours: string;
  colour: Record<MarkColourKey, string>;
  /** The text tool: the label's field, and adding it where the photo was last tapped (its middle at first). */
  labelText: string;
  addLabel: string;
};

export type PhotoAnnotatorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The image to mark up: the original, or its annotated copy to add to. Same-origin or CORS-enabled, to be drawn on. */
  imageUrl: string;
  fileName: string;
  labels: PhotoAnnotatorLabels;
  /** Called with the marked-up image (a JPEG at the photo's size, at most 4096px on its long side); the view closes once it resolves. */
  onSave: (image: Blob) => Promise<void> | void;
  /** Marks already drawn when the view opens (stories). */
  defaultMarks?: readonly Mark[];
};

const toolIcons: Record<MarkTool, IconName> = {
  arrow: "arrow-up-right",
  rectangle: "square",
  circle: "circle",
  pen: "pencil",
  text: "typography",
};

/** The longest side, in pixels, of a saved annotated copy. */
const longestSide = 4096;

/** Draws `marks` onto the photo at its own size and returns it as a JPEG. */
async function renderAnnotated(imageUrl: string, marks: readonly Mark[]): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = imageUrl;
  await image.decode();
  const { width, height } = fittedSize(image.naturalWidth, image.naturalHeight, longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const painter = canvas.getContext("2d")!;
  painter.drawImage(image, 0, 0, width, height);
  drawMarks(painter, marks, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The annotated photo could not be drawn"))), "image/jpeg", 0.9),
  );
}

type Size = { width: number; height: number };

/** The photo's box on screen: the largest that fits `stage`, its proportions kept. */
function fitted(natural: Size | null, stage: Size | null): Size | null {
  if (!natural || !stage || stage.width === 0 || stage.height === 0) return null;
  const scale = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: Math.floor(natural.width * scale), height: Math.floor(natural.height * scale) };
}

/** A button on the view's dark bar. */
const onBar = "text-on-inverse hover:bg-on-inverse/10 active:bg-on-inverse/20 disabled:bg-transparent disabled:text-on-inverse/40";

export function PhotoAnnotator({ open, onOpenChange, imageUrl, fileName, labels: text, onSave, defaultMarks = [] }: PhotoAnnotatorProps) {
  const [marks, setMarks] = useState<readonly Mark[]>(defaultMarks);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [tool, setTool] = useState<MarkTool>("arrow");
  const [colour, setColour] = useState<MarkColourKey>("red");
  const [labelAt, setLabelAt] = useState<Point>({ x: 0.5, y: 0.5 });
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<Size | null>(null);
  const [stageSize, setStageSize] = useState<Size | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelId = useId();
  const box = fitted(natural, stageSize);
  const value = markColours.find((c) => c.key === colour)!.value;

  // A fresh start each time the view opens, or opens on another image, from the marks given (a story's) or none.
  // Not again when the caller passes a new `defaultMarks` array while it is open.
  useEffect(() => {
    if (!open) return;
    setMarks(defaultMarks);
    setDraft(null);
    setLabel("");
    setFailed(false);
    setNatural(null);
  }, [open, imageUrl]);

  useEffect(() => {
    if (!stage) return;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  // The marks over the photo, at the screen's pixel density.
  const [boxWidth, boxHeight] = [box?.width ?? 0, box?.height ?? 0];
  useEffect(() => {
    const element = canvas.current;
    if (!element || boxWidth === 0) return;
    const density = window.devicePixelRatio || 1;
    element.width = Math.round(boxWidth * density);
    element.height = Math.round(boxHeight * density);
    const painter = element.getContext("2d");
    if (!painter) return;
    painter.setTransform(density, 0, 0, density, 0, 0);
    painter.clearRect(0, 0, boxWidth, boxHeight);
    drawMarks(painter, draft ? [...marks, draft] : marks, boxWidth, boxHeight);
  }, [marks, draft, boxWidth, boxHeight]);

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { x: clamp((event.clientX - rect.x) / rect.width), y: clamp((event.clientY - rect.y) / rect.height) };
  };

  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = pointOf(event);
    if (tool === "text") {
      setLabelAt(at);
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the drag still follows the moves it gets.
    }
    setDraft(tool === "pen" ? { tool, colour: value, points: [at] } : { tool, colour: value, from: at, to: at });
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const at = pointOf(event);
    setDraft(draft.tool === "pen" ? { ...draft, points: [...draft.points, at] } : draft.tool === "text" ? draft : { ...draft, to: at });
  };
  const up = () => {
    if (draft && isMark(draft)) setMarks([...marks, draft]);
    setDraft(null);
  };

  const addLabel = () => {
    const mark: Mark = { tool: "text", colour: value, at: labelAt, text: label.trim() };
    if (!isMark(mark)) return;
    setMarks([...marks, mark]);
    setLabel("");
  };

  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await onSave(await renderAnnotated(imageUrl, marks));
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-dvh flex-col bg-inverse text-on-inverse focus-visible:outline-none"
        >
          <header className="flex items-center gap-2 p-2">
            <DialogPrimitive.Close asChild>
              <IconButton label={text.cancel} disabled={saving} className={onBar}>
                <Icon name="x" />
              </IconButton>
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-body font-semibold">{text.title(fileName)}</DialogPrimitive.Title>
            <IconButton label={text.undo} disabled={marks.length === 0 || saving} onClick={() => setMarks(marks.slice(0, -1))} className={onBar}>
              <Icon name="arrow-back-up" />
            </IconButton>
            <Button onClick={save} disabled={marks.length === 0 || saving}>
              {saving ? text.saving : text.save}
            </Button>
          </header>

          {/* A photo has no reading direction: its marks keep their place in either language. */}
          <div ref={setStage} dir="ltr" className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            {!natural && (
              <img
                src={imageUrl}
                alt=""
                crossOrigin="anonymous"
                onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                className="invisible absolute"
              />
            )}
            {box && (
              <div className="relative" style={{ width: box.width, height: box.height }}>
                <img src={imageUrl} alt="" crossOrigin="anonymous" draggable={false} className="absolute inset-0 size-full select-none" />
                <canvas
                  ref={canvas}
                  role="img"
                  aria-label={text.canvas}
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  className="absolute inset-0 size-full touch-none"
                />
                {tool === "text" && (
                  // Where the next label goes.
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-on-inverse bg-inverse/60"
                    style={{ insetInlineStart: `${labelAt.x * 100}%`, top: `${labelAt.y * 100}%` }}
                  />
                )}
              </div>
            )}
          </div>

          {failed && (
            <p role="alert" className="mx-3 rounded-sm bg-danger-tint px-3 py-2 text-sm text-danger-fg">
              {text.failed}
            </p>
          )}

          <div className="flex flex-col gap-2 px-3 pt-2 pb-4">
            {tool === "text" && (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addLabel();
                }}
              >
                <label htmlFor={labelId} className="sr-only">
                  {text.labelText}
                </label>
                <input
                  id={labelId}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={text.labelText}
                  maxLength={80}
                  className={cn(
                    "h-11 min-w-0 flex-1 rounded-sm border border-on-inverse/60 bg-on-inverse/10 px-3 text-body text-on-inverse placeholder:text-on-inverse/80",
                    focusRing,
                  )}
                />
                <Button type="submit" variant="secondary" disabled={label.trim() === ""} className="h-11">
                  {text.addLabel}
                </Button>
              </form>
            )}
            <RadioGroupPrimitive.Root
              aria-label={text.tools}
              value={tool}
              onValueChange={(next) => setTool(next as MarkTool)}
              orientation="horizontal"
              className="grid grid-cols-5 gap-1"
            >
              {markTools.map((t) => (
                <RadioGroupPrimitive.Item
                  key={t}
                  value={t}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-sm text-xs text-on-inverse",
                    "hover:bg-on-inverse/10 data-[state=checked]:bg-on-inverse/20 data-[state=checked]:font-semibold",
                    focusRing,
                  )}
                >
                  <Icon name={toolIcons[t]} size={22} />
                  {text.tool[t]}
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
            <RadioGroupPrimitive.Root
              aria-label={text.colours}
              value={colour}
              onValueChange={(next) => setColour(next as MarkColourKey)}
              orientation="horizontal"
              className="flex justify-center gap-1"
            >
              {markColours.map((c) => (
                <RadioGroupPrimitive.Item
                  key={c.key}
                  value={c.key}
                  aria-label={text.colour[c.key]}
                  className={cn("group flex size-11 items-center justify-center rounded-full data-[state=checked]:bg-on-inverse/20", focusRing)}
                >
                  <span
                    aria-hidden="true"
                    className="size-7 rounded-full border-2 border-on-inverse/60 group-data-[state=checked]:border-on-inverse group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-on-inverse"
                    style={{ backgroundColor: c.value }}
                  />
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
