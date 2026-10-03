import { currencyDecimals, isIsoValue, type AnswerField, type NamedAnswer, type TableColumn } from "./form.ts";
import { formatDate, formatNumber, timeZone, type Locale } from "./locale.ts";

// How answers read on screen (form-engine.md §5): the viewer's language, Latin
// digits, the Gregorian calendar, and the Project's time zone for instants.
// Stored values never change; only their display does. Pure, like the validator.

const yesNo = { en: { yes: "Yes", no: "No" }, ar: { yes: "نعم", no: "لا" } } satisfies Record<Locale, unknown>;
const anotherCompany = { en: "Another Company", ar: "شركة أخرى" } satisfies Record<Locale, string>;
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

const arabicIndicDigits = /[٠-٩۰-۹]/g;

/**
 * Text as an Arabic keyboard types it, in Latin digits: Arabic-Indic digits
 * and the Arabic decimal and thousands separators become Latin ones. Number
 * and phone boxes show what is typed this way, since Rabaed shows Latin digits.
 */
export function toLatinDigits(text: string): string {
  return text
    .replace(arabicIndicDigits, (d) => String(d.codePointAt(0)! & 0xf)) // both runs start at a code point ending in 0
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/**
 * The number typed in a number field, or null when it isn't one. Arabic-Indic
 * digits read as Latin ones; commas group thousands, a point marks decimals.
 */
export function parseNumberInput(text: string): number | null {
  const latin = toLatinDigits(text)
    .replace(/\s/g, "")
    // The minus sign (U+2212).
    .replace(/^−/, "-");
  // Commas only where they group thousands: "12,5" is refused, never read as 125.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(latin) && !/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(latin)) return null;
  return Number(latin.replace(/,/g, ""));
}

/** How many rows a table holds, as a phrase: "3 rows", "صفان". */
const rowCount = {
  en: (n: number) => (n === 1 ? "1 row" : `${formatNumber(n, "en")} rows`),
  // Arabic counts: one, two (dual), 3–10 (plural), 11 and more (singular accusative).
  ar: (n: number) =>
    n === 1 ? "صف واحد" : n === 2 ? "صفان" : n <= 10 ? `${formatNumber(n, "ar")} صفوف` : `${formatNumber(n, "ar")} صفًا`,
} satisfies Record<Locale, (n: number) => string>;

/** A table cell as the viewer reads it, by its column's type; empty when there is none. */
export function formatTableCell(column: TableColumn, value: unknown, locale: Locale): string {
  if (value === undefined || value === null) return "";
  switch (column.type) {
    case "number":
    case "currency":
    case "date":
    case "yes_no":
    case "select":
      return formatFormValue({ ...column, label: { en: "", ar: "" }, required: false }, value, locale);
    case "text":
      return typeof value === "string" ? value : String(value);
  }
}

/**
 * An answer as the viewer reads it: dates and times in their language (Latin
 * digits), Yes/No and option labels translated, text exactly as typed. A value
 * the field can't read (e.g. a retired option) is shown as stored. A `member` or
 * `participant` answer reads as the API `named` it for this viewer (V14): a
 * Member of their own Company by name, anyone else by their Company's name;
 * never by its id.
 */
export function formatFormValue(field: AnswerField, value: unknown, locale: Locale, named?: NamedAnswer): string {
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
    case "number":
      if (typeof value !== "number") return String(value ?? "");
      return [
        formatNumber(value, locale, { minimumFractionDigits: field.decimals ?? 0, maximumFractionDigits: field.decimals ?? 20 }),
        field.unit,
      ]
        .filter(Boolean)
        .join(" ");
    case "currency":
      return typeof value === "number"
        ? formatNumber(value, locale, { style: "currency", currency: field.currency, maximumFractionDigits: currencyDecimals(field.currency) })
        : String(value ?? "");
    case "yes_no":
      return value === true ? yesNo[locale].yes : value === false ? yesNo[locale].no : String(value ?? "");
    case "select":
    case "multi_select": {
      const labelOf = (v: unknown) => field.options.find((o) => o.value === v)?.label[locale] ?? String(v);
      return Array.isArray(value) ? value.map(labelOf).join(listSeparator[locale]) : value == null ? "" : labelOf(value);
    }
    case "table":
      return Array.isArray(value) ? rowCount[locale](value.length) : String(value ?? "");
    case "member":
    case "participant":
      return (named?.memberName ?? named?.companyName)?.[locale] ?? anotherCompany[locale];
    case "text":
    case "textarea":
    case "email":
    case "phone":
      return typeof value === "string" ? value : String(value ?? "");
    // Built-in Fields hold ids; the page names them (the renderer's `choices`), so only the ids are known here.
    case "trade":
    case "location":
    case "scopes":
      return Array.isArray(value) ? value.join(listSeparator[locale]) : String(value ?? "");
  }
}
