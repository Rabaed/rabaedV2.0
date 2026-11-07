import type { BilingualText } from "@rabaed/domain";
import type { Product, SampleInspection, SampleSnag, SampleSubmittal } from "./sample-project-plan.ts";
import type { SampleRecords } from "./sample-project.ts";

// The UAT Projects (RP-1246, RP-1248): one Project per role, so a tester signs in as one demo person
// and runs that person's whole section of the hand-run sheet without switching user. Every UAT Project
// has the same four Companies and the same people as the sample Project (RP-1217), and the same make
// (its Trades, Locations, suppliers and Checklist Templates). Each holds what its role's cases act on,
// already waiting at that role, and the other Companies' work the role must not see.
// The sheet (scripts/uat-sheet.ts) reads the roles from here, so its section titles name these Projects,
// and uat-projects-plan.test.ts checks that each case of a role names the items staged for it.
// Made up for the demo: no real people.

/** One role's UAT Project. */
export interface UatRole {
  /** Its number, as the sheet's `role` field on a case names it: "01". */
  n: string;
  /** The Project's code, in its Document Numbers. */
  code: string;
  /** The Project's name. */
  name: BilingualText;
  /** Who the tester signs in as: the demo person's first name, as the sheet's Who's who keys it. */
  person: string;
  /** That person's first name, in English and Arabic. */
  personName: BilingualText;
  /** What the seed stages in it, in the order it raises them (so each gets the Document Number planned for it). */
  staged: () => Staged[];
}

/**
 * One item the seed stages, and the sheet's cases that use it. `number` is the Document Number it is given when
 * it leaves Draft, in the order the seed raises them; none for a Draft, which the sheet names by its Subject.
 * `mustNotSee` marks another Company's work the role must not see: no case acts on it, its visibility cases look for it.
 */
export type Staged = { cases: string[]; number?: string; mustNotSee?: true } & (
  | { kind: "submittal"; item: SampleSubmittal }
  | { kind: "snag"; item: SampleSnag }
  | { kind: "inspection"; item: SampleInspection }
);

const product = (name: string, manufacturer: string, model: string, specificationSection: string, description: string, fixture: string, quantity: number, unit: string): Product => ({
  name,
  manufacturer,
  model,
  specificationSection,
  description,
  item: { fixture_type: fixture, description, quantity, unit },
});

/* eslint-disable rabaed/no-avoid-terms -- "panel" in these Subjects and products is electrical equipment (a control panel, a recessed panel light), not a Form Section. */
const P = {
  luminaires: product("Emergency luminaires", "Zumtobel", "RESCLITE PRO", "26 52 13", "LED emergency luminaires, 3-hour, self-test.", "Emergency luminaire", 85, "pcs"),
  downlights: product("LED downlights", "Philips", "CoreLine DN140B", "26 51 13", "Recessed LED downlights, 4000 K, 2000 lm.", "Downlight", 140, "pcs"),
  wiring: product("Wiring devices", "Legrand", "Arteor", "26 27 26", "Switches and sockets, white.", "Socket outlet", 420, "pcs"),
  smoke: product("Smoke detectors", "Honeywell", "Notifier FSP-951", "28 31 11", "Addressable photoelectric smoke detectors.", "Smoke detector", 260, "pcs"),
  trays: product("Cable trays", "Legrand", "Cablofil CF 54", "26 05 36", "Wire mesh cable trays, electro-zinc plated.", "Cable tray", 320, "m"),
  fireAlarm: product("Fire alarm control unit", "Honeywell", "Notifier NFS2-3030", "28 31 11", "Addressable fire alarm control unit.", "Fire alarm control unit", 1, "set"),
  cables: product("LV power cables", "Riyadh Cables", "XLPE/SWA/PVC 0.6/1 kV", "26 05 19", "Armoured copper power cables.", "Power cable", 2400, "m"),
  earthing: product("Earthing and lightning protection", "Furse", "Copper tape system", "26 41 13", "Lightning protection and earthing system.", "Earth rod", 24, "pcs"),
  mdb: product("Main distribution board", "Schneider Electric", "Prisma P", "26 24 13", "Main low voltage distribution board, 2500 A.", "Distribution board", 1, "set"),
  sdb: product("Sub-distribution boards", "ABB", "System pro E power", "26 24 16", "Floor sub-distribution boards with MCBs and RCBOs.", "Sub-distribution board", 6, "pcs"),
  exitSigns: product("Exit signs", "Thorn", "Voyager", "26 52 13", "LED exit signs, maintained, 3-hour duration.", "Exit sign", 24, "pcs"),
  controlPanel: product("Emergency lighting control panel", "Zumtobel", "ONLITE CPS", "26 52 13", "Central battery panel for the emergency luminaires and exit signs.", "Central battery panel", 1, "set"),
  lightingPanel: product("Lighting control panel", "Schneider Electric", "KNX SpaceLogic", "26 09 23", "Lighting control panel for the podium floors.", "Lighting control panel", 2, "set"),
  fixtures: product("Lighting fixtures", "Philips", "CoreLine Panel", "26 51 00", "", "Recessed panel", 200, "pcs"),
  generator: product("Standby generator", "Caterpillar", "C18", "26 32 13", "Diesel standby generator, 600 kVA.", "Generator", 1, "set"),
  transformers: product("Dry type transformers", "Siemens", "GEAFOL", "26 22 00", "Cast resin dry type transformers, 1600 kVA.", "Transformer", 2, "pcs"),
  switchgear: product("MV switchgear", "Schneider Electric", "SM AirSeT", "26 13 00", "Medium voltage switchgear panels.", "Switchgear panel", 5, "pcs"),
  busbar: product("Busbar trunking", "Legrand", "Zucchini SCP", "26 25 00", "Busbar trunking for the risers.", "Busbar", 120, "m"),
};

