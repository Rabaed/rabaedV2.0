"use client";

import {
  SIGNATURE_MAX_BYTES,
  signatureHands,
  signatureImageTypes,
  signatureInks,
  signaturePens,
  type SaveSignatureRequest,
  type SignatureHand,
  type SignatureImageType,
  type SignatureInk,
  type SignatureMethod,
  type SignaturePen,
} from "@rabaed/domain";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../navigation/tabs.tsx";

// Profile → Add Signature (RP-85, ADR 0023): the Member draws their Signature with the
// mouse or a finger (a pen style and an ink), types their name in a handwriting style, or
// uploads an image of it. Each is saved as an image (PNG, or the uploaded JPEG), which every
// Transition they take from then on records. Presentational: the page saves it.

/** The editor's words, from the app's messages. */
export type SignatureEditorLabels = {
  /** Names the three ways, e.g. "How to add your Signature". */
  methods: string;
  drawn: string;
  typed: string;
  uploaded: string;
  /** The drawing area's name, e.g. "Signature pad: draw with your mouse or finger". */
  pad: string;
  pen: string;
  pens: Record<SignaturePen, string>;
  ink: string;
  inks: Record<SignatureInk, string>;
  clear: string;
  name: string;
  hand: string;
  hands: Record<SignatureHand, string>;
  /** The typed Signature's preview, e.g. "Preview". */
  preview: string;
  file: string;
  /** e.g. "A PNG or JPEG image, up to 512 KB." */
  fileHelp: string;
  save: string;
  /** Nothing to save yet. */
  empty: string;
  refusals: {
    /** The api found the image isn't one (`invalid_signature_image`). */
    invalid_signature_image: string;
    /** A file that isn't a PNG or JPEG image. */
    file_type: string;
    /** A file larger than allowed. */
    file_too_large: string;
    unavailable: string;
  };
};

/** Saving as the page calls it: a refusal by the API's error code. */
export type SaveSignatureCall = (signature: SaveSignatureRequest) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type SignatureEditorProps = {
  labels: SignatureEditorLabels;
  /** The Member's name, to start a typed Signature from. */
  defaultName: string;
  onSave: SaveSignatureCall;
  /** Beside Save, e.g. a link back. */
  secondaryAction?: ReactNode;
};

// The image's size in pixels, three times as wide as tall: the record's Signature box.
const WIDTH = 900;
const HEIGHT = 300;

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);
const isImageType = (type: string): type is SignatureImageType => (signatureImageTypes as readonly string[]).includes(type);

/** The typed name drawn in `hand` and `ink` on a transparent canvas. */
function drawTyped(canvas: HTMLCanvasElement, name: string, hand: SignatureHand, ink: SignatureInk) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  if (!name.trim()) return;
  // Arabic names are written right to left.
  context.direction = /[؀-ۿ]/.test(name) ? "rtl" : "ltr";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = signatureInks[ink];
  let size = 120;
  context.font = `${size}px ${signatureHands[hand]}`;
  while (size > 40 && context.measureText(name).width > WIDTH - 60) {
    size -= 8;
    context.font = `${size}px ${signatureHands[hand]}`;
  }
  context.fillText(name.trim(), WIDTH / 2, HEIGHT / 2);
}

