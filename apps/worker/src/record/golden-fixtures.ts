import type { OutcomeFact, RecordFacts, TransitionFact } from "@rabaed/db";
import { deflateSync } from "node:zlib";
import type { RecordData } from "./record-data.ts";
import { recordDataOf } from "./record-data.ts";

// Records of fixed facts for the golden screenshots (golden.test.ts): a Material
// Approval Request closed at Code A, a Drawing Approval Request at Code C and a
// Document Approval Sheet at Code D, each a Form of its own. The people, Companies
// and times are made up. They stand in for the owner's MAR, DAR and DAS samples,
// which are not in the repository.

const t = (en: string, ar: string) => ({ en, ar });

const outcomes: OutcomeFact[] = [
  { code: "A", name: t("Approved", "معتمد"), polarity: "positive", actions: [] },
  { code: "B", name: t("Approved with Comments", "معتمد مع ملاحظات"), polarity: "positive", actions: [{ kind: "create_items", type: "CMT" }] },
  { code: "C", name: t("Revise and Resubmit", "يُراجع ويُعاد تقديمه"), polarity: "negative", actions: [{ kind: "offer_revision" }] },
  { code: "D", name: t("Rejected", "مرفوض"), polarity: "negative", actions: [{ kind: "offer_replacement" }] },
];

const owner = { participantId: "p-owner", name: t("Riyadh Metro Authority", "هيئة مترو الرياض"), roleName: t("Owner", "المالك"), baseRole: "owner" as const };
const consultant = { participantId: "p-k1", name: t("Gulf Engineering Consultants", "الخليج للاستشارات الهندسية"), roleName: t("Consultant", "استشاري"), baseRole: "consultant" as const };
const contractor = { participantId: "p-c1", name: t("Al Rashid Contracting", "الراشد للمقاولات"), roleName: t("Main Contractor", "مقاول رئيسي"), baseRole: "contractor" as const };

const person = (name: [string, string], position: [string, string], company: typeof consultant | typeof contractor) => ({
  memberName: t(name[0], name[1]),
  positions: [t(position[0], position[1])],
  companyName: company.name,
  participantId: company.participantId,
  roleName: company.roleName,
});

const step = (n: number, label: [string, string], who: ReturnType<typeof person>, kind: string, outcomeMode: string | null, remarks: string | null = null): TransitionFact => ({
  kind,
  fromStepId: `s${n}`,
  toStepId: `s${n + 1}`,
  label: t(label[0], label[1]),
  at: `2026-10-${String(10 + n).padStart(2, "0")}T0${5 + n}:30:00.000Z`,
  contentSha256: `${String(n).repeat(8)}${"ab12cd34".repeat(7)}`,
  outcomeMode,
  remarks,
  ...who,
});

const sara = person(["Sara Qahtani", "سارة القحطاني"], ["Project Manager", "مدير المشروع"], contractor);
const omar = person(["Omar Haddad", "عمر حداد"], ["Engineer", "مهندس"], contractor);
const huda = person(["Huda Harbi", "هدى الحربي"], ["Manager", "مدير"], consultant);

const tinyPhoto = (r: number, g: number, b: number): string => {
  const width = 8;
  const height = 6;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set([r, g, b], y * (width * 3 + 1) + 1 + x * 3);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
};

/** The photo images of the fixtures, by storage key. */
export const fixtureImages: ReadonlyMap<string, string> = new Map([
  ["photo-1", tinyPhoto(214, 189, 152)],
  ["photo-2", tinyPhoto(150, 168, 190)],
  ["photo-3", tinyPhoto(171, 196, 160)],
]);

const base = {
  projectId: "project",
  workItemId: "item",
  hijriDates: false,
  recordLanguage: "bilingual" as const,
  projectName: t("Riyadh Gate Tower", "برج بوابة الرياض"),
  reviewComments: 0,
  outcomes,
  location: [t("Building A", "المبنى أ"), t("Level 3", "الدور الثالث")],
  scopes: [t("Cable containment", "حوامل الكابلات")],
  trades: [
    { name: t("Civil", "مدني"), selected: false },
    { name: t("Electrical", "كهرباء"), selected: true },
    { name: t("Mechanical", "ميكانيكا"), selected: false },
    { name: t("Plumbing", "سباكة"), selected: false },
  ],
  companies: [owner, consultant, contractor],
  revisionOf: null,
};

const doc = (fileName: string, contentType: string, key: string, fieldKey: string | null, takenAt: string | null = null) => ({
  fileName,
  contentType,
  size: 1000,
  storageKey: key,
  fieldKey,
  itemKey: null,
  takenAt,
});

