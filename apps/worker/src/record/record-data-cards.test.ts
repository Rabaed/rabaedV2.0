import { describe, expect, it } from "vitest";
import { goldenFacts, type GoldenCode } from "./golden-fixtures.ts";
import { calendarDays, initialsOf, recordDataOf, recordDataXml } from "./record-data.ts";

// The pages after page 1, as the Record Data holds them (RP-650; form-engine.md §6, elements
// 10 to 14; visibility.md V7): the Review Comments, one Signature card per Transition on the
// path, the Next step, the Stamps and the Disclaimer; on page 1 the review duration and a
// Cancel's who and why.

const verification = { code: "7K2M-9QXD", link: "https://rabaed.test/verify/x" };
const data = (golden: GoldenCode, language: "bilingual" | "ar" | "en" = "en", hasImage?: (key: string) => boolean) =>
  recordDataOf(goldenFacts(golden, language), verification, new Map(), hasImage);

describe("the Signature cards", () => {
  it("are one per Transition on the path, with its verb, label, the Member, their Signature as recorded and the time", () => {
    const { cards } = data("B");
    expect(cards.map((c) => [c.verb.en, c.label.en, c.name.en])).toEqual([
      ["Prepared", "Prepared", "Omar Haddad"],
      ["Submitted", "Submit", "Sara Qahtani"],
      ["Reviewed", "Send to Manager", "Faisal Otaibi"],
      ["Approved", "Approve with Comments · B", "Huda Harbi"],
    ]);
    expect(cards.map((c) => c.signatureKey)).toEqual(["sig-omar", "sig-sara", "sig-faisal", "sig-huda"]);
    expect(cards[3]).toMatchObject({ positions: [{ en: "Manager" }], company: { en: "Gulf Engineering Consultants" }, at: "2026-10-14T09:30:00.000Z" });
  });

  it("give an internal reviewer's card the verb Reviewed and no Code of his own", () => {
    const engineer = data("A").cards[2]!;
    expect(engineer.verb.en).toBe("Reviewed");
    expect(engineer.label.en).toBe("Send to Manager");
    expect(engineer.lines).toEqual([]);
  });

  it("print what the Member wrote in the shared Action Form: the Remarks, and Code B's Comments as a numbered list", () => {
    const issuer = data("B").cards[3]!;
    expect(issuer.lines).toEqual([
      { kind: "text", label: { en: "Sample checked" }, value: { en: "Yes" } },
      { kind: "text", label: { en: "Remarks" }, value: { en: "Approved with the Comments below.\nResolve each before the trays are covered." } },
      {
        kind: "list",
        label: { en: "Comments" },
        items: [
          { en: "Fix the trays at 1.5 m centres, not 2 m. — Spec 26 05 36, 3.2" },
          { en: "Earth every tray section with a bonding jumper." },
          { en: "Submit the fire-stopping detail where trays pass through walls. — Drawing E-12" },
        ],
      },
    ]);
    expect(data("B").cards[1]!.lines).toEqual([{ kind: "text", label: { en: "Cover Note" }, value: { en: "Submitted with the manufacturer's datasheet and test certificate." } }]);
  });

  it("in the Owner's review, name the Consultant PM as the issuer and give the Owner's confirmation its own card", () => {
    const record = data("owner");
    expect(record.cards.map((c) => [c.verb.en, c.name.en])).toEqual([
      ["Prepared", "Omar Haddad"],
      ["Submitted", "Sara Qahtani"],
      ["Approved", "Huda Harbi"],
      ["Confirmed", "Nora Saud"],
    ]);
    expect(record.issuedBy?.name.en).toBe("Huda Harbi");
    expect(record.confirmedBy?.name.en).toBe("Nora Saud");
    // The Recommendation is the two Companies' own: nothing of it is printed.
    expect(record.cards[2]!.lines).toEqual([]);
  });

  it("call a negative Code's issuer Reviewed", () => {
    expect(data("D").cards.at(-1)!.verb.en).toBe("Reviewed");
    expect(data("C").cards.at(-1)!.verb.en).toBe("Reviewed");
  });

  it("show no Signature that could not be read, and the Record Data then flags none", () => {
    const record = data("A", "en", (key) => key !== "sig-faisal");
    expect(record.cards.map((c) => c.signatureKey)).toEqual(["sig-omar", "sig-sara", null, "sig-huda"]);
    expect(recordDataXml(record).match(/<signature\/>/g)).toHaveLength(3);
  });
});

describe("the Next step", () => {
  it("is a Revision by the raiser's Company after Code C, a replacement after Code D, and none after A or B", () => {
    expect(data("C").nextStep).toEqual({ kind: "revision", revisionNo: 1, company: { en: "Al Rashid Contracting" } });
    expect(data("D").nextStep).toEqual({ kind: "replacement" });
    expect(data("A").nextStep).toBeNull();
    expect(data("B").nextStep).toBeNull();
  });
});