/** A Submittal of TMC's by default, on Electrical Works at a Floor of the make (sample-project-plan.ts). */
const mar = (title: string, location: string, end: SampleSubmittal["end"], product: Product, extra: Partial<SampleSubmittal> = {}): SampleSubmittal => ({
  title,
  type: "MAR",
  trade: "EL",
  location,
  end,
  product,
  ...(["code_a", "code_b", "code_c", "code_d", "with_consultant_manager"].includes(end) ? { consultantEngineer: "ahmed" as const } : {}),
  ...extra,
});

/** TMC's and Beta Build's MAR series on UAT 01. */
const tmc = (n: number) => `UAT01-MAR-01-${String(n).padStart(4, "0")}`;
const beta = (n: number) => `UAT01-MAR-02-${String(n).padStart(4, "0")}`;

/**
 * UAT 01, Hafiz (Contractor Engineer, TMC): what his cases act on, waiting at him, and what he must not see.
 * TMC's MARs are numbered in this order; Beta Build's own come between them, so VIS-39 sees TMC's run on with no gaps.
 */
function uat01(): Staged[] {
  const s = (cases: string[], item: SampleSubmittal, number?: string): Staged => ({ kind: "submittal", cases, item, ...(number ? { number } : {}) });
  /** Beta Build's own item, for VIS-19: Hafiz must not see it. */
  const betaHidden = (item: SampleSubmittal, number?: string): Staged => ({ ...s(["VIS-19"], { ...item, owner: "beta" }, number), mustNotSee: true });
  return [
    // Back with Hafiz after Ali's Return, each for one case that acts on it.
    s(["SUB-05"], mar("SUB-05 Emergency luminaires – returned by Ali", "A02", "returned", P.luminaires), tmc(1)),
    s(["SUB-06"], mar("SUB-06 LED downlights – change the Datasheet", "A03", "returned", P.downlights), tmc(2)),
    betaHidden(mar("Beta Build – standby generator, Draft", "P01", "draft", P.generator)),
    betaHidden(mar("Beta Build – dry type transformers, with Beta Build's PM", "P01", "with_pm", P.transformers), beta(1)),
    s(["WF-16"], mar("WF-16 Wiring devices – Cancel at your Step", "A04", "returned", P.wiring), tmc(3)),
    // Closed by Design Consultants: a Code D to replace, a Code C to revise, and records to download.
    s(["SUB-14"], mar("SUB-14 Smoke detectors – Code D", "A02", "code_d", P.smoke, { recommendedCode: "D" }), tmc(4)),
    s(["SUB-15"], mar("SUB-15 Cable trays – Code C", "A03", "code_c", P.trays, { recommendedCode: "C" }), tmc(5)),
    betaHidden(mar("Beta Build – MV switchgear, Submitted", "PGF", "with_consultant_engineer", P.switchgear), beta(2)),
    s(["SIG-05"], mar("SIG-05 Fire alarm control unit – Code C", "A05", "code_c", P.fireAlarm, { recommendedCode: "C" }), tmc(6)),
    s(["SIG-05"], mar("SIG-05 LV power cables – Code D", "A05", "code_d", P.cables, { recommendedCode: "D" }), tmc(7)),
    s(["SIG-05"], mar("SIG-05 Earthing – Cancelled", "A06", "cancelled", P.earthing), tmc(8)),
    // Read only, shared: closed at Code A; the Consultant's internal notes on a Code C; Submitted and still open.
    s(["SUB-17", "SUB-19", "INS-04"], mar("Main distribution board – Code A", "PB1", "code_a", P.mdb, { recommendedCode: "A", samplePhoto: true }), tmc(9)),
    betaHidden(mar("Beta Build – busbar trunking, Code A", "PGF", "code_a", P.busbar, { recommendedCode: "A" }), beta(3)),
    s(["VIS-04", "INS-04"], mar("VIS-04 Sub-distribution boards – Code C", "P01", "code_c", P.sdb, { recommendedCode: "C" }), tmc(10)),
    s(["FRM-07", "WF-16", "INS-04", "UX-06"], mar("Exit signs – Submitted to Design Consultants", "A02", "with_consultant_engineer", P.exitSigns), tmc(11)),
    s(["SUB-19", "FRM-05", "VIS-11"], mar("Emergency lighting control panel – Tower A Level 02", "A02", "with_consultant_engineer", P.controlPanel, { links: ["Main distribution board – Code A"] }), tmc(12)),
    // Drafts of Hafiz's own, one per case that changes it; the sheet names each by its Subject.
    s(["SUB-04"], mar("SUB-04 Lighting control panel – ready to send", "P01", "draft", P.lightingPanel)),
    s(["SUB-02"], mar("SUB-02 Lighting fixtures – incomplete", "A02", "draft", P.fixtures, { bare: true })),
    s(["SUB-03"], mar("SUB-03 Panel lights – to fill in", "A02", "draft", P.fixtures, { bare: true })),
    s(["SUB-16"], mar("SUB-16 Draft to delete", "A04", "draft", P.wiring)),
    s(["WF-16"], mar("WF-16 Draft to cancel", "A04", "draft", P.wiring)),
    s(["FRM-06"], mar("FRM-06 Draft for a photo from the phone", "A05", "draft", P.downlights)),
    s(["FRM-07"], mar("FRM-07 Draft whose Documents change", "A05", "draft", P.downlights)),
    s(["FRM-10"], mar("FRM-10 Draft for autosave", "A06", "draft", P.fixtures, { bare: true })),
    s(["INS-06"], mar("INS-06 Draft with a photo to annotate", "A06", "draft", P.luminaires, { samplePhoto: true })),
    s(["FRM-05", "VIS-11"], mar("Lighting control panel – Hafiz's own Draft", "P01", "draft", P.lightingPanel)),
    // Snags Design Consultants raised on TMC, Open with TMC (one sent back to Open by Ahmed), numbered in Design Consultants' series as raised.
    { kind: "snag", cases: ["SNG-03", "SNG-11"], number: "UAT01-SNG-03-0001", item: { title: "SNG-03 Loose cable tray cover", type: "SNG", trade: "EL", location: "A03", end: "open", raisedBy: "ahmed", description: "The cable tray cover is loose along the corridor. / غطاء حامل الكابلات غير مثبت على طول الممر." } },
    { kind: "snag", cases: ["SNG-04"], number: "UAT01-SNG-03-0002", item: { title: "SNG-04 Missing socket cover", type: "SNG", trade: "EL", location: "A04", end: "open", raisedBy: "ahmed", description: "A socket outlet has no cover plate. / مقبس بلا غطاء." } },
    { kind: "snag", cases: ["SNG-04"], number: "UAT01-SNG-03-0003", item: { title: "SNG-04 Unlabelled circuit breakers – back to Open", type: "SNG", trade: "EL", location: "A05", end: "returned_to_open", raisedBy: "ahmed", description: "The sub-distribution board's breakers carry no labels. / قواطع اللوحة الفرعية بلا ملصقات." } },
    { kind: "snag", cases: ["SNG-08", "UX-24"], number: "UAT01-SNG-03-0004", item: { title: "SNG-08 Cracked light diffuser", type: "SNG", trade: "EL", location: "A06", end: "open", raisedBy: "ahmed", description: "A downlight diffuser is cracked. / غطاء ناشر الضوء مكسور.", photos: 1 } },
    { kind: "snag", cases: ["VIS-19"], mustNotSee: true, item: { title: "Design Consultants – Draft snag, not raised", type: "SNG", trade: "EL", location: "A03", end: "draft", raisedBy: "ahmed", description: "A Draft of Design Consultants' own. / مسودة خاصة بالمصممين الاستشاريين." } },
    // Work Inspection Requests of TMC's: one still a Draft, one Submitted.
    { kind: "inspection", cases: ["INS-05"], item: { title: "INS-05 Cable containment Level 04 – Draft", owner: "tmc", trade: "EL", location: "A04", end: "draft", description: "Cable containment on Tower A Level 04, ready for inspection." } },
    { kind: "inspection", cases: ["INS-05"], number: "UAT01-WIR-01-0001", item: { title: "INS-05 Cable containment Level 05 – Submitted", owner: "tmc", trade: "EL", location: "A05", end: "with_consultant_engineer", description: "Cable containment on Tower A Level 05, ready for inspection." } },
  ];
}

/* eslint-enable rabaed/no-avoid-terms */

export const UAT_ROLES: UatRole[] = [
  {
    n: "01",
    code: "UAT01",
    name: { en: "UAT 01 · Contractor Engineer (Hafiz)", ar: "UAT 01 · مهندس المقاول (حافظ)" },
    person: "hafiz",
    personName: { en: "Hafiz", ar: "حافظ" },
    staged: uat01,
  },
];

/** What the seed builds for a role's Project: its staged items, in order; a UAT Project has no Packages. */
export function uatRecords(role: UatRole): SampleRecords {
  const staged = role.staged();
  return {
    submittals: staged.flatMap((x) => (x.kind === "submittal" ? [x.item] : [])),
    snags: staged.flatMap((x) => (x.kind === "snag" ? [x.item] : [])),
    inspections: staged.flatMap((x) => (x.kind === "inspection" ? [x.item] : [])),
    packages: [],
  };
}
