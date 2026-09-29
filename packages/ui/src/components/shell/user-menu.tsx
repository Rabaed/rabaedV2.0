"use client";

import { directionOf, locales, type Locale } from "@rabaed/domain";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

// Each language named in itself, as language pickers do, so a reader of either can find theirs.
const languageNames: Record<Locale, string> = { en: "English", ar: "العربية" };

export type UserMenuProps = {
  /** The signed-in Member's name. */
  name: string;
  /** Their company, under the name in the menu. */
  companyName?: string;
  photoSrc?: string;
  /** Names the menu, e.g. "Account". */
  label: string;
  /** The current language, and the switch's name, e.g. "Language". */
  locale: Locale;
  languageLabel: string;
  onLocaleChange: (locale: Locale) => void;
  /** More items, e.g. a Sign out button. */
  children?: ReactNode;
};

/** The Member's avatar and name in the top bar, opening a menu with the language switch. */
export function UserMenu({ name, companyName, photoSrc, label, locale, languageLabel, onLocaleChange, children }: UserMenuProps) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full ps-1 pe-1 text-body font-medium text-text hover:bg-hover sm:pe-3",
          "pointer-coarse:min-h-11",
          focusRing,
        )}
      >
        <Avatar name={name} src={photoSrc} decorative />
        {/* Hidden on a phone, but still the button's name. */}
        <span className="sr-only sm:not-sr-only">{name}</span>
        <Icon name="chevron-down" size={16} className="hidden text-muted sm:block" />
      </PopoverTrigger>
      <PopoverContent aria-label={label} align="end" className="flex w-64 flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} src={photoSrc} size="lg" decorative />
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            {companyName !== undefined && <div className="truncate text-caption text-muted">{companyName}</div>}
          </div>
        </div>
        <div role="group" aria-label={languageLabel} className="flex rounded-sm bg-neutral-tint p-1">
          {locales.map((option) => (
            <button
              key={option}
              type="button"
              lang={option}
              dir={directionOf(option)}
              aria-pressed={option === locale}
              onClick={() => onLocaleChange(option)}
              className={cn(
                "h-8 flex-1 rounded-xs text-sm font-medium pointer-coarse:min-h-11",
                focusRing,
                option === locale ? "bg-surface text-text shadow-xs" : "text-neutral-fg hover:text-text",
              )}
            >
              {languageNames[option]}
            </button>
          ))}
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