describe("a Cancelled record", () => {
  it("says who cancelled it and why, with that Member's card", () => {
    const record = data("cancelled");
    expect(record.cancellation).toMatchObject({ by: { name: { en: "Sara Qahtani" } }, reason: "The supplier withdrew the product; a new request follows.", companyLeft: null });
    expect(record.cards.map((c) => c.verb.en)).toEqual(["Prepared", "Cancelled"]);
    expect(record.reviewDays).toBeNull();
    expect(record.nextStep).toBeNull();
  });

  it("says Rabaed cancelled it when a Company left the Project, with no card for that step", () => {
    const record = data("rabaed-cancelled");
    expect(record.cancellation).toEqual({ by: null, reason: null, companyLeft: { en: "Al Rashid Contracting" } });
    expect(record.cards.map((c) => c.verb.en)).toEqual(["Prepared"]);
    expect(record.issuedBy).toBeNull();
    expect(recordDataXml(record)).toContain("<cancelledByRabaed>");
  });
});

describe("the Stamps", () => {
  it("are every Company whose Member acted on the path, labelled by role; never the Owner who did not act", () => {
    expect(data("B").stamps).toEqual([
      { company: { en: "Al Rashid Contracting" }, role: { en: "Main Contractor" }, stampKey: "stamp-c1" },
      { company: { en: "Gulf Engineering Consultants" }, role: { en: "Consultant" }, stampKey: "stamp-k1" },
    ]);
    expect(data("owner").stamps.map((s) => s.role.en)).toEqual(["Main Contractor", "Consultant", "Owner"]);
  });
});

describe("the Review Comments", () => {
  it("are the issued Code's Comments, numbered through, under their author's card", () => {
    const [group, ...rest] = data("B").comments;
    expect(rest).toEqual([]);
    expect(group).toMatchObject({ author: { name: { en: "Huda Harbi" }, company: { en: "Gulf Engineering Consultants" } }, initials: { en: "HH" } });
    expect(group!.items.map((c) => [c.n, c.documentNumber, c.reference])).toEqual([
      [1, "RGT-CMT-EL-0041", "Spec 26 05 36, 3.2"],
      [2, "RGT-CMT-EL-0042", null],
      [3, "RGT-CMT-EL-0043", "Drawing E-12"],
    ]);
    expect(data("A").comments).toEqual([]);
  });

  it("give the initials of the first and last names", () => {
    expect(initialsOf("Huda Harbi")).toBe("HH");
    expect(initialsOf("Sara bint Ali Qahtani")).toBe("SQ");
    expect(initialsOf("هدى الحربي")).toBe("ها");
    expect(initialsOf("Madonna")).toBe("M");
  });
});

describe("the Disclaimer and the review duration", () => {
  it("print the Form Version's Disclaimer in the record's languages", () => {
    expect(data("A", "en").disclaimer?.en).toContain("issued electronically through Rabaed");
    expect(data("A", "ar").disclaimer).toEqual({ ar: expect.stringContaining("رابد") });
    expect(data("A", "bilingual").disclaimer).toEqual({ ar: expect.any(String), en: expect.any(String) });
    expect(recordDataOf({ ...goldenFacts("A", "en"), pdf: null }, verification).disclaimer).toBeNull();
  });

  it("count the calendar days in Riyadh from the Submission Date to the reply, only when the Form shows them", () => {
    // Submitted 12 Oct 09:15 Riyadh, closed 14 Oct 12:30 Riyadh.
    expect(data("A").reviewDays).toBe(2);
    expect(recordDataOf({ ...goldenFacts("A", "en"), pdf: { show_review_duration: false } }, verification).reviewDays).toBeNull();
    expect(recordDataOf({ ...goldenFacts("A", "en"), pdf: {} }, verification).reviewDays).toBeNull();
    // 23:30 Riyadh to 00:30 Riyadh the next day is one day; noon to 23:00 the same day none.
    expect(calendarDays("2026-10-12T20:30:00.000Z", "2026-10-12T21:30:00.000Z")).toBe(1);
    expect(calendarDays("2026-10-12T09:00:00.000Z", "2026-10-12T20:00:00.000Z")).toBe(0);
  });
});

describe("the Record Data of the pages after", () => {
  it("holds the cards, Comments, Stamps, Next step and Disclaimer, and no storage key", () => {
    const xml = recordDataXml(data("B", "bilingual"));
    for (const part of ["<cards>", '<card n="4"', "<verb lang=\"en\">Approved</verb>", "<comments>", '<comment n="3">', "<stamps>", "<disclaimer>", "<logo/>", "<signature/>", "<image/>"]) {
      expect(xml, part).toContain(part);
    }
    for (const key of ["sig-", "stamp-", "logo-", "photo-", "doc-"]) expect(xml, key).not.toContain(key);
    expect(recordDataXml(data("C"))).toMatch(/<nextStep revision="1">[\s\S]*Al Rashid Contracting[\s\S]*<\/nextStep>/);
    expect(recordDataXml(data("D"))).toContain('<replacement lang="en">A new submittal replaces this one</replacement>');
    expect(recordDataXml(data("A"))).toContain("<reviewDays>2</reviewDays>");
  });

  it("never names a Transition element outside the approval flow", () => {
    const xml = recordDataXml(data("B"));
    expect(xml.split("<transition ").length - 1).toBe(4);
  });
});
