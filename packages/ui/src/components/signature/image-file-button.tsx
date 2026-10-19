"use client";

import { imageFileTypes } from "@rabaed/domain";
import type { ChangeEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { useFieldControl } from "../form/field.tsx";
import { Icon } from "../icon/icon.tsx";

/**
 * An image file control (a Signature, a logo, a Stamp: PNG or JPEG) dressed as a button whose
 * `text` is the app's own words, in the page's language, never the browser's "Choose File". The
 * input is visually hidden inside it, so the button's text names it; inside a Field it also takes
 * the Field's id, help and error.
 */
export function ImageFileButton({
  text,
  disabled = false,
  onChange,
  "aria-describedby": describedBy,
}: {
  text: string;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  "aria-describedby"?: string;
}) {
  const { labelId: _labelId, ...control } = useFieldControl({ disabled, "aria-describedby": describedBy });
  return (
    <label
      className={cn(
        buttonVariants({ variant: "secondary" }),
        "w-fit cursor-pointer",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        control.disabled && "pointer-events-none opacity-50",
      )}
    >
      <Icon name="upload" size={16} />
      {text}
      <input {...control} type="file" accept={imageFileTypes.join(",")} onChange={onChange} className="sr-only" />
    </label>
  );
}
