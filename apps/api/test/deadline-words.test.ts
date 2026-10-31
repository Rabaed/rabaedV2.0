// The shared "no due date" check (RP-1150; CLAUDE.md: no due dates, deadlines or SLAs, only Step Age, never "overdue").
// It matches whole words, so random test data that holds "sla" inside a name ("Islam", "Aslan") no longer
// fails a PDF or a screen that prints no deadline at all (#536 left the merge queue on it).
import { describe, expect, it } from "vitest";
import { deadlineWordIn, expectNoDeadlineWords } from "./support/deadline-words.ts";

describe("deadlineWordIn", () => {
  it.each([
    ["Overdue", "Overdue"],
    ["3 items overdue", "overdue"],
    ["Deadline: 3 Oct", "Deadline"],
    ["Deadlines", "Deadlines"],
    ["Due date", "Due date"],
    ["Due dates", "Due dates"],
    ["duedate", "duedate"],
    ["Review due 3 Oct", "due"],
    ["SLA", "SLA"],
    ["SLAs", "SLAs"],
    ["within the sla", "sla"],
    ["Sla breached", "Sla"],
    ["(SLA)", "SLA"],
    // Identifiers in a JSON answer: a hump or an underscore ends the word (the word is returned split).
    ['{"dueDate":"2026-10-03"}', "due Date"],
    ['{"isOverdue":true}', "Overdue"],
    ['{"sla_days":3}', "sla"],
    ['{"slaDays":3}', "sla"],
    // A deadline word on its own is still a deadline word.
    ["deadlines-free", "deadlines"],
    // Arabic: late, final date, due date.
    ["متأخر", "متأخر"],
    ["الموعد نهائي للرد", "موعد نهائي"],
    ["تاريخ الاستحقاق: ١", "تاريخ الاستحقاق"],
  ])("finds the deadline word in %j", (text, word) => {
    expect(deadlineWordIn(text)).toBe(word);
    expect(() => expectNoDeadlineWords(text)).toThrow();
  });

  it.each([
    // People and Companies with "sla" inside the name: the flake that dropped #536.
    "Islam",
    "Mohammed Islam",
    "Islamic Contracting Co.",
    "Aslan Trading",
    "Salah",
    "Slater & Sons",
    "Abdul Salam Alslami",
    // Plain words.
    "translation",
    "slab",
    "Concrete slab, level 3",
    "slate roof",
    "isolation",
    "residue",
    "Reviewduration(days)",
    "Review duration (days)",
    "Due to the rain, the pour moved to Thursday",
    "Schedule",
    "Step Age: 3 weeks",
    // Arabic text with none of the words.
    "تقرير العيوب لمشروع البرج",
    "الإسلام للمقاولات",
    "مراجعة مستند رقم ١٢٣",
    // JSON keys that only look alike.
    '{"islamic":1,"stepAgeWeeks":3,"translation":"x"}',
    "",
  ])("passes %j", (text) => {
    expect(deadlineWordIn(text)).toBeNull();
    expect(() => expectNoDeadlineWords(text)).not.toThrow();
  });

  it("names the word and where it stood when the check fails", () => {
    expect(() => expectNoDeadlineWords("Pour slab 3. Status: Overdue since Monday.", "the snag report")).toThrow(
      /the snag report.*"Overdue"/s,
    );
  });
});
