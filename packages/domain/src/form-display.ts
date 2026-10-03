import { isIsoValue, type FormField } from "./form.ts";
import { formatDate, timeZone, type Locale } from "./locale.ts";

// How answers read on screen (form-engine.md §5): the viewer's language, Latin
// digits, the Gregorian calendar, and the Project's time zone for instants.
// Stored values never change; only their display does. Pure, like the validator.

const yesNo = { en: { yes: "Yes", no: "No" }, ar: { yes: "نعم", no: "لا" } } satisfies Record<Locale, unknown>;
const listSeparator = { en: ", ", ar: "، " } satisfies Record<Locale, string>;

const wallTimeParts = new Intl.DateTimeFormat("en-US", {
  timeZone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** The Project's wall time (`YYYY-MM-DDTHH:mm`, as a datetime-local control takes it) of a stored UTC instant. */
export function toProjectWallTime(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const part = (type: Intl.DateTimeFormatPartTypes) => wallTimeParts.formatToParts(instant).find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** The UTC instant (ISO, `…Z`) of a wall time in the Project's time zone; empty if it isn't one. */
export function fromProjectWallTime(wallTime: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(wallTime);
  if (!match || !isIsoValue("datetime", `${match[1]}T${match[2]}Z`)) return "";
  // Read as if it were UTC, then take off the zone's offset at that moment
  // (twice, so a change of offset in between is honoured).
  const asUtc = Date.parse(`${match[1]}T${match[2]}Z`);
  const offsetAt = (instant: number) => Date.parse(`${toProjectWallTime(new Date(instant).toISOString())}Z`) - instant;
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first)).toISOString();
}

/**
 * An answer as the viewer reads it: dates and times in their language (Latin
 * digits), Yes/No and option labels translated, text exactly as typed. A value
 * the field can't read (e.g. a retired option) is shown as stored.
 */
export function formatFormValue(field: FormField, value: unknown, locale: Locale): string {
  switch (field.type) {
    case "date":
      return typeof value === "string" && isIsoValue("date", value)
        ? // A calendar date has no time zone: read and show it at midnight UTC.
          formatDate(new Date(`${value}T00:00:00Z`), locale, { dateStyle: "medium", timeZone: "UTC" })
        : String(value ?? "");
    case "time":
      return typeof value === "string" && isIsoValue("time", value)
        ? formatDate(new Date(`1970-01-01T${value}Z`), locale, { timeStyle: "short", timeZone: "UTC" })
        : String(value ?? "");
    case "datetime":
      return typeof value === "string" && isIsoValue("datetime", value)
        ? formatDate(new Date(value), locale, { dateStyle: "medium", timeStyle: "short" })
        : String(value ?? "");
    case "yes_no":
      return value === true ? yesNo[locale].yes : value === false ? yesNo[locale].no : String(value ?? "");
    case "select":
    case "multi_select": {
      const labelOf = (v: unknown) => field.options.find((o) => o.value === v)?.label[locale] ?? String(v);
      return Array.isArray(value) ? value.map(labelOf).join(listSeparator[locale]) : value == null ? "" : labelOf(value);
    }
    case "text":
    case "textarea":
      return typeof value === "string" ? value : String(value ?? "");
  }
}
