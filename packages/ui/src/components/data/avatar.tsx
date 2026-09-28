"use client";

import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import type { Tone } from "../../tokens/themes.ts";
import { toneClasses } from "./badge.tsx";
import { initials } from "./initials.ts";

// A person's initials sit on a tint picked from their name, so the same person always gets the same one.
const personTones: Tone[] = ["brand", "info", "success", "warning", "neutral"];

function toneFor(name: string): Tone {
  let sum = 0;
  for (const char of name) sum += char.codePointAt(0)!;
  return personTones[sum % personTones.length]!;
}

const sizes = {
  sm: "size-6 text-notes",
  md: "size-8 text-caption",
  lg: "size-10 text-body",
};

export type AvatarProps = {
  /** The person's or company's name: the accessible name, and the source of the initials. */
  name: string;
  /** A photo or logo, from our own origin. Falls back to the initials if it fails to load. */
  src?: string;
  /** `person` (default): a circle. `company`: a rounded square, always neutral. */
  kind?: "person" | "company";
  /** 24, 32 (default) or 40px. */
  size?: keyof typeof sizes;
  /** Hide it from screen readers when the name is shown beside it, so the name is read once. */
  decorative?: boolean;
  className?: string;
};

/** A person's photo or initials, or a company's logo or initials, named after them. */
export function Avatar({ name, src, kind = "person", size = "md", decorative = false, className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const showImage = src !== undefined && src !== failedSrc;
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none",
        kind === "company" ? "rounded-xs" : "rounded-full",
        showImage ? "bg-surface-subtle" : toneClasses[kind === "company" ? "neutral" : toneFor(name)],
        sizes[size],
        className,
      )}
    >
      {showImage ? (
        // Named by the wrapper, so the image itself is decorative.
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailedSrc(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export type CompanyChipProps = {
  /** The company's name, the only thing the chip shows about it. */
  name: string;
  logoSrc?: string;
  className?: string;
};

/**
 * A company as one block: its mark and name in a pill. It takes no person, so
 * it can never show another company's people (visibility: grouped companies).
 */
export function CompanyChip({ name, logoSrc, className }: CompanyChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface ps-0.5 pe-2.5 text-sm font-medium text-text",
        className,
      )}
    >
      <Avatar name={name} src={logoSrc} kind="company" size="sm" decorative />
      <span className="truncate">{name}</span>
    </span>
  );
}
