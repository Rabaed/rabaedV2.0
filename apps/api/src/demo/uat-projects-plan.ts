import type { BilingualText } from "@rabaed/domain";
import type { Product, SampleDar, SampleDraft, SampleInspection, SamplePackage, SampleSnag, SampleSubmittal } from "./sample-project-plan.ts";
import type { SamplePeople, SampleRecords } from "./sample-project.ts";

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
  /** Its Packages (RP-1249), put together after its items, from them and from Drafts of their own; none when left out. */
  packages?: () => UatPackage[];
  /** Its own changes to the sample's people (RP-1250), beside Omar, whom every UAT Project adds (uatPeople). */
  people?: SamplePeople;
}

/** One Package the seed puts together, and the sheet's cases that use it, which name it by its name. */
export interface UatPackage {
  cases: string[];
  package: SamplePackage;
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
  | { kind: "dar"; item: SampleDar }
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
  // Mechanical Works, which Sara covers too: an item of it waits in the Consultant Engineers' pool of two (RP-1249).
  fanCoils: product("Fan coil units", "Trane", "FCD", "23 82 19", "Ducted fan coil units, 3-speed EC motor.", "Fan coil unit", 180, "pcs"),
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

/** A UAT Project's Document Number series: TMC's (Participant Code 01), Beta Build's (02) and Design Consultants' (03), by Type. */
const series = (code: string, type: "MAR" | "SAR" | "DAR" | "SNG" | "WIR", participant: "01" | "02" | "03") => (n: number) => `${code}-${type}-${participant}-${String(n).padStart(4, "0")}`;

/** A staged Submittal for `cases`. */
const s = (cases: string[], item: SampleSubmittal, number?: string): Staged => ({ kind: "submittal", cases, item, ...(number ? { number } : {}) });
/** Another Company's Submittal, or TMC's before its Submit, that the role must not see: its visibility `cases` look for it. */
const hidden = (cases: string[], item: SampleSubmittal, number?: string): Staged => ({ ...s(cases, item, number), mustNotSee: true });

/**
 * UAT 01, Hafiz (Contractor Engineer, TMC): what his cases act on, waiting at him, and what he must not see.
 * TMC's MARs are numbered in this order; Beta Build's own come between them, so VIS-39 sees TMC's run on with no gaps.
 */
function uat01(): Staged[] {
  const tmc = series("UAT01", "MAR", "01");
  const beta = series("UAT01", "MAR", "02");
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

/** A Draft of a Package's own: never sent, so no Document Number. */
const packageDraft = (title: string, location: string, p: Product): SampleDraft => ({ title, trade: "EL", location, product: p });

/** A Package of TMC's, which Ali puts together. */
const tmcPackage = (en: string, ar: string, status: SamplePackage["status"], existing: string[], drafts: SampleDraft[] = []): SamplePackage => ({ name: { en, ar }, owner: "tmc", status, existing, submitted: [], drafts });

/**
 * UAT 02, Ali (Contractor Project Manager, TMC): items waiting at his Step to Submit or move, Submitted and closed items to
 * read, download and Watch, Drafts and Packages to put together, Snags held by TMC, and Beta Build's work he must not see.
 */
function uat02(): Staged[] {
  const tmc = series("UAT02", "MAR", "01");
  const beta = series("UAT02", "MAR", "02");
  const snag = series("UAT02", "SNG", "03");
  return [
    // With Ali in Internal Review, each for one case that moves it.
    s(["SUB-07"], mar("SUB-07 Wiring devices – ready to Submit", "A02", "with_pm", P.wiring), tmc(1)),
    s(["SIG-01"], mar("SIG-01 Cable trays – Submit in its pop-up", "A03", "with_pm", P.trays), tmc(2)),
    s(["SUB-25"], mar("SUB-25 Emergency luminaires – move on the Kanban", "A04", "with_pm", P.luminaires), tmc(3)),
    hidden(["VIS-57"], mar("Beta Build – standby generator, Draft", "P01", "draft", P.generator, { owner: "beta" })),
    hidden(["VIS-57"], mar("Beta Build – dry type transformers, with Beta Build's PM", "P01", "with_pm", P.transformers, { owner: "beta" }), beta(1)),
    // Submitted to Design Consultants, read only: Watch, the workflow map, a Working Copy.
    s(["SUB-18", "SUB-22", "WF-02", "SIG-16", "VIS-25", "VIS-38"], mar("Exit signs – Submitted to Design Consultants", "A02", "with_consultant_engineer", P.exitSigns), tmc(4)),
    // In the In Progress Package PKG-08 reads: one still with Design Consultants, one closed at Code B with two Comments open with TMC.
    s(["PKG-08"], mar("PKG-08 Fire alarm control unit – Submitted, in a Package", "A05", "with_consultant_engineer", P.fireAlarm), tmc(5)),
    s(["PKG-11", "SNG-06"], mar("PKG-11 Lighting control panel – Code B", "P01", "code_b", P.lightingPanel, {
      recommendedCode: "B",
      comments: [
        { comment: "Submit the factory test certificates before delivery: lighting control panel.", reference: "Datasheet p. 2", end: "open" },
        { comment: "Show the cable entry on the shop drawing: lighting control panel.", reference: "Shop drawing", end: "open" },
      ],
    }), tmc(6)),
    // Closed by Design Consultants, read only: the Documental Records.
    s(["SIG-02", "SIG-03", "SIG-08", "SIG-12", "SIG-13", "VIS-08", "UX-26"], mar("Main distribution board – Code A", "PB1", "code_a", P.mdb, { recommendedCode: "A", samplePhoto: true }), tmc(7)),
    s(["SIG-12", "VIS-20"], mar("Sub-distribution boards – Code C", "P01", "code_c", P.sdb, { recommendedCode: "C" }), tmc(8)),
    s(["SIG-12"], mar("LV power cables – Code D", "A05", "code_d", P.cables, { recommendedCode: "D" }), tmc(9)),
    hidden(["VIS-57"], mar("Beta Build – MV switchgear, Submitted", "PGF", "with_consultant_engineer", P.switchgear, { owner: "beta" }), beta(2)),
    s(["PKG-03"], mar("PKG-03 Smoke detectors – in Internal Review", "A06", "with_pm", P.smoke), tmc(10)),
    // In the In Progress Package PKG-07 adds to and renames.
    s(["PKG-07"], mar("PKG-07 Cable trays – Submitted, in a Package", "A04", "with_consultant_engineer", P.trays), tmc(11)),
    // Hafiz's Drafts, which TMC reads: one to download, one whose Subject reads as a formula, and those for the Packages.
    s(["SUB-18"], mar("SUB-18 LED downlights – TMC Draft", "A03", "draft", P.downlights)),
    s(["SUB-24"], mar("=1+1 SUB-24 Subject that looks like a formula", "A04", "draft", P.fixtures)),
    s(["PKG-03"], mar("PKG-03 Earthing – Draft 1", "A06", "draft", P.earthing)),
    s(["PKG-03"], mar("PKG-03 Busbar trunking – Draft 2", "A06", "draft", P.busbar)),
    s(["PKG-05"], mar("PKG-05 Lighting fixtures – Datasheet missing", "A02", "draft", P.fixtures, { bare: true })),
    s(["PKG-07"], mar("PKG-07 Wiring devices – Draft to add", "A03", "draft", P.wiring)),
    // Snags Design Consultants raised on TMC, Open with TMC.
    { kind: "snag", cases: ["SNG-12", "SNG-15"], number: snag(1), item: { title: "SNG-12 Loose cable tray cover", type: "SNG", trade: "EL", location: "A03", end: "open", raisedBy: "ahmed", description: "The cable tray cover is loose along the corridor. / غطاء حامل الكابلات غير مثبت على طول الممر.", photos: 1 } },
    { kind: "snag", cases: ["SNG-12", "SNG-15"], number: snag(2), item: { title: "SNG-12 Missing socket cover", type: "SNG", trade: "EL", location: "A04", end: "open", raisedBy: "ahmed", description: "A socket outlet has no cover plate. / مقبس بلا غطاء." } },
  ];
}

/**
 * UAT 02's Packages, TMC's, one for each Package case that changes one, so they run in any order: four Open (one empty,
 * one only holding a Draft another Package can't take), two In Progress (one to add to and rename, one to read).
 */
function uat02Packages(): UatPackage[] {
  return [
    { cases: ["PKG-03"], package: tmcPackage("PKG-03 Package to fill", "PKG-03 حزمة للتعبئة", "open", []) },
    { cases: ["PKG-03"], package: tmcPackage("PKG-03 Package holding a Draft", "PKG-03 حزمة فيها مسودة", "open", [], [packageDraft("PKG-03 Wiring devices – in another Package", "A05", P.wiring)]) },
    {
      cases: ["PKG-04"],
      package: tmcPackage("PKG-04 Package to change", "PKG-04 حزمة للتعديل", "open", [], [packageDraft("PKG-04 Wiring devices – in the Package", "A05", P.wiring), packageDraft("PKG-04 LED downlights – in the Package", "A05", P.downlights)]),
    },
    { cases: ["PKG-05"], package: tmcPackage("PKG-05 Package to submit", "PKG-05 حزمة للتقديم", "open", [], [packageDraft("PKG-05 Exit signs – ready Draft", "A06", P.exitSigns)]) },
    { cases: ["PKG-07"], package: tmcPackage("PKG-07 Package to add to", "PKG-07 حزمة للإضافة إليها", "in_progress", ["PKG-07 Cable trays – Submitted, in a Package"]) },
    {
      cases: ["PKG-01", "PKG-08", "PKG-11", "UX-23"],
      package: tmcPackage("PKG-08 Package in progress", "PKG-08 حزمة قيد التنفيذ", "in_progress", ["PKG-08 Fire alarm control unit – Submitted, in a Package", "PKG-11 Lighting control panel – Code B"]),
    },
  ];
}

/** UAT 03, Saeed (Project Admin, TMC's Authorized Person): Project Settings only, so one item, whose number puts TMC's Participant Code in use. */
function uat03(): Staged[] {
  return [s(["PAR-10"], mar("PAR-10 Cable trays – numbered with TMC's code", "A02", "with_consultant_engineer", P.trays), series("UAT03", "MAR", "01")(1))];
}

/**
 * UAT 04, Ahmed (Consultant Engineer, Design Consultants): items Submitted to Design Consultants and waiting at him (an
 * Electrical one is his at once; a Mechanical one waits in the pool he shares with Sara), Inspections to carry out, a
 * Snag TMC resolved back with him to Verify, and TMC's and Beta Build's internal work he must not see.
 */
function uat04(): Staged[] {
  const tmc = series("UAT04", "MAR", "01");
  const beta = series("UAT04", "MAR", "02");
  const snag = series("UAT04", "SNG", "03");
  const wir = series("UAT04", "WIR", "01");
  return [
    s(["SUB-09", "NOT-02"], mar("SUB-09 Emergency lighting control panel – with you", "A02", "with_consultant_engineer", P.controlPanel, { samplePhoto: true }), tmc(1)),
    s(["SUB-10"], mar("SUB-10 Smoke detectors – send to the Manager", "A03", "with_consultant_engineer", P.smoke), tmc(2)),
    s(["FRM-08"], mar("FRM-08 Sub-distribution boards – the reply Screens", "A04", "with_consultant_engineer", P.sdb), tmc(3)),
    s(["SUB-08"], mar("SUB-08 Fan coil units – in the Engineers' pool", "A05", "with_consultant_engineer", P.fanCoils, { trade: "ME" }), tmc(4)),
    // Read only, for VIS-23: one in the Engineers' pool (SUB-08 picks up its own), one closed at Code B whose Comment waits in TMC's pool.
    s(["VIS-23"], mar("VIS-23 Fan coil units – stays in the Engineers' pool", "A06", "with_consultant_engineer", P.fanCoils, { trade: "ME" }), tmc(5)),
    s(["VIS-23"], mar("VIS-23 Wiring devices – Code B, Comments with TMC", "A06", "code_b", P.wiring, {
      recommendedCode: "B",
      comments: [{ comment: "Confirm the socket heights with the Architect: wiring devices.", reference: "Room finishes drawing", end: "open" }],
    }), tmc(6)),
    // TMC's own, before the Submit, and Beta Build's: none of it reaches Design Consultants (V1). TMC's item in Internal Review
    // takes TMC's last number, so the numbers Ahmed reads (0001 to 0006) run on with no gap.
    hidden(["VIS-01"], mar("TMC – cable trays, in Internal Review", "A06", "with_pm", P.trays), tmc(7)),
    hidden(["VIS-01"], mar("TMC – wiring devices, Draft not sent", "A06", "draft", P.wiring)),
    hidden(["VIS-01"], mar("Beta Build – standby generator, Draft", "P01", "draft", P.generator, { owner: "beta" })),
    hidden(["VIS-01"], mar("Beta Build – dry type transformers, with Beta Build's PM", "P01", "with_pm", P.transformers, { owner: "beta" }), beta(1)),
    // Raised by Ahmed on TMC: one resolved by TMC, back with him at Verify; one still Open with TMC.
    { kind: "snag", cases: ["VIS-51", "UX-17"], number: snag(1), item: { title: "VIS-51 Unlabelled circuit breakers – resolved by TMC", type: "SNG", trade: "EL", location: "A05", end: "resolved", raisedBy: "ahmed", description: "The sub-distribution board's breakers carry no labels. / قواطع اللوحة الفرعية بلا ملصقات." } },
    { kind: "snag", cases: ["UX-17"], number: snag(2), item: { title: "UX-17 Cracked light diffuser", type: "SNG", trade: "EL", location: "A06", end: "open", raisedBy: "ahmed", description: "A downlight diffuser is cracked. / غطاء ناشر الضوء مكسور.", photos: 1 } },
    // TMC's Work Inspection Requests, Submitted and picked up by Ahmed, each for one case that answers its Checklist.
    { kind: "inspection", cases: ["INS-09", "INS-07", "INS-14"], number: wir(1), item: { title: "INS-09 Cable containment Level 03 – inspect on site", owner: "tmc", trade: "EL", location: "A03", end: "with_consultant_engineer", consultantEngineer: "ahmed", description: "Cable containment on Tower A Level 03, ready for inspection." } },
    { kind: "inspection", cases: ["UX-18"], number: wir(2), item: { title: "UX-18 Cable containment Level 04 – on a phone", owner: "tmc", trade: "EL", location: "A04", end: "with_consultant_engineer", consultantEngineer: "ahmed", description: "Cable containment on Tower A Level 04, ready for inspection." } },
  ];
}

/**
 * UAT 05, Mohammed (Consultant Manager, Design Consultants): Submittals and WIRs waiting at him with Ahmed's Recommended Code,
 * one item for each Code case; two in a TMC Package for the bulk Code; and a Code C whose Revision is still inside TMC.
 */
function uat05(): Staged[] {
  const tmc = series("UAT05", "MAR", "01");
  const wir = series("UAT05", "WIR", "01");
  const atManager = (title: string, location: string, p: Product, code: "A" | "B" | "C" | "D") => mar(title, location, "with_consultant_manager", p, { recommendedCode: code });
  const inspection = (cases: string[], n: number, title: string, location: string, code: "A" | "B" | "C" | "D", failing: string[] = []): Staged => ({
    kind: "inspection",
    cases,
    number: wir(n),
    item: { title, owner: "tmc", trade: "EL", location, end: "with_consultant_manager", recommendedCode: code, ...(failing.length ? { failing } : {}), description: `${title}: ready for inspection.` },
  });
  return [
    s(["SUB-11"], atManager("SUB-11 Main distribution board – recommended Code A", "PB1", P.mdb, "A"), tmc(1)),
    s(["SUB-12"], atManager("SUB-12 Lighting control panel – recommended Code B", "P01", P.lightingPanel, "B"), tmc(2)),
    s(["SUB-13"], atManager("SUB-13 LED downlights – Return to Engineer", "A02", P.downlights, "C"), tmc(3)),
    s(["SUB-13"], atManager("SUB-13 Smoke detectors – Code C needs Remarks", "A03", P.smoke, "C"), tmc(4)),
    s(["PKG-09"], atManager("PKG-09 Exit signs – bulk Code A", "A04", P.exitSigns, "A"), tmc(5)),
    s(["PKG-09"], atManager("PKG-09 Wiring devices – bulk Code A", "A05", P.wiring, "A"), tmc(6)),
    // A Supplier Approval Request waiting at him for Code A, which adds its supplier to the Approved Supplier List.
    s(["SUB-20"], {
      title: "SUB-20 Delta Cables – Supplier Approval Request",
      type: "SAR",
      trade: "EL",
      location: "A02",
      end: "with_consultant_manager",
      product: P.cables,
      supplier: { name: { en: "UAT SUB-20 Delta Cables", ar: "UAT SUB-20 دلتا للكابلات" }, crNumber: "1010000201", country: "Saudi Arabia", supply: "Low voltage power cables for Tower A." },
      consultantEngineer: "ahmed",
      recommendedCode: "A",
    }, series("UAT05", "SAR", "01")(1)),
    // Closed at Code C; TMC raised its Rev 1 and sent it for review, so it is in TMC's Internal Review, which Mohammed must not see (V1).
    s(["VIS-12"], mar("VIS-12 Cable trays – Code C, Rev 1 inside TMC", "A06", "code_c", P.trays, { recommendedCode: "C", revision: "with_pm" }), tmc(7)),
    hidden(["VIS-12"], mar("TMC – earthing, Draft not sent", "A06", "draft", P.earthing)),
    hidden(["VIS-12"], mar("Beta Build – standby generator, Draft", "P01", "draft", P.generator, { owner: "beta" })),
    // WIRs with Ahmed's Recommended Code: two to read the proposed Code, four to close at A, B, C and D.
    inspection(["INS-11"], 1, "INS-11 Cable containment Level 02 – all passed", "A02", "A"),
    inspection(["INS-11"], 2, "INS-11 Cable containment Level 03 – one failed", "A03", "C", ["labels"]),
    inspection(["INS-12"], 3, "INS-12 Cable containment Level 04 – for Code A", "A04", "A"),
    inspection(["INS-12"], 4, "INS-12 Cable containment Level 05 – for Code B", "A05", "B"),
    inspection(["INS-12"], 5, "INS-12 Cable containment Level 06 – for Code C", "A06", "C", ["supports"]),
    inspection(["INS-12"], 6, "INS-12 Cable containment Podium Level 01 – for Code D", "P01", "D", ["supports", "earthing"]),
  ];
}

/** UAT 05's Package: TMC's, In Progress, its two items waiting at Mohammed for the same Code. */
function uat05Packages(): UatPackage[] {
  return [{ cases: ["PKG-09"], package: tmcPackage("PKG-09 Package waiting at the Manager", "PKG-09 حزمة لدى المدير", "in_progress", ["PKG-09 Exit signs – bulk Code A", "PKG-09 Wiring devices – bulk Code A"]) }];
}

/**
 * UAT 06, Layla (Design Consultants' Authorized Person): her cases are her Company's Members, Positions and Visibility
 * and its Company Projects, so the Project holds no items. Its people do the work instead (uatPeople): Design
 * Consultants covers Electrical and Mechanical only, never Civil, and only Ahmed is on it, on Electrical, so no Member
 * covers Mechanical (the gap VIS-35 warns of) and Sara and Mohammed are on every UAT Project but this one (V15).
 */
function uat06(): Staged[] {
  return [];
}

/** A staged DAR for `cases`, waiting at the Owner's review (RP-1250). */
const dar = (cases: string[], item: SampleDar, number: string): Staged => ({ kind: "dar", cases, item, number });

/**
 * UAT 07, Noura (Al Waha's Project Manager, the Owner Representative): DARs waiting at her Owner's review, one per case
 * that acts on it; TMC's Submitted and closed items, which Al Waha reads as oversight; and TMC's work before its Submit,
 * which she must not see (V1).
 */
function uat07(): Staged[] {
  const tmc = series("UAT07", "MAR", "01");
  const dars = series("UAT07", "DAR", "01");
  return [
    s(["VIS-07", "I18N-03"], mar("Main distribution board – Code A", "PB1", "code_a", P.mdb, { recommendedCode: "A" }), tmc(1)),
    s(["VIS-02", "I18N-03"], mar("VIS-02 Exit signs – Submitted to Design Consultants", "A02", "with_consultant_engineer", P.exitSigns, { links: ["Main distribution board – Code A"] }), tmc(2)),
    // TMC's own before its Submit: its item in Internal Review takes TMC's last number, so Noura's run 0001 to 0002 with no gap.
    hidden(["VIS-02"], mar("TMC – cable trays, in Internal Review", "A06", "with_pm", P.trays), tmc(3)),
    hidden(["VIS-02"], mar("TMC – wiring devices, Draft not sent", "A06", "draft", P.wiring)),
    dar(["SUB-21"], { title: "SUB-21 Cable schedule – recommended Code A", trade: "EL", location: "A03", documentType: "report", recommendedCode: "A", end: "with_owner" }, dars(1)),
    dar(["VIS-24"], {
      title: "VIS-24 Lighting calculation – recommended Code B",
      trade: "EL",
      location: "A04",
      documentType: "calculation",
      recommendedCode: "B",
      comments: [{ comment: "Show the emergency lighting levels on the escape routes: lighting calculation.", reference: "Calculation p. 3" }],
      end: "with_owner",
    }, dars(2)),
  ];
}

/**
 * UAT 08, Yousef (Beta Build, the second Contractor): Beta Build's own items, his to read, count and act on, and TMC's
 * work in the same Trades and Locations, which he must never see (V3): its submittals at every Stage, a Code B whose
 * Comments are Open with TMC, a SAR whose supplier is on the Approved Supplier List, and Snags held by TMC.
 */
function uat08(): Staged[] {
  const tmc = series("UAT08", "MAR", "01");
  const beta = series("UAT08", "MAR", "02");
  const dcl = series("UAT08", "SNG", "03");
  const tmcSnag = series("UAT08", "SNG", "01");
  return [
    // Beta Build's own: his Draft, one with him as its PM, one Submitted to Design Consultants.
    s(["VIS-18"], mar("VIS-18 Beta Build – earthing, your Draft", "A04", "draft", P.earthing, { owner: "beta" })),
    s(["VIS-18"], mar("VIS-18 Beta Build – busbar trunking, with you as PM", "A05", "with_pm", P.busbar, { owner: "beta" }), beta(1)),
    s(["VIS-18"], mar("VIS-18 Beta Build – MV switchgear, Submitted", "PGF", "with_consultant_engineer", P.switchgear, { owner: "beta" }), beta(2)),
    // TMC's, in the same Trade and Locations: none of it reaches Beta Build.
    hidden(["VIS-18"], mar("TMC – downlights, Submitted", "A04", "with_consultant_engineer", P.downlights), tmc(1)),
    hidden(["VIS-05"], mar("TMC – lighting control panel, Code B", "P01", "code_b", P.lightingPanel, {
      recommendedCode: "B",
      comments: [{ comment: "Submit the factory test certificates before delivery: lighting control panel, UAT 08.", reference: "Datasheet p. 2", end: "open" }],
    }), tmc(2)),
    hidden(["VIS-45"], {
      title: "TMC – Delta Cables, Supplier Approval Request",
      type: "SAR",
      trade: "EL",
      location: "A02",
      end: "code_a",
      product: P.cables,
      supplier: { name: { en: "UAT 08 Delta Cables", ar: "UAT 08 دلتا للكابلات" }, crNumber: "1010000801", country: "Saudi Arabia", supply: "Low voltage power cables for Tower A." },
      consultantEngineer: "ahmed",
      recommendedCode: "A",
    }, series("UAT08", "SAR", "01")(1)),
    // TMC's last number: its item in Internal Review.
    hidden(["VIS-18"], mar("TMC – smoke detectors, in Internal Review", "A05", "with_pm", P.smoke), tmc(3)),
    hidden(["VIS-18"], mar("TMC – wiring devices, Draft not sent", "A05", "draft", P.wiring)),
    // Snags held by TMC: raised by Design Consultants (one In Progress, one Returned to Open) and by TMC on itself, Closed.
    { kind: "snag", cases: ["VIS-50"], mustNotSee: true, number: dcl(1), item: { title: "TMC – unlabelled breakers, In Progress with TMC", type: "SNG", trade: "EL", location: "A05", end: "in_progress", raisedBy: "ahmed", description: "The sub-distribution board's breakers carry no labels. / قواطع اللوحة الفرعية بلا ملصقات.", photos: 1 } },
    { kind: "snag", cases: ["VIS-52"], mustNotSee: true, number: dcl(2), item: { title: "TMC – loose cable tray cover, Returned to Open", type: "SNG", trade: "EL", location: "A03", end: "returned_to_open", raisedBy: "ahmed", description: "The cable tray cover is loose along the corridor. / غطاء حامل الكابلات غير مثبت على طول الممر." } },
    { kind: "snag", cases: ["VIS-53"], mustNotSee: true, number: tmcSnag(1), item: { title: "TMC – missing socket cover, raised by TMC, Closed", type: "SNG", trade: "EL", location: "A04", end: "closed", raisedBy: "hafiz", description: "A socket outlet has no cover plate. / مقبس بلا غطاء." } },
  ];
}

/**
 * UAT 09, Omar (TMC's Contractor Engineer on the Podium only, as Riyadh Gate Tower narrows him to Tower 2): a Podium
 * item Ali Returned to Hafiz, who sent it; a Podium item linking a Tower A one he can't see; and Beta Build's item at
 * the same Location, which he must not see (V3).
 */
function uat09(): Staged[] {
  const tmc = series("UAT09", "MAR", "01");
  const beta = series("UAT09", "MAR", "02");
  return [
    s(["WF-12"], mar("WF-12 Lighting control panel – returned by Ali to Hafiz", "P01", "returned", P.lightingPanel), tmc(1)),
    hidden(["VIS-09"], mar("VIS-09 Exit signs – Tower A Level 02, Submitted", "A02", "with_consultant_engineer", P.exitSigns), tmc(2)),
    s(["VIS-09"], mar("VIS-09 Emergency lighting control panel – Podium, links the exit signs", "PGF", "with_consultant_engineer", P.controlPanel, { links: ["VIS-09 Exit signs – Tower A Level 02, Submitted"] }), tmc(3)),
    hidden(["VIS-09"], mar("Beta Build – MV switchgear, Podium, Submitted", "PGF", "with_consultant_engineer", P.switchgear, { owner: "beta" }), beta(1)),
  ];
}

/**
 * UAT 10, Sara (Design Consultants' Engineer on Mechanical only, RP-1207): TMC's Mechanical items, Submitted and in the
 * Engineers' pool she shares with Ahmed, and its Electrical ones beside them, which she must not see; one Mechanical item
 * links an Electrical one; and a Package of each Trade.
 */
function uat10(): Staged[] {
  const tmc = series("UAT10", "MAR", "01");
  const me = { trade: "ME" as const };
  return [
    hidden(["PAR-15"], mar("PAR-15 Wiring devices – Electrical, Submitted", "A02", "with_consultant_engineer", P.wiring), tmc(1)),
    s(["PAR-15"], mar("PAR-15 Fan coil units – Mechanical, in the Engineers' pool", "A03", "with_consultant_engineer", P.fanCoils, me), tmc(2)),
    hidden(["VIS-47"], mar("VIS-47 Main distribution board – Electrical, Code A", "PB1", "code_a", P.mdb, { recommendedCode: "A" }), tmc(3)),
    s(["VIS-47"], mar("VIS-47 Fan coil units – links the distribution board", "A04", "with_consultant_engineer", P.fanCoils, { ...me, links: ["VIS-47 Main distribution board – Electrical, Code A"] }), tmc(4)),
    hidden(["PKG-12"], mar("PKG-12 Smoke detectors – Electrical, in a Package", "A05", "with_consultant_engineer", P.smoke), tmc(5)),
    s(["PKG-12"], mar("PKG-12 Fan coil units – Mechanical, in a Package", "A06", "with_consultant_engineer", P.fanCoils, me), tmc(6)),
  ];
}

/** UAT 10's Packages, TMC's: one In Progress with an item of each Trade, and one Open with a Draft only, which Design Consultants never sees. */
function uat10Packages(): UatPackage[] {
  return [
    { cases: ["PKG-12"], package: tmcPackage("PKG-12 Package of both Trades", "PKG-12 حزمة بتخصصين", "in_progress", ["PKG-12 Smoke detectors – Electrical, in a Package", "PKG-12 Fan coil units – Mechanical, in a Package"]) },
    { cases: ["PKG-12"], package: tmcPackage("PKG-12 Package of Drafts", "PKG-12 حزمة مسودات", "open", [], [{ ...packageDraft("PKG-12 Fan coil units – Draft", "A06", P.fanCoils), trade: "ME" }]) },
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
  {
    n: "02",
    code: "UAT02",
    // eslint-disable-next-line rabaed/no-avoid-terms -- the Contractor PM's Position, as GLOSSARY.md's Position entry names it.
    name: { en: "UAT 02 · Contractor Project Manager (Ali)", ar: "UAT 02 · مدير مشروع المقاول (علي)" },
    person: "ali",
    personName: { en: "Ali", ar: "علي" },
    staged: uat02,
    packages: uat02Packages,
  },
  {
    n: "03",
    code: "UAT03",
    name: { en: "UAT 03 · Project Admin (Saeed)", ar: "UAT 03 · مسؤول المشروع (سعيد)" },
    person: "saeed",
    personName: { en: "Saeed", ar: "سعيد" },
    staged: uat03,
  },
  {
    n: "04",
    code: "UAT04",
    name: { en: "UAT 04 · Consultant Engineer (Ahmed)", ar: "UAT 04 · مهندس الاستشاري (أحمد)" },
    person: "ahmed",
    personName: { en: "Ahmed", ar: "أحمد" },
    staged: uat04,
  },
  {
    n: "05",
    code: "UAT05",
    name: { en: "UAT 05 · Consultant Manager (Mohammed)", ar: "UAT 05 · مدير الاستشاري (محمد)" },
    person: "mohammed",
    personName: { en: "Mohammed", ar: "محمد" },
    staged: uat05,
    packages: uat05Packages,
  },
  {
    n: "06",
    code: "UAT06",
    name: { en: "UAT 06 · Consultant Authorized Person (Layla)", ar: "UAT 06 · مفوّض الاستشاري (ليلى)" },
    person: "layla",
    personName: { en: "Layla", ar: "ليلى" },
    staged: uat06,
    people: { participants: { layla: { trades: ["EL", "ME"] } }, leaveOff: ["sara", "mohammed"], grants: { ahmed: { trades: ["EL"] } } },
  },
  {
    n: "07",
    code: "UAT07",
    name: { en: "UAT 07 · Owner Representative (Noura)", ar: "UAT 07 · ممثل المالك (نورة)" },
    person: "noura",
    personName: { en: "Noura", ar: "نورة" },
    staged: uat07,
  },
  {
    n: "08",
    code: "UAT08",
    name: { en: "UAT 08 · Rival Contractor (Yousef)", ar: "UAT 08 · المقاول المنافس (يوسف)" },
    person: "yousef",
    personName: { en: "Yousef", ar: "يوسف" },
    staged: uat08,
  },
  {
    n: "09",
    code: "UAT09",
    name: { en: "UAT 09 · Contractor Engineer, Podium only (Omar)", ar: "UAT 09 · مهندس المقاول، المنصة فقط (عمر)" },
    person: "omar",
    personName: { en: "Omar", ar: "عمر" },
    staged: uat09,
  },
  {
    n: "10",
    code: "UAT10",
    name: { en: "UAT 10 · Consultant Engineer, Mechanical only (Sara)", ar: "UAT 10 · مهندسة الاستشاري، الميكانيكا فقط (سارة)" },
    person: "sara",
    personName: { en: "Sara", ar: "سارة" },
    staged: uat10,
    packages: uat10Packages,
  },
];

/**
 * Omar on every UAT Project (RP-1250): TMC's second Contractor Engineer, on the Podium only, as Riyadh Gate Tower narrows
 * him to Tower 2. The sample Project leaves him off.
 */
const OMAR: NonNullable<SamplePeople["add"]>[number] = { who: "omar", company: "saeed", positions: ["engineer"], grant: { locations: ["PD"] } };

/** A role's Project's people where they differ from the sample's: Omar on all of them, and the role's own changes. */
export function uatPeople(role: UatRole): SamplePeople {
  return { ...role.people, add: [OMAR, ...(role.people?.add ?? [])] };
}

/** What the seed builds for a role's Project: its staged items, in order, then its Packages (none when it has none). */
export function uatRecords(role: UatRole): SampleRecords {
  const staged = role.staged();
  return {
    submittals: staged.flatMap((x) => (x.kind === "submittal" ? [x.item] : [])),
    snags: staged.flatMap((x) => (x.kind === "snag" ? [x.item] : [])),
    inspections: staged.flatMap((x) => (x.kind === "inspection" ? [x.item] : [])),
    dars: staged.flatMap((x) => (x.kind === "dar" ? [x.item] : [])),
    packages: (role.packages?.() ?? []).map((p) => p.package),
  };
}
