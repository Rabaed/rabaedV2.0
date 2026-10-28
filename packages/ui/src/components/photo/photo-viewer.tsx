"use client";

import type { AnnotatedPhoto } from "@rabaed/domain";
import { useEffect, useState } from "react";
import { Button } from "../button/button.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Icon } from "../icon/icon.tsx";
import { PhotoScreen } from "./photo-screen.tsx";

// A photo full screen (RP-656). One with an annotated copy shows the copy first,
// and Annotated / Original switches between the two: the original is the
// evidence, kept untouched. Annotate opens the annotate view on the photo shown.

/** The viewer's words, from the app's messages. */
export type PhotoViewerLabels = {
  close: string;
  /** The Annotated / Original switch's name, e.g. "Show". */
  show: string;
  annotated: string;
  original: string;
  annotate: string;
  /** Shown in place of a photo whose image isn't there (yet). */
  noImage: string;
};

export type PhotoViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: AnnotatedPhoto;
  /** Image URLs by Document id. */
  imageUrls?: Readonly<Record<string, string>>;
  labels: PhotoViewerLabels;
  /** Offer Annotate: the photo may be annotated now. */
  canAnnotate?: boolean;
  /** Annotate the photo shown, from its image URL. */
  onAnnotate?: (imageUrl: string) => void;
  /** Where the screen mounts (PhotoScreen's `container`). */
  container?: HTMLElement | null;
};

export function PhotoViewer({ open, onOpenChange, photo, imageUrls, labels: text, canAnnotate = false, onAnnotate, container }: PhotoViewerProps) {
  const copyId = photo.annotated?.id;
  const [showing, setShowing] = useState<"annotated" | "original">(copyId ? "annotated" : "original");
  // The copy first each time the viewer opens, or a new copy is saved; not on every render of the page.
  useEffect(() => {
    if (open) setShowing(copyId ? "annotated" : "original");
  }, [open, copyId]);
  const shown = showing === "annotated" && photo.annotated ? photo.annotated : photo.original;
  const url = imageUrls?.[shown.id];

  return (
    <PhotoScreen
      open={open}
      onOpenChange={onOpenChange}
      title={photo.original.fileName}
      closeLabel={text.close}
      container={container}
      actions={
        canAnnotate &&
        url && (
          <Button variant="secondary" onClick={() => onAnnotate?.(url)}>
            <Icon name="pencil" />
            {text.annotate}
          </Button>
        )
      }
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {url ? (
          // With CORS, as the annotate view loads it (see PhotoTool's thumbnails).
          <img src={url} alt={shown.fileName} crossOrigin="anonymous" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="flex flex-col items-center gap-2 text-sm">
            <Icon name="photo" size={40} />
            {text.noImage}
          </p>
        )}
      </div>
      {photo.annotated && (
        <div className="flex justify-center px-3 pt-2 pb-4">
          <SegmentedControl
            aria-label={text.show}
            value={showing}
            onValueChange={(next) => setShowing(next as "annotated" | "original")}
            options={[
              { value: "annotated", label: text.annotated },
              { value: "original", label: text.original },
            ]}
          />
        </div>
      )}
    </PhotoScreen>
  );
}
