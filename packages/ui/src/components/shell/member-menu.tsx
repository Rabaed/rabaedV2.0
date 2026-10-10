"use client";

import { appearanceModes, appearanceThemes, directionOf, locales, type Appearance, type AppearanceMode, type AppearanceTheme, type Locale } from "@rabaed/domain";
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

export type MemberMenuAppearance = {
  /** The Member's Theme and Mode now. */
  value: Appearance;
  /** Called with the new Theme and Mode as the Member picks one; the page repaints at once. */
  onChange: (value: Appearance) => void;
  /** The two switches' names and each choice, e.g. "Theme": "Grey", "Warm"; "Mode": "Light", "Dark", "System". */
  labels: { theme: string; mode: string; themes: Record<AppearanceTheme, string>; modes: Record<AppearanceMode, string> };
};

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
  /** The Theme and Mode switches (owner decision 2026-10-11), under the language. */
  appearance?: MemberMenuAppearance;
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
  appearance,
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
            // On the dark sidebar, in every theme and mode.
            "flex w-full min-w-0 items-center gap-3 rounded-md text-start hover:bg-sidebar-press",
            collapsed ? "justify-center p-0.5" : "bg-sidebar-card p-2",
            focusRing,
          )}
        >
          <Avatar name={name} src={photoSrc} size="lg" decorative />
          {!collapsed && (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-bold text-sidebar-current-text">{name}</span>
              {companyName !== undefined && <span className="truncate text-caption text-sidebar-label">{companyName}</span>}
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
        <Choices label={languageLabel} options={locales} value={locale} onChange={onLocaleChange} name={(option) => languageNames[option]} own />
        {appearance && (
          <>
            <Choices
              label={appearance.labels.theme}
              options={appearanceThemes}
              value={appearance.value.theme}
              onChange={(theme) => appearance.onChange({ ...appearance.value, theme })}
              name={(theme) => appearance.labels.themes[theme]}
              shown
            />
            <Choices
              label={appearance.labels.mode}
              options={appearanceModes}
              value={appearance.value.mode}
              onChange={(mode) => appearance.onChange({ ...appearance.value, mode })}
              name={(mode) => appearance.labels.modes[mode]}
              shown
            />
          </>
        )}
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A row of pressed / not pressed buttons, one per choice, in a group named after the switch.
 * `own`: each choice in its own language (the language switch); `shown`: the switch's name
 * above it, as the Theme and Mode have.
 */
function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  own = false,
  shown = false,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  name: (option: T) => string;
  own?: boolean;
  shown?: boolean;
}) {
  const group = (
    <div role="group" aria-label={label} className="flex rounded-sm bg-field-fill p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          {...(own ? { lang: option, dir: directionOf(option as Locale) } : {})}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={cn(
            "h-8 flex-1 rounded-xs text-sm font-medium pointer-coarse:min-h-11",
            focusRing,
            // The chosen one inverse, as the kit's language switch: dark on a light page, light on a dark one.
            option === value ? "bg-inverse text-on-inverse shadow-xs" : "text-neutral-fg hover:text-text",
          )}
        >
          {name(option)}
        </button>
      ))}
    </div>
  );
  if (!shown) return group;
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden="true" className="text-caption font-semibold text-muted">
        {label}
      </span>
      {group}
    </div>
  );
}