const marForm = {
  sections: [
    {
      key: "material",
      title: t("Material details", "تفاصيل المادة"),
      fields: [
        { key: "manufacturer", type: "text", label: t("Manufacturer", "المصنّع") },
        { key: "model", type: "text", label: t("Model", "الطراز") },
        { key: "quantity", type: "number", unit: "m", decimals: 1, label: t("Quantity", "الكمية") },
        { key: "certified", type: "yes_no", label: t("Certified", "معتمد") },
        { key: "delivery", type: "date", label: t("Delivery date", "تاريخ التوريد") },
        { key: "notes", type: "textarea", label: t("Notes", "ملاحظات") },
        { key: "datasheet", type: "attachments", label: t("Datasheet", "الكتالوج") },
      ],
    },
    {
      key: "quantities",
      title: t("Quantities", "الكميات"),
      fields: [
        {
          key: "lines",
          type: "table",
          label: t("Bill of quantities", "جدول الكميات"),
          columns: [
            { key: "item", type: "text", label: t("Item", "البند") },
            { key: "count", type: "number", total: true, label: t("Count", "العدد") },
          ],
        },
      ],
    },
    {
      key: "site",
      title: t("Site photos", "صور الموقع"),
      fields: [{ key: "photos", type: "photos", label: t("Photos of the delivered material", "صور المادة الموردة") }],
    },
  ],
};

const darForm = {
  sections: [
    {
      key: "drawing",
      title: t("Drawing register", "سجل المخططات"),
      fields: [
        { key: "discipline", type: "text", label: t("Discipline", "التخصص") },
        { key: "purpose", type: "textarea", label: t("Purpose of issue", "الغرض من الإصدار") },
        {
          key: "register",
          type: "table",
          label: t("Drawings", "المخططات"),
          columns: [
            { key: "number", type: "text", label: t("Drawing number", "رقم المخطط") },
            { key: "title", type: "text", label: t("Title", "العنوان") },
            { key: "rev", type: "text", label: t("Revision", "المراجعة") },
          ],
        },
      ],
    },
    {
      key: "checks",
      title: t("Coordination checks", "فحوصات التنسيق"),
      fields: [
        {
          key: "coordination",
          type: "checklist",
          label: t("Coordination", "التنسيق"),
          items: [
            { key: "clash", text: t("No clashes with the MEP model", "لا تعارض مع نموذج الأنظمة"), answers: "yes_no_na" },
            { key: "levels", text: t("Levels match the architectural set", "المناسيب مطابقة للمخططات المعمارية"), answers: "yes_no_na" },
            { key: "legend", text: t("Legend and symbols as specified", "المفتاح والرموز كما هو محدد"), answers: "yes_no_na" },
          ],
        },
      ],
    },
  ],
};

const dasForm = {
  sections: [
    {
      key: "document",
      title: t("Document", "المستند"),
      fields: [
        { key: "title", type: "text", label: t("Document title", "عنوان المستند") },
        { key: "kind", type: "text", label: t("Kind", "النوع") },
        { key: "pages", type: "number", label: t("Pages", "عدد الصفحات") },
        { key: "summary", type: "textarea", label: t("Summary", "الملخص") },
      ],
    },
  ],
};


export type GoldenCode = "A" | "C" | "D";

