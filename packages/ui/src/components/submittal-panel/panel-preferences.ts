/**
 * The Submittal Panel's preferences, per viewer, in this browser (spec RP-1054 table B): its
 * width, which sections are folded and the open tab. This is the one place they are read and
 * written; the panel's later parts (sizes, sections, tabs: RP-1063, RP-1066) add their fields
 * here. A convenience only: without storage the panel opens with the defaults. A deep link
 * (`?open=`) reads them but never writes them (README §2).
 */
export type SubmittalPanelPreferences = {
  /** The panel's width in px, or "full" (to the sidebar's edge). */
  width: number | "full";
  /** The sections the viewer folded, by key. */
  collapsed: Record<string, boolean>;
  /** The open tab's key. */
  tab: string;
};

/** The Normal width, which the panel opens at (README §2). */
export const submittalPanelNormalWidth = 640;

export const defaultSubmittalPanelPreferences: SubmittalPanelPreferences = { width: submittalPanelNormalWidth, collapsed: {}, tab: "details" };

export const submittalPanelPreferencesKey = "rabaed:submittal-panel:v1";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What is kept, field by field: a field of the wrong shape keeps its default. */
export function readSubmittalPanelPreferences(storage: PreferenceStorage | null): SubmittalPanelPreferences {
  let kept: unknown;
  try {
    kept = JSON.parse(storage?.getItem(submittalPanelPreferencesKey) ?? "null");
  } catch {
    return defaultSubmittalPanelPreferences;
  }
  if (!isRecord(kept)) return defaultSubmittalPanelPreferences;
  const { width, collapsed, tab } = kept;
  return {
    width: width === "full" || (typeof width === "number" && Number.isFinite(width) && width > 0) ? width : defaultSubmittalPanelPreferences.width,
    collapsed: isRecord(collapsed)
      ? Object.fromEntries(Object.entries(collapsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
      : defaultSubmittalPanelPreferences.collapsed,
    tab: typeof tab === "string" ? tab : defaultSubmittalPanelPreferences.tab,
  };
}

/** Keeps `change` on top of what is kept; quietly does nothing without storage. */
export function writeSubmittalPanelPreferences(storage: PreferenceStorage | null, change: Partial<SubmittalPanelPreferences>): void {
  try {
    storage?.setItem(submittalPanelPreferencesKey, JSON.stringify({ ...readSubmittalPanelPreferences(storage), ...change }));
  } catch {
    // Not kept: fine.
  }
}

/** The browser's storage, or null where reading it throws (a private window, blocked site data). */
export function submittalPanelStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
