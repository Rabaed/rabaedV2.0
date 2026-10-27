"use client";

import type { AnnotatedPhoto } from "@rabaed/domain";
import { useState } from "react";
import { Badge } from "../data/badge.tsx";
import { Icon } from "../icon/icon.tsx";
import { PhotoAnnotator, type PhotoAnnotatorLabels } from "./photo-annotator.tsx";
import { PhotoViewer, type PhotoViewerLabels } from "./photo-viewer.tsx";

// A photo opened full screen (RP-656), wherever Rabaed shows one: PhotoTool and
// the Form engine's photos field (RP-1056). The viewer first, with Annotated /
// Original once there is a copy; Annotate, where offered, opens the annotate
// view on the photo shown, and closing it comes back to the viewer.

/** The words of the viewer and the annotate view, from the app's messages. */
export type PhotoScreensLabels = { viewer: PhotoViewerLabels; annotator: PhotoAnnotatorLabels };

export type PhotoScreensProps = {
  /** The photo opened, with its annotated copy if it has one. */
  photo: AnnotatedPhoto;
  /** Image URLs by Document id. */
  imageUrls?: Readonly<Record<string, string>>;
  labels: PhotoScreensLabels;
  /**
   * Its photos may be annotated now (who may add the item's photos, the api decides). A frozen
   * original, which others may have seen, is never offered: RP-656-1.
   */
  canAnnotate: boolean;
  onClose: () => void;
  /** Stores `image` as the annotated copy of `originalId`; the annotate view closes once it resolves, and stays open with its marks if it throws. */
  onSaveAnnotated?: (originalId: string, image: Blob) => Promise<void> | void;
  /** Where the screens mount (PhotoScreen's `container`). */
  container?: HTMLElement | null;
};

export function PhotoScreens({ photo, imageUrls, labels: text, canAnnotate, onClose, onSaveAnnotated, container }: PhotoScreensProps) {
  const [annotating, setAnnotating] = useState<string | null>(null);
  return (
    <>
      <PhotoViewer
        open={annotating === null}
        onOpenChange={(next) => !next && onClose()}
        photo={photo}
        imageUrls={imageUrls}
        labels={text.viewer}
        canAnnotate={canAnnotate && !photo.original.frozen && !!onSaveAnnotated}
        onAnnotate={setAnnotating}
        container={container}
      />
      {annotating !== null && (
        <PhotoAnnotator
          open
          onOpenChange={(next) => !next && setAnnotating(null)}
          imageUrl={annotating}
          fileName={photo.original.fileName}
          labels={text.annotator}
          onSave={(image) => onSaveAnnotated?.(photo.original.id, image)}
          container={container}
        />
      )}
    </>
  );
}

/** The mark on the thumbnail of a photo shown by its annotated copy, at its bottom start corner. */
export function AnnotatedMark({ text }: { text: string }) {
  return (
    <Badge className="pointer-events-none absolute start-1 bottom-1">
      <Icon name="pencil" size={12} />
      {text}
    </Badge>
  );
}
