import type { Locale, ModuleKey } from "@rabaed/domain";

const moduleNames: Record<ModuleKey, Record<Locale, string>> = {
  snag_list: { en: "Snag List", ar: "قائمة الملاحظات" },
  submittals: { en: "Submittals", ar: "الاعتمادات" },
  inspections: { en: "Inspections", ar: "الفحوصات" },
  site_reports: { en: "Site Reports", ar: "التقارير الموقعية" },
  drawings: { en: "Drawings", ar: "المخططات" },
};

/** A Module's name, in the viewer's language (the Dashboard's headings, the Activity Feed's Module filter, a List's title). */
export function moduleName(key: ModuleKey, locale: Locale): string {
  return moduleNames[key][locale];
}
