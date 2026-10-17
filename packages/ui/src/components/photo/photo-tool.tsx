"use client";

import { photoContentTypes, withAnnotatedCopies, type AnnotatedPhoto, type DocumentSummary } from "@rabaed/domain";
import { useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants, IconButton } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { PhotoAnnotator, type PhotoAnnotatorLabels } from "./photo-annotator.tsx";
import { PhotoViewer, type PhotoViewerLabels } from "./photo-viewer.tsx";

// The one photo tool for every photo in Rabaed (RP-656): an Inspection's check
// items and its request, Snags, Site Reports, attachments. Photos come from
// Take photo (the phone's camera, through the browser) or Upload (the gallery
// or files); they show as thumbnails, to open full screen, annotate, or remove.
// Annotating never changes a photo: the annotated copy is saved beside it, and
// its thumbnail shows the copy with an "Annotated" mark. Presentational: the page
// uploads, stores each annotated copy linked to its original, and passes the
// photos' Documents (copies included) and their image URLs back in.

/** The tool's words, from the app's messages. */
export type PhotoToolLabels = {
  none: string;
  takePhoto: string;
  upload: string;
  uploading: string;
  /** Opens a photo full screen, e.g. "Open ceiling.jpg". */
  open: (fileName: string) => string;
  remove: (fileName: string) => string;
  /** The mark on the thumbnail of a photo with an annotated copy. */
  annotatedMark: string;
  /** Shown when the photos are at their maximum, already worded with it. */
  full: string;
  viewer: PhotoViewerLabels;
  annotator: PhotoAnnotatorLabels;
};

export type PhotoToolProps = {
  /** The photos' Documents, each annotated copy among them (it names its original). */
  documents: readonly DocumentSummary[];
  /** Image URLs by Document id; a photo without one shows an icon in its place. */
  imageUrls?: Readonly<Record<string, string>>;
  /** Photos may be added, annotated and removed now. */
  canChange: boolean;
  /** An upload or a removal is under way. */
  pending?: boolean;
  /** At most this many photos (annotated copies not counted). */
  maxPhotos?: number;
  /** The image types to take; the photo types by default. */
  accept?: readonly string[];
  /** Names the photos as a group, e.g. "Photos: Ceiling void" (a check item's). */
  label: string;
  labels: PhotoToolLabels;
  /** Called with the photos taken or chosen, in order. */
  onUpload?: (files: File[]) => void;
  /** Removes a photo, and its annotated copy with it. */
  onRemove?: (documentId: string) => void;
  /** Stores `image` as the annotated copy of `originalId`; the annotate view closes once it resolves. */
  onSaveAnnotated?: (originalId: string, image: Blob) => Promise<void> | void;
};

/** A photo input dressed as a button: the camera's, or the gallery's and files'. */
function PhotoInput({ icon, text, accept, camera, disabled, onPick }: { icon: IconName; text: string; accept: string; camera?: boolean; disabled: boolean; onPick: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      className={cn(
        buttonVariants({ variant: "secondary" }),
        "w-full cursor-pointer",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Icon name={icon} size={20} />
      {text}
      <input
        ref={input}
        type="file"
        accept={accept}
        // On a phone, straight to the back camera; elsewhere it chooses a file.
        {...(camera ? { capture: "environment" } : { multiple: true })}
        disabled={disabled}
        onChange={() => {
          const files = [...(input.current?.files ?? [])];
          if (files.length > 0) onPick(files);
          if (input.current) input.current.value = "";
        }}
        className="sr-only"
      />
    </label>
  );
}

export function PhotoTool({
  documents,
  imageUrls,
  canChange,
  pending = false,
  maxPhotos,
  accept = photoContentTypes,
  label,
  labels: text,
  onUpload,
  onRemove,
  onSaveAnnotated,
}: PhotoToolProps) {
  const photos = withAnnotatedCopies(documents);
  const [opened, setOpened] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<{ photo: AnnotatedPhoto; imageUrl: string } | null>(null);
  const open = photos.find((p) => p.original.id === opened) ?? null;
  const full = maxPhotos !== undefined && photos.length >= maxPhotos;
  const takes = canChange && !full;

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3">
      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => {
            const { original, annotated } = photo;
            const url = imageUrls?.[annotated?.id ?? original.id];
            return (
              <li key={original.id} className="relative min-w-0">
                <button
                  type="button"
                  aria-label={text.open(original.fileName)}
                  onClick={() => setOpened(original.id)}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface-subtle",
                    focusRing,
                  )}
                >
                  {/* Loaded with CORS, as the annotate view loads it: a cached copy without CORS would stop it drawing the photo. */}
                  {url ? (
                    <img src={url} alt="" crossOrigin="anonymous" className="size-full object-cover" />
                  ) : (
                    <Icon name="photo" size={32} className="text-muted" />
                  )}
                </button>
                {annotated && (
                  <Badge className="pointer-events-none absolute start-1 bottom-1">
                    <Icon name="pencil" size={12} />
                    {text.annotatedMark}
                  </Badge>
                )}
                {canChange && !original.frozen && (
                  <IconButton
                    label={text.remove(original.fileName)}
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => onRemove?.(original.id)}
                    className="absolute end-1 top-1"
                  >
                    <Icon name="trash" size={16} />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">{text.none}</p>
      )}

      {takes && (
        <div className="grid grid-cols-2 gap-2">
          <PhotoInput icon="camera" text={text.takePhoto} accept={accept.join(",")} camera disabled={pending} onPick={(files) => onUpload?.(files)} />
          <PhotoInput icon="upload" text={text.upload} accept={accept.join(",")} disabled={pending} onPick={(files) => onUpload?.(files)} />
        </div>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted">
          {text.uploading}
        </p>
      )}
      {canChange && full && <p className="text-sm text-muted">{text.full}</p>}

      {open && (
        <PhotoViewer
          open={!annotating}
          onOpenChange={(next) => !next && setOpened(null)}
          photo={open}
          imageUrls={imageUrls}
          labels={text.viewer}
          canAnnotate={canChange && !open.original.frozen && !!onSaveAnnotated}
          onAnnotate={(imageUrl) => setAnnotating({ photo: open, imageUrl })}
        />
      )}
      {annotating && (
        <PhotoAnnotator
          open
          onOpenChange={(next) => !next && setAnnotating(null)}
          imageUrl={annotating.imageUrl}
          fileName={annotating.photo.original.fileName}
          labels={text.annotator}
          onSave={(image) => onSaveAnnotated?.(annotating.photo.original.id, image)}
        />
      )}
    </div>
  );
}
