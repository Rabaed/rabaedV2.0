"use client";

import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import type { Tone } from "../../tokens/themes.ts";
import { initials } from "./initials.ts";
import { toneClasses } from "./tone.ts";

// A person's initials sit on a tint picked from their name, so the same person always gets the same one.
const personTones: Tone[] = ["brand", "info", "success", "warning", "neutral"];

function toneFor(name: string): Tone {
  let sum = 0;
  for (const char of name) sum += char.codePointAt(0)!;
  return personTones[sum % personTones.length]!;
}

// Solid avatars (the design kit's Home): a person's solid colour picked from their name the same way, white initials.
const solidTones = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4", "bg-avatar-5", "bg-avatar-6"];

function solidFor(name: string): string {
  let sum = 0;
  for (const char of name) sum += char.codePointAt(0)!;
  return solidTones[sum % solidTones.length]!;
}

// The kit's Members list: a mid-tone solid colour behind white initials, picked from a stable key.
const memberFills = ["bg-member-avatar-1", "bg-member-avatar-2", "bg-member-avatar-3", "bg-member-avatar-4", "bg-member-avatar-5", "bg-member-avatar-6", "bg-member-avatar-7"];

function memberFillFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return memberFills[hash % memberFills.length]!;
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
  /** The name the initials come from, when not `name`: e.g. the English one, for Latin initials on an Arabic card. */
  initialsFrom?: string;
  /**
   * A stable key of the person (their id): the initials sit on a solid colour picked from it, in white,
   * as in the kit's Members list. Without it, a pale tint picked from the name.
   */
  solidFrom?: string;
  /** White initials on a solid colour (the design kit's Home), rather than on a tint. */
  solid?: boolean;
  className?: string;
};

/** A person's photo or initials, or a company's logo or initials, named after them. */
export function Avatar({ name, src, kind = "person", size = "md", decorative = false, initialsFrom, solid = false, solidFrom, className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const showImage = src !== undefined && src !== failedSrc;
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none",
        kind === "company" ? "rounded-xs" : "rounded-full",
        showImage
          ? "bg-surface-subtle"
          : solidFrom !== undefined && kind === "person"
            ? cn("text-on-primary", memberFillFor(solidFrom))
            : solid
              ? cn("text-on-avatar", kind === "company" ? "bg-avatar-company" : solidFor(initialsFrom ?? name))
            : toneClasses[kind === "company" ? "neutral" : toneFor(name)],
        sizes[size],
        className,
      )}
    >
      {showImage ? (
        // Named by the wrapper, so the image itself is decorative.
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailedSrc(src)} />
      ) : (
        initials(initialsFrom ?? name)
      )}
    </span>
  );
}

/** The pill shared by CompanyChip and WithChip: a small decorative avatar, then the name, which truncates. */
export function Chip({ avatar, name, className }: { avatar: ReactNode; name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface ps-0.5 pe-2.5 text-sm font-medium text-text",
        className,
      )}
    >
      {avatar}
      <span className="truncate">{name}</span>
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
  return <Chip avatar={<Avatar name={name} src={logoSrc} kind="company" size="sm" decorative />} name={name} className={className} />;
}
