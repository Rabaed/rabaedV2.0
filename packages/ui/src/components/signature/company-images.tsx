"use client";

import { COMPANY_IMAGE_MAX_BYTES, companyImageTypes, type CompanyImageKind, type CompanyImageType, type SaveCompanyImageRequest } from "@rabaed/domain";
import { useState, type ChangeEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { TitledCard } from "../data/titled-card.tsx";
import { toneClasses } from "../data/tone.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Icon } from "../icon/icon.tsx";

// The Company profile's logo and Stamp (RP-617, ADR 0023): two cards side by side, each with the
// image in force. Only the Company's Authorized Person uploads or replaces them; every other
// Member sees the images without the controls. While there is no Stamp, a notice at the top says
// the Company's Members can't act. In the design kit's Company Profile cards (`RP.profile`,
// `.pc`); the interim screen until RP-665's design. Presentational: the page saves them.

/** One card's words, from the app's messages. */
export type CompanyImageCardLabels = {
  title: string;
  /** Under the title: "Optional" for the logo, "Required to act" for the Stamp. */
  badge: string;
  /** What shows while there is none. */
  none: string;
  /** The file control's label: "Upload Stamp", or "Replace Stamp" once there is one. */
  upload: string;
  replace: string;
  /** Under the file control: the types and size it takes. */
  fileHelp: string;
  /** The image's text alternative. */
  imageAlt: string;
};

export type CompanyImagesLabels = {
  logo: CompanyImageCardLabels;
  stamp: CompanyImageCardLabels;
  /** The notice while there is no Stamp: "Your Members can't take any action until the Stamp is added." */
  noStamp: string;
  /** "Records already made keep the logo and Stamp in force then." */
  kept: string;
  /** "Saving…" while an upload is on its way. */
  saving: string;
  refusals: {
    file_type: string;
    file_too_large: string;
    invalid_company_image: string;
    /** Someone who isn't the Authorized Person, for an upload started before that changed. */
    forbidden: string;
    unavailable: string;
  };
};

export type SaveCompanyImageCall = (kind: CompanyImageKind, image: SaveCompanyImageRequest) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type CompanyImagesProps = {
  labels: CompanyImagesLabels;
  /** The images in force, as links; null where there is none. */
  logo: { url: string } | null;
  stamp: { url: string } | null;
  /** The Company's Authorized Person: the file controls show. */
  canManage: boolean;
  onUpload: SaveCompanyImageCall;
};

const isImageType = (type: string): type is CompanyImageType => (companyImageTypes as readonly string[]).includes(type);
const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function CompanyImageCard({
  kind,
  labels,
  all,
  image,
  canManage,
  onUpload,
}: {
  kind: CompanyImageKind;
  labels: CompanyImageCardLabels;
  all: CompanyImagesLabels;
  image: { url: string } | null;
  canManage: boolean;
  onUpload: SaveCompanyImageCall;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    setError(null);
    if (!file) return;
    try {
      if (!isImageType(file.type)) return setError(all.refusals.file_type);
      if (file.size > COMPANY_IMAGE_MAX_BYTES) return setError(all.refusals.file_too_large);
      setPending(true);
      const result = await onUpload(kind, { contentType: file.type, data: base64Of(await readAsDataUrl(file)) });
      if (!result.ok) {
        const refusals: Record<string, string> = all.refusals;
        setError(refusals[result.reason] ?? all.refusals.unavailable);
      }
    } catch {
      setError(all.refusals.unavailable);
    } finally {
      setPending(false);
      // The same file may be chosen again after a refusal.
      input.value = "";
    }
  }

  return (
    <TitledCard
      title={labels.title}
      actions={<span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kind === "stamp" && !image ? toneClasses.warning : toneClasses.neutral)}>{labels.badge}</span>}
      data-testid={`company-${kind}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex aspect-[3/2] w-full max-w-[280px] items-center justify-center rounded-md border border-border-subtle bg-surface-subtle p-3">
          {image ? (
            <img src={image.url} alt={labels.imageAlt} className="max-h-full max-w-full object-contain" />
          ) : (
            <p className="text-center text-sm text-muted">{labels.none}</p>
          )}
        </div>
        {canManage && (
          <Field label={image ? labels.replace : labels.upload} help={labels.fileHelp} error={error ?? undefined}>
            <Input type="file" accept={companyImageTypes.join(",")} onChange={(event) => void choose(event)} disabled={pending} />
          </Field>
        )}
        {pending && (
          <p role="status" className="text-sm text-muted">
            {all.saving}
          </p>
        )}
      </div>
    </TitledCard>
  );
}

export function CompanyImages({ labels, logo, stamp, canManage, onUpload }: CompanyImagesProps) {
  return (
    <div className="flex flex-col gap-4">
      {!stamp && (
        <p role="note" className={cn("m-0 flex items-start gap-2 rounded-lg px-3 py-2.5 text-body font-medium", toneClasses.warning)}>
          <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0" />
          <span>{labels.noStamp}</span>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <CompanyImageCard kind="logo" labels={labels.logo} all={labels} image={logo} canManage={canManage} onUpload={onUpload} />
        <CompanyImageCard kind="stamp" labels={labels.stamp} all={labels} image={stamp} canManage={canManage} onUpload={onUpload} />
      </div>
      <p className="text-sm text-muted">{labels.kept}</p>
    </div>
  );
}
