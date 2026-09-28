/**
 * Pure matchers behind the Rabaed lint rules, so each design rule is defined
 * once and shared by the JavaScript, CSS and JSON rules.
 */

// ---- Colours --------------------------------------------------------------

const hexColour = /(?<![\w&#])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const colourFunction = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\bcolor\((?=\s*(?:from|srgb|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz))/gi;
const paletteReference = /--palette-[\w-]+/g;
// A string that reads as CSS (a declaration, a length, a shadow…), where "#123" is a colour, not a number.
const cssLike = /[:;]|\d(?:px|rem|em|%)\b|\b(?:solid|dashed|inset|gradient)\b/;
const namedColours = new Set([
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink", "gray", "grey",
  "brown", "cyan", "magenta", "navy", "teal", "maroon", "olive", "lime", "silver", "gold",
]);
const hasColourFunction = new RegExp(colourFunction.source, "i");
// Properties that take only a colour, and properties (shorthands included) that can contain one.
const colourOnlyProperty = /^(?:color|background-color|border(?:-[a-z]+)*-color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color)$/;
const colourBearingProperty = /^(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|box-shadow)$/;

/**
 * Hard-coded colours in the text: hex colours, colour functions (rgb(), oklch()…)
 * and references to the base palette (--palette-*). Outside CSS, a bare "#1234"
 * only counts when the text is the colour itself or reads as CSS, so Document
 * references such as "RFI #1234" pass.
 */
export function colourLiterals(text: string, { css = false } = {}): string[] {
  const inColourContext = css || cssLike.test(text) || hasColourFunction.test(text) || /^\s*#[0-9a-f]+\s*$/i.test(text);
  const hexes = inColourContext ? [...text.matchAll(hexColour)].map((m) => m[0]) : [];
  const functions = [...text.matchAll(colourFunction)].map((m) => `${m[0]}…)`);
  const palette = [...text.matchAll(paletteReference)].map((m) => m[0]);
  return [...hexes, ...functions, ...palette];
}

/** A named colour ("red", "white"…) given to a colour property such as `color` or `background`. */
export function namedColour(property: string, value: string): string | null {
  if (!colourBearingProperty.test(kebabCase(property))) return null;
  return value.toLowerCase().split(/[\s,/()]+/).find((word) => namedColours.has(word)) ?? null;
}

// ---- Tailwind class lists -------------------------------------------------

/** Splits a class token into its variant prefix (`md:hover:`) and the utility itself. */
function splitVariants(token: string): [prefix: string, utility: string] {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) cut = i + 1;
  }
  return [token.slice(0, cut), token.slice(cut)];
}

function isColourValue(value: string): boolean {
  const v = value.replaceAll("_", " ").trim();
  return colourLiterals(v, { css: true }).length > 0 || v.startsWith("color:") || namedColours.has(v.toLowerCase());
}

/**
 * Tailwind classes with an arbitrary colour value: `bg-[#f95738]`, `fill-[red]`,
 * `[color:red]`, or a base palette variable such as `bg-(--palette-red-500)`.
 */
export function arbitraryColourClasses(classes: string): string[] {
  return classes.split(/\s+/).filter((token) => {
    const [, utility] = splitVariants(token);
    const property = /^!?\[([a-z-]+):(.+)\]!?$/.exec(utility);
    if (property) return colourOnlyProperty.test(property[1]!) || isColourValue(property[2]!);
    const value = /^!?-?[a-z][\w-]*-[[(](.+)[\])]!?$/.exec(utility);
    return value !== null && isColourValue(value[1]!);
  });
}

// ---- Direction (RTL) ------------------------------------------------------

/** A physical (left/right) CSS thing found in the code, and its logical replacement. */
export type LogicalFix = { found: string; logical: string };

const inline = (side: string) => (side === "left" ? "start" : "end");
const physicalProperty =
  /^(?:(?<inset>left|right)|(?<box>margin|padding|scroll-margin|scroll-padding)-(?<boxSide>left|right)|border-(?<borderSide>left|right)(?<borderPart>-(?:color|style|width))?|border-(?<vertical>top|bottom)-(?<corner>left|right)-radius)$/;

