import type { OutcomeFact, RecordFacts, TransitionFact } from "@rabaed/db";
import { deflateSync } from "node:zlib";
import type { RecordData } from "./record-data.ts";
import { recordOf, type RecordImages } from "./record-data.ts";

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

const png = (key: string) => ({ storageKey: key, contentType: "image/png" });
const owner = {
  participantId: "p-owner",
  name: t("Riyadh Metro Authority", "هيئة مترو الرياض"),
  roleName: t("Owner", "المالك"),
  baseRole: "owner" as const,
  logo: png("logo-owner"),
  stamp: png("stamp-owner"),
};
const consultant = {
  participantId: "p-k1",
  name: t("Gulf Engineering Consultants", "الخليج للاستشارات الهندسية"),
  roleName: t("Consultant", "استشاري"),
  baseRole: "consultant" as const,
  logo: png("logo-k1"),
  stamp: png("stamp-k1"),
};
// No logo: the record prints its name.
const contractor = {
  participantId: "p-c1",
  name: t("Al Rashid Contracting", "الراشد للمقاولات"),
  roleName: t("Main Contractor", "مقاول رئيسي"),
  baseRole: "contractor" as const,
  logo: null,
  stamp: png("stamp-c1"),
};

const person = (name: [string, string], position: [string, string], company: typeof owner | typeof consultant | typeof contractor, signature: string) => ({
  memberName: t(name[0], name[1]),
  positions: [t(position[0], position[1])],
  companyName: company.name,
  participantId: company.participantId,
  roleName: company.roleName,
  signature: png(signature),
});

interface StepExtras {
  readonly remarks?: string | null;
  /** The shared Action Form answers, and the Action Form they were given in. */
  readonly answers?: Record<string, unknown>;
  readonly actionForm?: unknown;
}

const step = (n: number, label: [string, string], who: ReturnType<typeof person>, kind: string, outcomeMode: string | null, extras: StepExtras = {}): TransitionFact => ({
  kind,
  fromStepId: `s${n}`,
  toStepId: `s${n + 1}`,
  label: t(label[0], label[1]),
  at: `2026-10-${String(10 + n).padStart(2, "0")}T0${5 + n}:30:00.000Z`,
  contentSha256: `${String(n).repeat(8)}${"ab12cd34".repeat(7)}`,
  outcomeMode,
  remarks: extras.remarks ?? null,
  answers: extras.answers ?? null,
  actionForm: extras.actionForm ?? null,
  ...who,
});

const sara = person(["Sara Qahtani", "سارة القحطاني"], ["Project Manager", "مدير المشروع"], contractor, "sig-sara");
const omar = person(["Omar Haddad", "عمر حداد"], ["Engineer", "مهندس"], contractor, "sig-omar");
const huda = person(["Huda Harbi", "هدى الحربي"], ["Manager", "مدير"], consultant, "sig-huda");
const faisal = person(["Faisal Otaibi", "فيصل العتيبي"], ["Engineer", "مهندس"], consultant, "sig-faisal");
const nora = person(["Nora Saud", "نورة السعود"], ["Project Manager", "مدير المشروع"], owner, "sig-nora");

/** A Code's Action Form, as the Rabaed Default Code Screens ask: the final verification and the Remarks; Code B its Comments too. */
const codeForm = (withComments: boolean) => ({
  sections: [
    {
      key: "final_verification",
      title: t("Final verification", "التحقق النهائي"),
      fields: [
        { key: "sample_checked", type: "yes_no", label: t("Sample checked", "تم فحص العينة") },
        { key: "remarks", type: "textarea", label: t("Remarks", "الملاحظات") },
        ...(withComments
          ? [
              {
                key: "items_to_create",
                type: "table",
                label: t("Comments", "الملاحظات للمعالجة"),
                columns: [
                  { key: "comment", type: "text", label: t("Comment", "الملاحظة") },
                  { key: "reference", type: "text", label: t("Reference", "المرجع") },
                ],
              },
            ]
          : []),
      ],
    },
  ],
});
const coverNoteForm = { sections: [{ key: "cover", title: t("Cover Note", "ملاحظة الإحالة"), fields: [{ key: "cover_note", type: "textarea", label: t("Cover Note", "ملاحظة الإحالة") }] }] };
const cancelForm = { sections: [{ key: "cancel", title: t("Cancel", "إلغاء"), fields: [{ key: "reason", type: "textarea", label: t("Reason", "السبب") }] }] };