export function SignatureEditor({ labels, defaultName, onSave, secondaryAction }: SignatureEditorProps) {
  const [method, setMethod] = useState<SignatureMethod>("drawn");
  const [pen, setPen] = useState<SignaturePen>("medium");
  const [ink, setInk] = useState<SignatureInk>("black");
  const [drawn, setDrawn] = useState(false);
  const [name, setName] = useState(defaultName);
  const [hand, setHand] = useState<SignatureHand>("flowing");
  const [upload, setUpload] = useState<{ contentType: SignatureImageType; dataUrl: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<HTMLCanvasElement>(null);
  const typed = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (typed.current) drawTyped(typed.current, name, hand, ink);
  }, [name, hand, ink, method]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * WIDTH, y: ((event.clientY - box.top) / box.height) * HEIGHT };
  };

  function stroke(to: { x: number; y: number }) {
    const context = pad.current?.getContext("2d");
    const from = last.current ?? to;
    if (!context) return;
    context.strokeStyle = signatureInks[ink];
    context.fillStyle = signatureInks[ink];
    // The pen's width in CSS pixels, at the image's scale.
    context.lineWidth = signaturePens[pen] * (WIDTH / Math.max(pad.current!.getBoundingClientRect().width, 1));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x + (from.x === to.x && from.y === to.y ? 0.01 : 0), to.y);
    context.stroke();
    last.current = to;
    setDrawn(true);
  }

  function clear() {
    pad.current?.getContext("2d")?.clearRect(0, 0, WIDTH, HEIGHT);
    setDrawn(false);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setUpload(null);
    if (!file) return;
    if (!isImageType(file.type)) return setError(labels.refusals.file_type);
    if (file.size > SIGNATURE_MAX_BYTES) return setError(labels.refusals.file_too_large);
    const reader = new FileReader();
    reader.onload = () => setUpload({ contentType: file.type as SignatureImageType, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  /** What Save sends: the image made the chosen way, or null when there is nothing yet. */
  function signature(): SaveSignatureRequest | null {
    if (method === "drawn") return drawn && pad.current ? { method, contentType: "image/png", data: base64Of(pad.current.toDataURL("image/png")) } : null;
    if (method === "typed") return name.trim() && typed.current ? { method, contentType: "image/png", data: base64Of(typed.current.toDataURL("image/png")) } : null;
    return upload ? { method, contentType: upload.contentType, data: base64Of(upload.dataUrl) } : null;
  }

  async function save() {
    const request = signature();
    if (!request) return setError(labels.empty);
    setPending(true);
    setError(null);
    try {
      const result = await onSave(request);
      if (!result.ok) setError(labels.refusals[result.reason as keyof SignatureEditorLabels["refusals"]] ?? labels.refusals.unavailable);
    } catch {
      setError(labels.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  const surface = "block aspect-[3/1] w-full max-w-[600px] rounded-md border border-dashed border-control-border bg-surface-subtle";
  const pens = Object.keys(signaturePens) as SignaturePen[];
  const inks = Object.keys(signatureInks) as SignatureInk[];
  const inkControl = (
    <Field label={labels.ink} group>
      <SegmentedControl value={ink} onValueChange={(v) => setInk(v as SignatureInk)} options={inks.map((value) => ({ value, label: labels.inks[value] }))} />
    </Field>
  );

  return (
    <div className="space-y-5">
      <Tabs
        value={method}
        onValueChange={(v) => {
          setMethod(v as SignatureMethod);
          setError(null);
        }}
      >
        <TabsList aria-label={labels.methods}>
          <TabsTrigger value="drawn" icon="signature">
            {labels.drawn}
          </TabsTrigger>
          <TabsTrigger value="typed" icon="edit">
            {labels.typed}
          </TabsTrigger>
          <TabsTrigger value="uploaded" icon="upload">
            {labels.uploaded}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="drawn" className="space-y-4 pt-4 data-[state=inactive]:hidden" forceMount>
          <canvas
            ref={pad}
            width={WIDTH}
            height={HEIGHT}
            role="img"
            aria-label={labels.pad}
            className={`${surface} cursor-crosshair touch-none`}
            onPointerDown={(event) => {
              try {
                // Keep drawing when the stroke leaves the pad and comes back.
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // A pointer the browser doesn't track (a synthetic one): draw without capture.
              }
              last.current = null;
              stroke(point(event));
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 0 || event.pointerType === "touch") {
                if (last.current) stroke(point(event));
              }
            }}
            onPointerUp={() => {
              last.current = null;
            }}
            onPointerLeave={() => {
              last.current = null;
            }}
          />
          <div className="flex flex-wrap items-end gap-4">
            <Field label={labels.pen} group>
              <SegmentedControl value={pen} onValueChange={(v) => setPen(v as SignaturePen)} options={pens.map((value) => ({ value, label: labels.pens[value] }))} />
            </Field>
            {inkControl}
            <Button variant="ghost" onClick={clear} disabled={!drawn}>
              {labels.clear}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="typed" className="space-y-4 pt-4 data-[state=inactive]:hidden" forceMount>
          <Field label={labels.name}>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label={labels.hand} group>
              <SegmentedControl
                value={hand}
                onValueChange={(v) => setHand(v as SignatureHand)}
                options={(Object.keys(signatureHands) as SignatureHand[]).map((value) => ({ value, label: labels.hands[value] }))}
              />
            </Field>
            {inkControl}
          </div>
          <canvas ref={typed} width={WIDTH} height={HEIGHT} role="img" aria-label={`${labels.preview}: ${name}`} className={surface} />
        </TabsContent>
        <TabsContent value="uploaded" className="space-y-4 pt-4 data-[state=inactive]:hidden" forceMount>
          <Field label={labels.file} help={labels.fileHelp}>
            <Input type="file" accept={signatureImageTypes.join(",")} onChange={chooseFile} />
          </Field>
          {upload && <img src={upload.dataUrl} alt={labels.preview} className={`${surface} object-contain`} />}
        </TabsContent>
      </Tabs>
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {secondaryAction}
        <Button onClick={() => void save()} disabled={pending}>
          {labels.save}
        </Button>
      </div>
    </div>
  );
}