/** The logical property for a physical CSS property (kebab-case), e.g. margin-left → margin-inline-start. */
export function logicalProperty(property: string): string | null {
  const side = physicalProperty.exec(property)?.groups;
  if (!side) return null;
  if (side.inset) return `inset-inline-${inline(side.inset)}`;
  if (side.box) return `${side.box}-inline-${inline(side.boxSide!)}`;
  if (side.borderSide) return `border-inline-${inline(side.borderSide)}${side.borderPart ?? ""}`;
  return `border-${side.vertical === "top" ? "start" : "end"}-${inline(side.corner!)}-radius`;
}

const logicalValues: Record<string, Record<string, string>> = {
  "text-align": { left: "start", right: "end" },
  float: { left: "inline-start", right: "inline-end" },
  clear: { left: "inline-start", right: "inline-end" },
};

/** The logical value for a physical one, e.g. text-align: left → start. */
export function logicalValue(property: string, value: string): string | null {
  return logicalValues[property]?.[value.trim().toLowerCase()] ?? null;
}

export function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Physical Tailwind utilities and their logical equivalents (Tailwind v4 names).
const physicalToLogical: [physical: string, logical: string][] = [
  ["scroll-ml", "scroll-ms"],
  ["scroll-mr", "scroll-me"],
  ["scroll-pl", "scroll-ps"],
  ["scroll-pr", "scroll-pe"],
  ["ml", "ms"],
  ["mr", "me"],
  ["pl", "ps"],
  ["pr", "pe"],
  ["left", "start"],
  ["right", "end"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["rounded-tl", "rounded-ss"],
  ["rounded-tr", "rounded-se"],
  ["rounded-bl", "rounded-es"],
  ["rounded-br", "rounded-ee"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["float-left", "float-start"],
  ["float-right", "float-end"],
  ["clear-left", "clear-start"],
  ["clear-right", "clear-end"],
];

/**
 * Physical left/right utilities (`ml-2`, `left-0`, `text-right`, `[margin-left:4px]`…)
 * with the logical class to use instead.
 */
export function physicalClasses(classes: string): LogicalFix[] {
  const results: LogicalFix[] = [];
  for (const token of classes.split(/\s+/)) {
    const [prefix, utility] = splitVariants(token);

    const arbitrary = /^(!?)\[([a-z-]+):(.+)\](!?)$/.exec(utility);
    if (arbitrary) {
      const [, bang, property, value, trailing] = arbitrary;
      const logical = logicalProperty(property!);
      const logicalVal = logicalValue(property!, value!);
      if (logical || logicalVal) {
        results.push({ found: token, logical: `${prefix}${bang}[${logical ?? property}:${logicalVal ?? value}]${trailing}` });
      }
      continue;
    }

    const { bang, neg, rest } = /^(?<bang>!?)(?<neg>-?)(?<rest>.*)$/.exec(utility)!.groups!;
    const hit = physicalToLogical.find(([physical]) => rest === physical || rest!.startsWith(`${physical}-`));
    if (hit) {
      const [physical, logical] = hit;
      results.push({ found: token, logical: `${prefix}${bang}${neg}${logical}${rest!.slice(physical.length)}` });
    }
  }
  return results;
}

// ---- Step Age only --------------------------------------------------------

// Rabaed shows Step Age only: no due dates, deadlines, SLAs or lateness (CONTEXT.md, CLAUDE.md).
const deadline = /overdue|due[\s_-]?date|deadline|متأخر|موعد نهائي|تاريخ الاستحقاق/i;
const sla = /\bSLAs?\b|^sla(?=[A-Z_])|(?<=[a-z])Sla(?=[A-Z_]|s?$)/;

/** The deadline word in an identifier, key or UI string, if any. */
export function deadlineWord(text: string): string | null {
  return deadline.exec(text)?.[0] ?? sla.exec(text)?.[0] ?? null;
}
