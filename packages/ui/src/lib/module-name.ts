import { moduleNames, type Locale, type ModuleKey } from "@rabaed/domain";

/** A Module's name, in the viewer's language (the Dashboard's headings, the Activity Feed's Module filter, a List's title). */
export function moduleName(key: ModuleKey, locale: Locale): string {
  return moduleNames[key][locale];
}
