"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { AnnotatedPhoto } from "@rabaed/domain";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../button/button.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Icon } from "../icon/icon.tsx";

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
};

/** A button on the view's dark bar. */
const onBar = "text-on-inverse hover:bg-on-inverse/10 active:bg-on-inverse/20";

export function PhotoViewer({ open, onOpenChange, photo, imageUrls, labels: text, canAnnotate = false, onAnnotate }: PhotoViewerProps) {
  const [showing, setShowing] = useState<"annotated" | "original">(photo.annotated ? "annotated" : "original");
  useEffect(() => {
    if (open) setShowing(photo.annotated ? "annotated" : "original");
  }, [open, photo.annotated]);
  const shown = showing === "annotated" && photo.annotated ? photo.annotated : photo.original;
  const url = imageUrls?.[shown.id];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-dvh flex-col bg-inverse text-on-inverse focus-visible:outline-none"
        >
          <header className="flex items-center gap-2 p-2">
            <DialogPrimitive.Close asChild>
              <IconButton label={text.close} className={onBar}>
                <Icon name="x" />
              </IconButton>
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-body font-semibold">{photo.original.fileName}</DialogPrimitive.Title>
            {canAnnotate && url && (
              <Button variant="secondary" onClick={() => onAnnotate?.(url)}>
                <Icon name="pencil" />
                {text.annotate}
              </Button>
            )}
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
            {url ? (
              <img src={url} alt={shown.fileName} className="max-h-full max-w-full object-contain" />
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
