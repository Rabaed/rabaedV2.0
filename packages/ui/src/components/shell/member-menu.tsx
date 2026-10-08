"use client";

import { directionOf, locales, type Locale } from "@rabaed/domain";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

// Each language named in itself (its endonym), as language pickers do, so a reader of either can find theirs.
// Not a translation: the same in every locale, so it lives here rather than in the app's messages.
// eslint-disable-next-line rabaed/no-ui-translations -- a documented exception in packages/ui/README.md (language names, each in its own language)
const languageNames: Record<Locale, string> = { en: "English", ar: "العربية" };

export type MemberMenuProps = {
  /** The signed-in Member's name. */
  name: string;
  /** Their company, under the name in the menu. */
  companyName?: string;
  photoSrc?: string;
  /** Names the menu, e.g. "Profile". */
  label: string;
  /** The current language, and the switch's name, e.g. "Language". */
  locale: Locale;
  languageLabel: string;
  onLocaleChange: (locale: Locale) => void;
  /** More items, e.g. a Sign out button. */
  children?: ReactNode;
  /**
   * Where the button sits: in the top bar (avatar, name, chevron; the default),
   * or at the bottom of the sidebar (a card with the name and Company, opening upwards).
   */
  placement?: "topBar" | "sidebar";
  /** In a collapsed sidebar: the avatar only, still named after the Member. */
  collapsed?: boolean;
};

/**
 * The signed-in Member's avatar and name, opening their menu with the language
 * switch and the items passed in (Profile, Sign out). In the top bar, or as the
 * card at the bottom of the sidebar.
 */
export function MemberMenu({
  name,
  companyName,
  photoSrc,
  label,
  locale,
  languageLabel,
  onLocaleChange,
  children,
  placement = "topBar",
  collapsed = false,
}: MemberMenuProps) {
  const inSidebar = placement === "sidebar";
  return (
    <Popover>
      {inSidebar ? (
        <PopoverTrigger
          aria-label={collapsed ? name : undefined}
          className={cn(
            "flex w-full min-w-0 items-center gap-3 rounded-md text-start hover:bg-press",
            collapsed ? "justify-center p-0.5" : "bg-hover p-2",
            focusRing,
          )}
        >
          <Avatar name={name} src={photoSrc} size="lg" decorative />
          {!collapsed && (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-bold text-text">{name}</span>
              {companyName !== undefined && <span className="truncate text-caption text-muted">{companyName}</span>}
            </span>
          )}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full px-1 text-body font-medium text-text hover:bg-hover sm:pe-3",
            "justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            focusRing,
          )}
        >
          <Avatar name={name} src={photoSrc} decorative />
          {/* Hidden on a phone, but still the button's name. */}
          <span className="sr-only sm:not-sr-only">{name}</span>
          <Icon name="chevron-down" size={16} className="hidden text-muted sm:block" />
        </PopoverTrigger>
      )}
      <PopoverContent
        aria-label={label}
        side={inSidebar ? "top" : "bottom"}
        align={inSidebar ? "start" : "end"}
        className="flex w-72 flex-col gap-4"
      >
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
