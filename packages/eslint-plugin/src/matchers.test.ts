import { describe, expect, it } from "vitest";
import { arbitraryColourClasses, colourLiterals, deadlineWord, deadlineWordInCopy, namedColour, physicalClasses } from "./matchers.ts";

describe("colourLiterals", () => {
  it.each(["#fff", "#F95738", "#f9573880", "rgb(0 0 0)", "rgba(0,0,0,.4)", "hsl(10 50% 50%)", "oklch(0.7 0.1 30)", "0 1px 2px rgba(31, 36, 48, .05)", "1px solid #ddd", "var(--palette-tomato-600)", "color(srgb 1 0 0)"])(
    "finds %s",
    (text) => {
      expect(colourLiterals(text)).not.toEqual([]);
    },
  );

  it.each(["var(--primary)", "#main", "section#intro", "Step 2 of 3", "TWR-MAR-0000001", "&#1234;", "translate(10px)", "RFI #1234", "Step #2 of 4", "Pick a color(s)"])(
    "ignores %s",
    (text) => {
      expect(colourLiterals(text)).toEqual([]);
    },
  );
});

describe("arbitraryColourClasses", () => {
  it.each([
    "bg-[#f95738]",
    "text-[rgb(0_0_0)]",
    "hover:border-[color:var(--x)]",
    "bg-[var(--palette-tomato-600)]",
    "fill-[red]",
    "[color:red]",
    "bg-(--palette-red-500)",
    "md:text-[oklch(0.5_0.1_20)]",
  ])("finds %s", (cls) => {
    expect(arbitraryColourClasses(`p-2 ${cls} flex`)).toEqual([cls]);
  });

  it.each(["text-[13px]", "w-[calc(100%-2rem)]", "grid-cols-[max-content_1fr]", "bg-primary", "text-muted", "[border:1px_solid]", "bg-(--primary)"])("ignores %s", (cls) => {
    expect(arbitraryColourClasses(cls)).toEqual([]);
  });
});

describe("physicalClasses", () => {
  it.each([
    ["ml-2", "ms-2"],
    ["-mr-1", "-me-1"],
    ["md:pl-4", "md:ps-4"],
    ["pr-px", "pe-px"],
    ["left-0", "start-0"],
    ["hover:right-1/2", "hover:end-1/2"],
    ["border-l", "border-s"],
    ["border-r-2", "border-e-2"],
    ["rounded-l-md", "rounded-s-md"],
    ["rounded-tr-sm", "rounded-se-sm"],
    ["text-left", "text-start"],
    ["float-right", "float-end"],
    ["!ml-2", "!ms-2"],
    ["[margin-left:4px]", "[margin-inline-start:4px]"],
    ["md:[text-align:right]", "md:[text-align:end]"],
  ])("flags %s and suggests %s", (cls, logical) => {
    expect(physicalClasses(`flex ${cls} gap-2`)).toEqual([{ found: cls, logical }]);
  });

  it.each(["ms-2", "pe-4", "start-0", "rounded-lg", "rounded-sm", "border-border", "prose", "text-body", "leading-none", "mx-auto", "px-6"])(
    "allows %s",
    (cls) => {
      expect(physicalClasses(cls)).toEqual([]);
    },
  );
});

describe("deadlineWord", () => {
  it.each(["overdue", "isOverdue", "dueDate", "due_date", "DueDateBadge", "deadline", "deadlineAt", "Due date", "موعد نهائي", "متأخر", "SLA", "slaDays", "breachedSla", "SLA breached"])(
    "flags %s",
    (text) => {
      expect(deadlineWord(text)).not.toBeNull();
    },
  );

  it.each(["stepAge", "weeksAtStep", "residue", "dueling", "Submitted", "addressee", "translate", "isLatest", "slate-500", "island", "due", "isLate"])("allows %s", (text) => {
    expect(deadlineWord(text)).toBeNull();
  });
});

describe("deadlineWordInCopy", () => {
  it.each(["Overdue", "Due date: 3 Oct", "Due 3 Oct", "Payment due", "3 days late", "Late", "SLA breached", "متأخر"])("flags %s", (text) => {
    expect(deadlineWordInCopy(text)).not.toBeNull();
  });

  it.each(["4+ weeks at this step", "Rejected due to missing drawings", "Due to the site closure", "Latest revision", "Translate", "Submitted later", "Island"])(
    "allows %s",
    (text) => {
      expect(deadlineWordInCopy(text)).toBeNull();
    },
  );
});

describe("namedColour", () => {
  it.each([["color", "red"], ["background", "white url(x.png)"], ["borderColor", "black"], ["border", "1px solid red"]])("flags %s: %s", (p, v) => {
    expect(namedColour(p, v)).not.toBeNull();
  });

  it.each([["color", "var(--text)"], ["content", "red"], ["fontFamily", "Montserrat"], ["background", "transparent"]])("allows %s: %s", (p, v) => {
    expect(namedColour(p, v)).toBeNull();
  });
});
