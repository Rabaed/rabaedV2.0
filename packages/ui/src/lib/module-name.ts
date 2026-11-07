import { moduleNames, type Locale, type ModuleKey } from "@rabaed/domain";
import type { IconName } from "../components/icon/icon.tsx";

/** A Module's name, in the viewer's language (the Dashboard's headings, the Activity Feed's Module filter, a List's title). */
export function moduleName(key: ModuleKey, locale: Locale): string {
  return moduleNames[key][locale];
}

/** A Module's icon, as its own pages show it (the Activity Feed page's Module · Type chip). */
export const moduleIcons: Record<ModuleKey, IconName> = {
  snag_list: "list-check",
  submittals: "file-text",
  inspections: "clipboard-check",
  site_reports: "clipboard-list",
  drawings: "ruler",
};