const DISCLAIMER = t(
  "This record was issued electronically through Rabaed. Its approval does not relieve the Contractor of any obligation under the contract.",
  "صدر هذا السجل إلكترونيًا عبر رابد. ولا يُعفي اعتماده المقاول من أيٍّ من التزاماته بموجب العقد.",
);

/** A pen stroke, a logo or a Stamp in one ink, as an SVG data URL (no file needed). */
const svg = (body: string, w: number, h: number) =>
  `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`).toString("base64")}`;
const stroke = (ink: string, wave: number) =>
  svg(`<path d="M10 40 C 40 ${10 + wave} 60 ${70 - wave} 90 35 S 140 ${15 + wave} 170 40" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`, 180, 60);
const stamp = (ink: string) =>
  svg(`<circle cx="50" cy="50" r="45" fill="none" stroke="${ink}" stroke-width="4"/><circle cx="50" cy="50" r="30" fill="none" stroke="${ink}" stroke-width="2"/><path d="M30 50h40M50 30v40" stroke="${ink}" stroke-width="3"/>`, 100, 100);
const logo = (ink: string) => svg(`<rect x="4" y="8" width="40" height="32" rx="6" fill="${ink}"/><rect x="52" y="16" width="80" height="16" rx="3" fill="${ink}" opacity="0.6"/>`, 136, 48);

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
  ["sig-sara", stroke("#1f2a6b", 8)],
  ["sig-omar", stroke("#1f2a6b", 20)],
  ["sig-huda", stroke("#0b4f3a", 14)],
  ["sig-faisal", stroke("#3a2a6b", 26)],
  ["sig-nora", stroke("#5a1f1f", 4)],
  ["stamp-owner", stamp("#9b1c1c")],
  ["stamp-k1", stamp("#1f3a93")],
  ["stamp-c1", stamp("#146c43")],
  ["logo-owner", logo("#9b1c1c")],
  ["logo-k1", logo("#1f3a93")],
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
  raiserParticipantId: contractor.participantId,
  comments: [],
  pdf: { disclaimer: DISCLAIMER, show_review_duration: true },
  cancelledByRabaed: null,
};

const doc = (fileName: string, contentType: string, key: string, fieldKey: string | null, takenAt: string | null = null) => ({
  fileName,
  contentType,
  size: 1000,
  storageKey: key,
  sha256: null,
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


/** A Code's Transition, with its Remarks in its shared Action Form (and, with `comments`, Code B's table). */
const code = (n: number, label: [string, string], who: ReturnType<typeof person>, outcomeMode: string, remarks: string, comments?: { comment: string; reference?: string }[]) =>
  step(n, label, who, "close", outcomeMode, {
    remarks,
    answers: { sample_checked: true, remarks, ...(comments ? { items_to_create: comments } : {}) },
    actionForm: codeForm(comments !== undefined),
  });
const submit = (n: number) =>
  step(n, ["Submit", "تقديم"], sara, "submit", null, {
    answers: { cover_note: "Submitted with the manufacturer's datasheet and test certificate." },
    actionForm: coverNoteForm,
  });

const B_COMMENTS = [
  { comment: "Fix the trays at 1.5 m centres, not 2 m.", reference: "Spec 26 05 36, 3.2" },
  { comment: "Earth every tray section with a bonding jumper." },
  { comment: "Submit the fire-stopping detail where trays pass through walls.", reference: "Drawing E-12" },
];

export type GoldenCode = "A" | "B" | "C" | "D" | "owner" | "cancelled" | "rabaed-cancelled";

/**
 * The facts of a closed MAR (Code A, Code B with Comments, Cancelled), DAR (Code C; Code A
 * through the Owner's review) or DAS (Code D).
 */
export function goldenFacts(golden: GoldenCode, language: RecordData["language"]): RecordFacts {
  const common = { ...base, recordLanguage: language };
  if (golden === "A" || golden === "B" || golden === "cancelled" || golden === "rabaed-cancelled") {
    const closing =
      golden === "A"
        ? [
            step(3, ["Send to Manager", "إرسال للمدير"], faisal, "send", "recommend_code"),
            code(4, ["Approve · A", "اعتماد · A"], huda, "issue_code", "Approved as submitted.\nInstall to the approved shop drawings.\nKeep the manufacturer's labels visible after fixing."),
          ]
        : golden === "B"
          ? [
              step(3, ["Send to Manager", "إرسال للمدير"], faisal, "send", "recommend_code"),
              code(4, ["Approve with Comments · B", "اعتماد مع ملاحظات · B"], huda, "issue_code", "Approved with the Comments below.\nResolve each before the trays are covered.", B_COMMENTS),
            ]
          : [];
    return {
      ...common,
      ...(golden === "B"
        ? {
            reviewComments: B_COMMENTS.length,
            comments: B_COMMENTS.map((c, i) => ({
              documentNumber: `RGT-CMT-EL-00${41 + i}`,
              comment: c.comment,
              reference: c.reference ?? null,
              at: "2026-10-14T09:30:00.000Z",
              memberName: huda.memberName,
              positions: huda.positions,
              companyName: huda.companyName,
              roleName: huda.roleName,
              participantId: huda.participantId,
            })),
          }
        : {}),
      ...(golden === "rabaed-cancelled" ? { cancelledByRabaed: { companyName: contractor.name } } : {}),
      type: { code: "MAR", name: t("Material Approval Request", "طلب اعتماد مواد") },
      documentNumber: "RGT-MAR-EL-0012",
      revisionNo: 0,
      subject: "Cable tray 300 mm, galvanised, for Building A level 3",
      outcome: golden === "A" || golden === "B" ? golden : "cancelled",
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
      transitions:
        golden === "cancelled"
          ? [
              step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null),
              step(2, ["Cancel", "إلغاء"], sara, "cancel", null, {
                answers: { reason: "The supplier withdrew the product; a new request follows." },
                actionForm: cancelForm,
              }),
            ]
          : golden === "rabaed-cancelled"
            ? [step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null)]
            : [step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null), submit(2), ...closing],
    };
  }
  if (golden === "owner") {
    return {
      ...common,
      type: { code: "DAR", name: t("Drawing Approval Request", "طلب اعتماد مخططات") },
      documentNumber: "RGT-DAR-ST-0004",
      revisionNo: 0,
      subject: "Level 3 slab reinforcement, rev A",
      outcome: "A",
      closedAt: "2026-10-16T12:00:00.000Z",
      submittedAt: "2026-10-12T07:00:00.000Z",
      form: {
        sections: darForm.sections,
        answers: {
          discipline: "Structural",
          purpose: "For construction",
          register: [{ number: "RGT-ST-L3-201", title: "Level 3 slab bottom reinforcement", rev: "A" }],
          coordination: { clash: { answer: "yes" }, levels: { answer: "yes" }, legend: { answer: "yes" } },
        },
        optionLists: [],
        options: [],
        suppliers: [],
        companyNames: {},
      },
      documents: [doc("L3-slab-rev-a.pdf", "application/pdf", "doc-3", null)],
      transitions: [
        step(1, ["Send for Review", "إرسال للمراجعة"], omar, "send", null),
        submit(2),
        // The Consultant PM's Recommendation to the Owner: internal to the two, so no answers on the record.
        step(3, ["Recommend A", "التوصية بالرمز A"], huda, "submit", "recommend_code"),
        code(4, ["Confirm", "تأكيد"], nora, "confirm_code", "Confirmed as recommended by the Consultant."),
      ],
    };
  }
  if (golden === "C") {
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
        submit(2),
        code(3, ["Revise · C", "مراجعة · C"], huda, "issue_code", "Revise and resubmit.\nCoordinate the grid with the fire-fighting layout.\nShow the access panels."),
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
      submit(2),
      code(3, ["Reject · D", "رفض · D"], huda, "issue_code", "Rejected. The sequence conflicts with the approved temporary works design."),
    ],
  };
}

const PAGE_COUNTS = new Map([
  ["doc-1", 4],
  ["doc-2", 2],
  ["doc-3", 12],
  ["doc-4", 18],
]);
const VERIFICATION = { code: "7K2M-9QXD", link: "https://rabaed.test/verify/QmFzZTY0dXJsVG9rZW5Gb3JUaGVHb2xkZW5SZWNvcmQ" };

/** A golden record: its Record Data (a fixed Verification Code and link, the Documents' page counts) and where its images are. */
export function goldenRecord(
  golden: GoldenCode,
  language: RecordData["language"],
  /** The fingerprints of its images by storage key, as the job reads them (RP-155): none unless given. */
  fingerprints: ReadonlyMap<string, string> = new Map(),
): { data: RecordData; images: RecordImages } {
  return recordOf(goldenFacts(golden, language), VERIFICATION, PAGE_COUNTS, () => true, fingerprints);
}

/** The Record Data of a golden record. */
export function goldenData(golden: GoldenCode, language: RecordData["language"]): RecordData {
  return goldenRecord(golden, language).data;
}
