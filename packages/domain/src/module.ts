import { z } from "zod";

/**
 * The Modules that hold Work Items (`work_item_type.module_key`), in the order
 * the Dashboard shows them: the Snag List's open/closed cards first.
 */
export const moduleKeys = ["snag_list", "submittals", "inspections", "site_reports", "drawings"] as const;
export const moduleKeySchema = z.enum(moduleKeys);
export type ModuleKey = (typeof moduleKeys)[number];