/** The facts of a closed MAR (Code A), DAR (Code C) or DAS (Code D). */
export function goldenFacts(code: GoldenCode, language: RecordData["language"]): RecordFacts {
  const common = { ...base, recordLanguage: language };
  if (code === "A") {
    return {
      ...common,
      type: { code: "MAR", name: t("Material Approval Request", "طلب اعتماد مواد") },
      documentNumber: "RGT-MAR-EL-0012",
      revisionNo: 0,
      subject: "Cable tray 300 mm, galvanised, for Building A level 3",
      outcome: "A",
      closedAt: "2026-10-14T09:30:00.000Z",
      submittedAt: "2026-10-12T06:15:00.000Z",
      form: {
        sections: marForm.sections,
        answers: {
          manufacturer: "Gulf Cable Systems",
          model: "GCS-300-HDG",
          quantity: 640.5,
          certified: true,
          delivery: "2026-11-02",
          notes: "Delivered in two lots, the second after the level 3 slab is cured.",
          lines: [
            { item: "Cable tray 300 mm, 3 m length", count: 214 },
            { item: "Bracket, galvanised", count: 860 },
            { item: "Coupler plate", count: 428 },
          ],
        },
        optionLists: [],
        options: [],
        suppliers: [],
        companyNames: {},
      },
      documents: [
        doc("datasheet-gcs-300.pdf", "application/pdf", "doc-1", "datasheet"),
        doc("test-certificate.pdf", "application/pdf", "doc-2", "datasheet"),
        doc("sample-1.jpg", "image/jpeg", "photo-1", "photos", "2026-10-09T08:12:00.000Z"),
        doc("sample-2.jpg", "image/jpeg", "photo-2", "photos", "2026-10-09T08:14:00.000Z"),
        doc("sample-3.jpg", "image/jpeg", "photo-3", "photos", "2026-10-09T08:20:00.000Z"),
      ],
      transitions: [
        step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null),
        step(2, ["Submit", "تقديم"], sara, "submit", null),
        step(3, ["Send to Manager", "إرسال للمدير"], huda, "send", null),
        step(4, ["Approve · A", "اعتماد · A"], huda, "close", "issue_code", "Approved as submitted.\nInstall to the approved shop drawings.\nKeep the manufacturer's labels visible after fixing."),
      ],
    };
  }
  if (code === "C") {
    return {
      ...common,
      type: { code: "DAR", name: t("Drawing Approval Request", "طلب اعتماد مخططات") },
      documentNumber: "RGT-DAR-AR-0007",
      revisionNo: 0,
      subject: "Level 3 ceiling layout, rev B",
      outcome: "C",
      closedAt: "2026-10-15T10:00:00.000Z",
      submittedAt: "2026-10-12T07:00:00.000Z",
      reviewComments: 3,
      form: {
        sections: darForm.sections,
        answers: {
          discipline: "Architectural",
          purpose: "For construction",
          register: [
            { number: "RGT-AR-L3-101", title: "Level 3 reflected ceiling plan", rev: "B" },
            { number: "RGT-AR-L3-102", title: "Ceiling details", rev: "A" },
          ],
          coordination: { clash: { answer: "yes" }, levels: { answer: "yes" }, legend: { answer: "no", comment: "Legend not updated to rev B" } },
        },
        optionLists: [],
        options: [],
        suppliers: [],
        companyNames: {},
      },
      documents: [doc("L3-ceiling-rev-b.pdf", "application/pdf", "doc-3", null)],
      transitions: [
        step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null),
        step(2, ["Submit", "تقديم"], sara, "submit", null),
        step(3, ["Revise · C", "مراجعة · C"], huda, "close", "issue_code", "Revise and resubmit.\nCoordinate the grid with the fire-fighting layout.\nShow the access panels."),
      ],
    };
  }
  return {
    ...common,
    type: { code: "DAS", name: t("Document Approval Sheet", "نموذج اعتماد مستند") },
    documentNumber: "RGT-DAS-QA-0003",
    revisionNo: 1,
    revisionOf: { documentNumber: "RGT-DAS-QA-0003", closedAt: "2026-10-08T11:00:00.000Z", outcome: "C" },
    subject: "Method statement for the concrete pour, level 3",
    outcome: "D",
    closedAt: "2026-10-16T08:45:00.000Z",
    submittedAt: "2026-10-13T06:00:00.000Z",
    form: {
      sections: dasForm.sections,
      answers: {
        title: "Concrete pour method statement, level 3 slab",
        kind: "Method statement",
        pages: 18,
        summary: "Pour sequence, pump positions, curing and the hold points for inspection.",
      },
      optionLists: [],
      options: [],
      suppliers: [],
      companyNames: {},
    },
    documents: [doc("method-statement-l3.pdf", "application/pdf", "doc-4", null)],
    transitions: [
      step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null),
      step(2, ["Submit", "تقديم"], sara, "submit", null),
      step(3, ["Reject · D", "رفض · D"], huda, "close", "issue_code", "Rejected. The sequence conflicts with the approved temporary works design."),
    ],
  };
}

/** The Record Data of a golden record, with a fixed Verification Code and link, and the Documents' page counts. */
export function goldenData(code: GoldenCode, language: RecordData["language"]): RecordData {
  return recordDataOf(goldenFacts(code, language), { code: "7K2M-9QXD", link: "https://rabaed.test/verify/QmFzZTY0dXJsVG9rZW5Gb3JUaGVHb2xkZW5SZWNvcmQ" }, new Map([
    ["doc-1", 4],
    ["doc-2", 2],
    ["doc-3", 12],
    ["doc-4", 18],
  ]));
}
