import { z } from "zod";

/**
 * The Modules that hold Work Items (`work_item_type.module_key`), in the order
 * the Dashboard shows them: the Snag List's open/closed cards first.
 */
export const moduleKeys = ["snag_list", "submittals", "inspections", "site_reports", "drawings"] as const;
export const moduleKeySchema = z.enum(moduleKeys);
export type ModuleKey = (typeof moduleKeys)[number];

/** Each Module's name in the viewer's language: a tab's, a Dashboard heading's, and the prefix of a Stage listed in another Module's tab (RP-652). */
export const moduleNames = {
  snag_list: { en: "Snag List", ar: "قائمة الملاحظات" },
  submittals: { en: "Submittals", ar: "الاعتمادات" },
  inspections: { en: "Inspections", ar: "الفحوصات" },
  site_reports: { en: "Site Reports", ar: "التقارير الموقعية" },
  drawings: { en: "Drawings", ar: "المخططات" },
} as const satisfies Record<ModuleKey, { en: string; ar: string }>;
