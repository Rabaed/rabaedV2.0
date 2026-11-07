import type { BilingualText } from "@rabaed/domain";

// The sample Project's records (RP-1217), as data: what each item is and where it ends. The
// runner (sample-project.ts) takes every item there through the api's own routes, as the demo's
// people. The counts are the owner's (RP-1217, 2026-11-02), as the Contractor's List reads them:
// 12 in Internal Review (new items and Revisions, with the Contractor PM or back with the Contractor
// Engineer), 10 Revise and Resubmit (Code C), 50 Pending Approval with the Consultant, 26 closed at
// Code A or B, 5 Rejected (Code D). The List shows a Revision chain as its latest item.
// Made up for the demo: no real people; the manufacturers are the kind a construction submittal names.

export const SAMPLE_PROJECT = {
  code: "NKD",
  name: { en: "Al Nakheel District – Block A", ar: "مجمع النخيل – المبنى أ" } satisfies BilingualText,
} as const;

export type TradeCode = "EL" | "ME" | "CV";

export const SAMPLE_TRADES: { code: TradeCode; name: BilingualText }[] = [
  { code: "EL", name: { en: "Electrical Works", ar: "الأعمال الكهربائية" } },
  { code: "ME", name: { en: "Mechanical Works", ar: "الأعمال الميكانيكية" } },
  { code: "CV", name: { en: "Civil Works", ar: "الأعمال المدنية" } },
];

export interface SampleLocation {
  code: string;
  name: BilingualText;
  parent: string | null;
}

/** Zone → Building → Floor, parents first. */
export const SAMPLE_LOCATIONS: SampleLocation[] = [
  { code: "BA", name: { en: "Block A", ar: "المبنى أ" }, parent: null },
  { code: "PD", name: { en: "Podium", ar: "المنصة" }, parent: "BA" },
  { code: "TA", name: { en: "Tower A", ar: "البرج أ" }, parent: "BA" },
  { code: "PB1", name: { en: "Podium Basement 1", ar: "المنصة القبو 1" }, parent: "PD" },
  { code: "PGF", name: { en: "Podium Ground Floor", ar: "المنصة الطابق الأرضي" }, parent: "PD" },
  { code: "P01", name: { en: "Podium Level 01", ar: "المنصة الطابق 01" }, parent: "PD" },
  ...["02", "03", "04", "05", "06"].map((n) => ({ code: `A${n}`, name: { en: `Tower A Level ${n}`, ar: `البرج أ الطابق ${n}` }, parent: "TA" })),
];

/** The Floors, where items are. */
const FLOORS = SAMPLE_LOCATIONS.filter((l) => /^(P(B1|GF|01)|A0\d)$/.test(l.code));

/** Each Trade's Approved Supplier List: the MAR Form's supplier field offers only these. */
export const SAMPLE_SUPPLIERS: Record<TradeCode, BilingualText> = {
  EL: { en: "Qassim Electrical Trading", ar: "القصيم للتجارة الكهربائية" },
  ME: { en: "Gulf HVAC Supplies", ar: "الخليج لتوريدات التكييف" },
  CV: { en: "Eastern Province Building Materials", ar: "المنطقة الشرقية لمواد البناء" },
};

export interface Product {
  name: string;
  manufacturer: string;
  model: string;
  specificationSection: string;
  description: string;
  item: { fixture_type: string; description: string; quantity: number; unit: string };
}

const product = (name: string, manufacturer: string, model: string, specificationSection: string, description: string, fixture: string, quantity: number, unit: string): Product => ({
  name,
  manufacturer,
  model,
  specificationSection,
  description,
  item: { fixture_type: fixture, description, quantity, unit },
});

const PRODUCTS: Record<TradeCode, Product[]> = {
  EL: [
    product("LED downlights", "Philips", "CoreLine DN140B", "26 51 13", "Recessed LED downlights, 4000 K, 2000 lm.", "Downlight", 140, "pcs"),
    product("Main distribution board", "Schneider Electric", "Prisma P", "26 24 13", "Main low voltage distribution board, 2500 A.", "Distribution board", 1, "set"),
    product("Sub-distribution boards", "ABB", "System pro E power", "26 24 16", "Floor sub-distribution boards with MCBs and RCBOs.", "Sub-distribution board", 6, "pcs"),
    product("Cable trays", "Legrand", "Cablofil CF 54 HDG", "26 05 36", "Wire mesh cable trays, hot dip galvanised.", "Cable tray", 320, "m"),
    product("LV power cables", "Riyadh Cables", "XLPE/SWA/PVC 0.6/1 kV", "26 05 19", "Armoured copper power cables.", "Power cable", 2400, "m"),
    product("Fire alarm control unit", "Honeywell", "Notifier NFS2-3030", "28 31 11", "Addressable fire alarm control unit.", "Fire alarm control unit", 1, "set"),
    product("Smoke detectors", "Honeywell", "Notifier FSP-951", "28 31 11", "Addressable photoelectric smoke detectors.", "Smoke detector", 260, "pcs"),
    product("Emergency luminaires", "Zumtobel", "RESCLITE PRO", "26 52 13", "LED emergency luminaires, 3-hour, self-test.", "Emergency luminaire", 85, "pcs"),
    product("Wiring devices", "Legrand", "Arteor", "26 27 26", "Switches and sockets, white.", "Socket outlet", 420, "pcs"),
    product("Earthing and lightning protection", "Furse", "Copper tape system", "26 41 13", "Lightning protection and earthing system.", "Earth rod", 24, "pcs"),
    product("Standby generator", "Caterpillar", "C18 600 kVA", "26 32 13", "Diesel standby generator with acoustic enclosure.", "Generator", 1, "set"),
    product("Busbar trunking", "Siemens", "SIVACON 8PS LI", "26 25 00", "Rising mains busbar trunking, 1600 A.", "Busbar", 90, "m"),
  ],
  ME: [
    product("Chilled water pumps", "Grundfos", "NKG 150-125", "23 21 23", "End suction chilled water pumps with VFD.", "Pump", 4, "pcs"),
    product("Air handling units", "Carrier", "39HQ", "23 73 13", "Double skin air handling units with heat recovery.", "AHU", 6, "pcs"),
    product("Fan coil units", "Trane", "FCD", "23 82 19", "Ducted fan coil units, 3-speed EC motor.", "Fan coil unit", 180, "pcs"),
    product("Ductwork insulation", "Armacell", "Armaflex AF", "23 07 13", "Closed cell elastomeric duct insulation, 25 mm.", "Insulation", 2600, "m2"),
    product("Chilled water piping", "Mueller", "ASTM A53 black steel", "23 21 13", "Black steel chilled water pipes and fittings.", "Pipe", 1800, "m"),
    product("Fire sprinklers", "Viking", "VK302", "21 13 13", "Quick response pendent sprinklers, 68 °C.", "Sprinkler", 950, "pcs"),
    product("Fire pumps", "Grundfos", "Hydro MX 1/1", "21 30 00", "Electric and diesel fire pump set with jockey pump.", "Fire pump set", 1, "set"),
    product("Domestic water booster set", "Wilo", "SiBoost Smart 3", "22 11 23", "Variable speed booster set, three pumps.", "Booster set", 1, "set"),
    product("PP-R water supply pipes", "Aquatherm", "green pipe SDR 6", "22 11 16", "PP-R pipes and fittings for cold and hot water.", "PP-R pipe", 2200, "m"),
    product("Drainage pipes", "Geberit", "Silent-db20", "22 13 16", "Sound insulated drainage pipes and fittings.", "Drainage pipe", 1300, "m"),
    product("Kitchen extract fans", "Systemair", "MUB 062", "23 34 16", "Insulated extract fan boxes for the kitchen.", "Extract fan", 8, "pcs"),
    product("BMS controllers", "Johnson Controls", "Metasys NAE", "25 14 13", "Building management system field controllers.", "Controller", 24, "pcs"),
  ],
  CV: [
    product("Ready mix concrete C40", "Saudi Readymix", "C40/50 OPC", "03 31 00", "Ready mix concrete for the podium slabs, six pours.", "Slab pour", 6, "set"),
    product("Reinforcement steel", "SABIC Hadeed", "ASTM A615 Gr 60", "03 21 00", "Deformed reinforcement bars, 10 to 32 mm, 12 m lengths.", "Rebar", 420, "pcs"),
    product("Waterproofing membrane", "Sika", "SikaProof A+", "07 13 26", "Pre-applied membrane for the basement raft.", "Membrane", 3200, "m2"),
    product("Blockwork", "Al-Rajhi Blocks", "200 mm hollow block", "04 22 00", "Hollow concrete blocks, 200 mm, 7 N/mm².", "Block", 26000, "pcs"),
    product("Porcelain floor tiles", "Saudi Ceramics", "Stone Grey 60x60", "09 30 13", "Porcelain floor tiles, R10 slip resistance.", "Tile", 4800, "m2"),
    product("Gypsum board ceilings", "Knauf", "Diamond Board 12.5", "09 21 16", "Suspended gypsum board ceilings.", "Ceiling", 3500, "m2"),
    product("Aluminium curtain wall", "Schüco", "FWS 50", "08 44 13", "Unitised curtain wall, double glazed.", "Curtain wall", 2100, "m2"),
    product("Fire rated doors", "Assa Abloy", "FD60", "08 11 13", "60-minute fire rated steel doors with hardware.", "Door", 64, "pcs"),
    product("Precast hollow core slabs", "Precast Arabia", "HC 265", "03 41 13", "Precast prestressed hollow core slabs.", "Slab", 1400, "m2"),
    product("Epoxy floor coating", "Fosroc", "Nitoflor FC150", "09 67 23", "Epoxy coating for the plant rooms.", "Coating", 900, "m2"),
    product("Thermal insulation boards", "Kingspan", "Kooltherm K10", "07 21 13", "Rigid phenolic insulation boards for the roof.", "Insulation board", 1200, "m2"),
    product("Interlocking pavers", "Al-Jazeera Pavers", "80 mm Holland", "32 14 13", "Interlocking concrete pavers for the site road.", "Paver", 2600, "m2"),
  ],
};

/** Where a Submittal ends in the seed. */
export type SubmittalEnd =
  /** Internal Review: sent for review, with the Contractor PM. */
  | "with_pm"
  /** Internal Review: returned by the PM, back with the Contractor Engineer. */
  | "returned"
  /** Pending Approval: Submitted, with the Consultant Engineer. */
  | "with_consultant_engineer"
  /** Pending Approval: reviewed, with the Consultant Manager. */
  | "with_consultant_manager"
  | "code_a"
  | "code_b"
  /** Revise and Resubmit. */
  | "code_c"
  /** Rejected. */
  | "code_d"
  /** A UAT Project's (RP-1248): still a Draft, never sent. */
  | "draft"
  /** A UAT Project's (RP-1248): sent for review, then Cancelled by the PM. */
  | "cancelled";

/** The demo people the seed acts as, by their key in seed.ts. */
export type ConsultantEngineer = "ahmed" | "sara";

export interface SampleSubmittal {
  title: string;
  type: "MAR" | "SAR";
  trade: TradeCode;
  /** A Floor's code. */
  location: string;
  end: SubmittalEnd;
  product: Product;
  /** SAR only: the supplier it asks to approve. */
  supplier?: { name: BilingualText; crNumber: string; country: string; supply: string };
  /** The Consultant Engineer who picks it up (from Pending Approval on); none leaves it in their Step Pool. */
  consultantEngineer?: ConsultantEngineer;
  /** Code C only: its Rev 1 is raised and sent for review, in Internal Review with the PM, or `returned` to the Engineer. */
  revision?: "with_pm" | "returned";
  /** From the Consultant Engineer on: the Code they recommend to the Manager (the Code issued, once there is one). */
  recommendedCode?: "A" | "B" | "C" | "D";
  /**
   * Code B only: the Comments its Code raises in the Snag List (each row's comment is its Subject),
   * and the Stage each is left at: Open with the Contractor, or resolved by them, then closed.
   */
  comments?: { comment: string; reference: string; end: "open" | "resolved" | "closed" }[];
  /** With a Sample photo besides its Datasheet. */
  samplePhoto?: boolean;
  /** Its raising Contractor; TMC when left out. A UAT Project's rival items are Beta Build's (RP-1248). */
  owner?: "tmc" | "beta";
  /** The Subjects of Submitted items it links, as Related submittals and as free Links, while a Draft (RP-1248). */
  links?: string[];
  /** A Draft with its Manufacturer, supplier, Trade and Location only: no Description, Items or Datasheet (RP-1248). */
  bare?: boolean;
}

const COUNTS: [SubmittalEnd, number][] = [
  ["with_pm", 4],
  ["returned", 4],
  // 10 read Revise and Resubmit on the List; the List shows a chain as its latest item, so the
  // other 4 read as their Rev 1, in Internal Review.
  ["code_c", 14],
  ["with_consultant_engineer", 34],
  ["with_consultant_manager", 16],
  ["code_a", 16],
  ["code_b", 10],
  ["code_d", 5],
];
/** How many Code C items get a Rev 1 (in Internal Review): 4 + 4 + 4 = the owner's 12. */
const REVISED = 4;

const SAR_SUPPLIERS: NonNullable<SampleSubmittal["supplier"]>[] = [
  { name: { en: "Hail Switchgear Factory", ar: "مصنع حائل للوحات الكهربائية" }, crNumber: "1010000101", country: "Saudi Arabia", supply: "Low voltage switchgear and distribution boards for Block A." },
  { name: { en: "Najran Cooling Systems", ar: "نجران لأنظمة التبريد" }, crNumber: "1010000102", country: "Saudi Arabia", supply: "Fan coil units and chilled water valves for Tower A." },
  { name: { en: "Yanbu Precast Industries", ar: "ينبع للصناعات الخرسانية الجاهزة" }, crNumber: "1010000103", country: "Saudi Arabia", supply: "Precast hollow core slabs and stair flights for the podium." },
  { name: { en: "Asir Glass and Aluminium", ar: "عسير للزجاج والألمنيوم" }, crNumber: "1010000104", country: "Saudi Arabia", supply: "Curtain wall and glazing for the Tower A facade." },
  { name: { en: "Jazan Pipe Company", ar: "شركة جازان للأنابيب" }, crNumber: "1010000105", country: "Saudi Arabia", supply: "PP-R and drainage pipes for the Tower A risers." },
];
/** Which items are SARs: their index in the list, one per supplier above. */
const SAR_AT = new Set([0, 21, 45, 70, 92]);

const TRADES: TradeCode[] = ["EL", "ME", "CV"];

const B_COMMENTS = [
  { comment: "Submit the factory test certificates before delivery.", reference: "Datasheet p. 2" },
  { comment: "Confirm the colour with the Architect before ordering.", reference: "Room finishes drawing" },
  { comment: "Show the inspection hatches on the shop drawing.", reference: "Shop drawing" },
];

/** The Code each closed end issues; the items still with the Manager carry a spread of Recommended Codes. */
const CODES: Partial<Record<SubmittalEnd, "A" | "B" | "C" | "D">> = { code_a: "A", code_b: "B", code_c: "C", code_d: "D" };

const COMMENT_ENDS = ["open", "resolved", "closed"] as const;

/** The `n`th Code B's Comments: one or two, each naming `what`, so every Subject is the Project's only one. */
function commentsOf(n: number, what: string): NonNullable<SampleSubmittal["comments"]> {
  const rows = n % 3 === 0 ? 2 : 1;
  return Array.from({ length: rows }, (_, i) => {
    const c = B_COMMENTS[(n + i) % B_COMMENTS.length]!;
    return { comment: `${c.comment.replace(/\.$/, "")}: ${what}.`, reference: c.reference, end: COMMENT_ENDS[(n + i) % COMMENT_ENDS.length]! };
  });
}

/** The 103 Submittals and where each ends; 4 Code C items also get a Rev 1. */
export function sampleSubmittals(): SampleSubmittal[] {
  const ends = COUNTS.flatMap(([end, n]) => Array.from({ length: n }, () => end));
  const used = new Map<TradeCode, number>();
  let revised = 0;
  let codeB = 0;
  let engineerPicks = 0;
  return ends.map((end, index) => {
    const trade = TRADES[index % TRADES.length]!;
    const nth = used.get(trade) ?? 0;
    used.set(trade, nth + 1);
    const products = PRODUCTS[trade];
    const p = products[nth % products.length]!;
    const floor = FLOORS[(nth + Math.floor(nth / products.length)) % FLOORS.length]!;
    const sar = SAR_AT.has(index) ? SAR_SUPPLIERS[[...SAR_AT].indexOf(index)] : undefined;
    const reviewed = end !== "with_pm" && end !== "returned" && end !== "with_consultant_engineer";
    // Sara works Mechanical only (RP-1207); Ahmed covers every Trade. At the Engineer's Step, a few
    // items stay in the Step Pool, picked up by no one.
    let consultantEngineer: ConsultantEngineer | undefined;
    if (end === "with_consultant_engineer") {
      const pick = engineerPicks++ % 4;
      consultantEngineer = pick === 3 ? undefined : trade === "ME" && pick !== 1 ? "sara" : "ahmed";
    } else if (reviewed) {
      consultantEngineer = trade === "ME" && index % 2 === 0 ? "sara" : "ahmed";
    }
    const item: SampleSubmittal = {
      title: sar ? sar.name.en : `${p.name} – ${floor.name.en}`,
      type: sar ? "SAR" : "MAR",
      trade,
      location: floor.code,
      end,
      product: p,
      ...(sar ? { supplier: sar } : {}),
      ...(consultantEngineer ? { consultantEngineer } : {}),
      ...(end === "code_c" && revised < REVISED ? { revision: revised++ === 0 ? ("returned" as const) : ("with_pm" as const) } : {}),
      ...(reviewed ? { recommendedCode: CODES[end] ?? (["A", "A", "B", "C"] as const)[index % 4]! } : {}),
      ...(end === "code_b" ? { comments: commentsOf(codeB++, `${p.name}, ${floor.name.en}`) } : {}),
      ...(index % 7 === 0 && !sar ? { samplePhoto: true } : {}),
    };
    return item;
  });
}

/** Where a Snag List item ends: its Stage. */
export type SnagEnd =
  | "draft"
  | "open"
  | "in_progress"
  | "on_hold"
  | "resolved"
  | "closed"
  /** A UAT Project's (RP-1248): resolved by the Contractor, then Returned to Open by its raiser with a reason. */
  | "returned_to_open";

export interface SampleSnag {
  title: string;
  type: "SNG" | "OBS";
  /** OBS: the General Trade every Project has. */
  trade: TradeCode | "GEN";
  location: string;
  end: SnagEnd;
  /** Who raises it: the Consultant Engineer (Ahmed) or the Contractor Engineer (Hafiz). */
  raisedBy: "ahmed" | "hafiz";
  description: string;
  photos?: number;
}

const SNAG_ENDS: SnagEnd[] = [
  ...Array<SnagEnd>(2).fill("draft"),
  ...Array<SnagEnd>(5).fill("open"),
  ...Array<SnagEnd>(4).fill("in_progress"),
  ...Array<SnagEnd>(2).fill("on_hold"),
  ...Array<SnagEnd>(3).fill("resolved"),
  ...Array<SnagEnd>(4).fill("closed"),
];

const SNAGS: [string, TradeCode, string][] = [
  ["Damaged cable tray cover", "EL", "Cover bent at the riser; replace it."],
  ["Socket outlet not level", "EL", "Faceplate out of level by 5 mm."],
  ["Missing earth bonding to the tray", "EL", "No bonding jumper at the tray joint."],
  ["Downlight not working", "EL", "Fitting does not light on test."],
  ["Exposed cable at the ceiling void", "EL", "Cable not in containment above the corridor."],
  ["Distribution board not labelled", "EL", "Circuit chart missing inside the door."],
  ["Fan coil unit leaking", "ME", "Drip tray overflowing at the corridor unit."],
  ["Duct insulation torn", "ME", "Vapour barrier damaged at the bend."],
  ["Sprinkler head painted over", "ME", "Paint on the bulb; replace the head."],
  ["Pipe support missing", "ME", "Chilled water pipe unsupported for 3 m."],
  ["Drain gully blocked", "ME", "Gully full of debris after the screed."],
  ["Valve label missing", "ME", "No label on the isolation valve."],
  ["Honeycombing at the column base", "CV", "Honeycombing at the column kicker; repair to the method statement."],
  ["Cracked floor tile", "CV", "Two tiles cracked at the lobby entrance."],
  ["Gypsum board joint visible", "CV", "Joint tape showing through the paint."],
  ["Fire door not closing", "CV", "Door closer needs adjusting."],
  ["Blockwork not plumb", "CV", "Wall out of plumb by 12 mm over 3 m."],
  ["Waterproofing lap not sealed", "CV", "Membrane lap open at the basement wall."],
  ["Skirting tile missing", "CV", "Skirting missing behind the riser door."],
  ["Ceiling hatch misaligned", "CV", "Hatch frame out of line with the grid."],
];

const OBSERVATIONS: [string, SnagEnd][] = [
  ["Housekeeping at the podium loading bay", "open"],
  ["Scaffold inspection card out of date at Tower A Level 05", "open"],
  ["Barricade missing at the slab edge", "open"],
  ["Material stored on the escape route", "closed"],
  ["Hard hats not worn at the batching plant", "closed"],
  ["Hose crossing the site road", "closed"],
];

/**
 * The Snag List: Snags in every Status and Site Observations. Its Comments are Code B's (a Comment is
 * never raised directly, RP-668): `comments` of the Code B Submittals.
 */
export function sampleSnags(): SampleSnag[] {
  const snags = SNAGS.map(([title, trade, description], i): SampleSnag => ({
    title,
    type: "SNG",
    trade,
    location: FLOORS[i % FLOORS.length]!.code,
    end: SNAG_ENDS[i]!,
    raisedBy: i % 4 === 3 ? "hafiz" : "ahmed",
    description,
    ...(i % 2 === 0 ? { photos: 1 + (i % 3) } : {}),
  }));
  const observations = OBSERVATIONS.map(([title, end], i): SampleSnag => ({
    title,
    type: "OBS",
    trade: "GEN",
    location: FLOORS[(i * 3) % FLOORS.length]!.code,
    end,
    raisedBy: "ahmed",
    description: `${title}. Observed on the site walk.`,
    ...(i % 2 === 0 ? { photos: 1 } : {}),
  }));
  return [...snags, ...observations];
}

/** A Package's status as it reads once the seed is done (GLOSSARY.md Package). */
export type PackageStatus = "open" | "in_progress" | "done";

/** A Draft put in an Open Package: never sent, so no Document Number. */
export interface SampleDraft {
  title: string;
  trade: TradeCode;
  location: string;
  product: Product;
}

export interface SamplePackage {
  name: BilingualText;
  /** Its owning Contractor Participant: TMC (Ali puts it together) or Beta Build (Yousef). */
  owner: "tmc" | "beta";
  status: PackageStatus;
  /** Subjects of the Project's own Submittals (sampleSubmittals) it takes in, already where they end. */
  existing: string[];
  /** Its own submittals: raised, sent for review and Submitted together by Submit Package, then each to its end. */
  submitted: SampleSubmittal[];
  /** Its own Drafts (an Open Package). */
  drafts: SampleDraft[];
}

/** One of a Package's own submittals: a MAR of `trade` at `location`, ending at `end`. */
function own(title: string, trade: TradeCode, location: string, end: SubmittalEnd, item: Product, extra: Partial<SampleSubmittal> = {}): SampleSubmittal {
  return { title, type: "MAR", trade, location, end, product: item, ...(CODES[end] ? { recommendedCode: CODES[end] } : {}), ...extra };
}

const BETA = {
  glazing: product("Double glazed units", "Saint-Gobain", "SGG Cool-Lite SKN 165", "08 80 00", "Double glazed units, 6 mm solar control, 16 mm argon, 6 mm clear.", "Glazed unit", 640, "m2"),
  brackets: product("Curtain wall brackets", "Halfen", "HCW 3D", "08 44 13", "Adjustable stainless steel curtain wall brackets.", "Bracket", 860, "pcs"),
  silicone: product("Structural silicone", "Dow", "DOWSIL 993", "07 92 00", "Two-part structural glazing silicone.", "Cartridge", 300, "pcs"),
  spandrel: product("Spandrel glass", "Guardian", "SunGuard SN 70", "08 81 00", "Opacified spandrel glass for the floor edges.", "Spandrel glass", 410, "m2"),
  stairs: product("Precast stair flights", "Precast Arabia", "PSF 1200", "03 41 00", "Precast concrete stair flights, 1200 mm wide.", "Stair flight", 18, "pcs"),
  nosings: product("Stair nosings", "Gradus", "SPN 50", "06 43 00", "Aluminium anti-slip stair nosings.", "Nosing", 220, "m"),
  anchors: product("Handrail anchors", "Hilti", "HST3 M12", "05 52 00", "Stainless steel wedge anchors for the handrails.", "Anchor", 480, "pcs"),
  waterstops: product("Bentonite waterstops", "Volclay", "Waterstop-RX 101", "07 13 00", "Bentonite waterstop strips for the basement joints.", "Waterstop", 360, "m"),
  protection: product("Protection board", "Sika", "SikaProof Protection 4", "07 13 26", "Protection board for the basement membrane.", "Board", 1200, "m2"),
};

const TMC_DRAFTS = {
  valves: product("Sprinkler valve sets", "Viking", "Model J-1 alarm valve", "21 13 13", "Wet alarm valve sets with trim.", "Valve set", 4, "set"),
  reels: product("Fire hose reels", "Firestorm", "FHR 30", "21 12 00", "Swinging hose reels, 30 m, 25 mm.", "Hose reel", 22, "pcs"),
  extinguishers: product("Fire extinguishers", "Kidde", "EZA 6 kg", "21 11 00", "6 kg dry powder extinguishers with wall brackets.", "Extinguisher", 60, "pcs"),
};

/**
 * The sample Project's Packages (RP-1220): for TMC, two of the Project's own Submittals grouped as they stand
 * (one Done, one In Progress with a Code C waiting for its Revision) and an Open one of new Drafts; for Beta Build,
 * the second Contractor, its own submittals Submitted by Submit Package (one In Progress with a Code C, one Done)
 * and an Open one of Drafts. Each Contractor numbers its own (PKG-001…).
 */
export function samplePackages(): SamplePackage[] {
  const submittals = sampleSubmittals().filter((s) => !s.revision && s.type === "MAR");
  const taken = new Set<string>();
  const pick = (n: number, wanted: (s: SampleSubmittal) => boolean) => {
    const found = submittals.filter((s) => !taken.has(s.title) && wanted(s)).slice(0, n).map((s) => s.title);
    if (found.length < n) throw new Error(`sample Packages: only ${found.length} of ${n} submittals to take`);
    for (const title of found) taken.add(title);
    return found;
  };
  const closed = (s: SampleSubmittal) => closesPackage(s.end);
  return [
    {
      name: { en: "Lighting and power – Block A", ar: "الإنارة والطاقة – المبنى أ" },
      owner: "tmc",
      status: "done",
      existing: pick(5, (s) => s.trade === "EL" && closed(s)),
      submitted: [],
      drafts: [],
    },
    {
      name: { en: "Chilled water and HVAC – Block A", ar: "المياه المبردة والتكييف – المبنى أ" },
      owner: "tmc",
      status: "in_progress",
      existing: [
        ...pick(2, (s) => s.trade === "ME" && s.end === "with_consultant_engineer"),
        ...pick(1, (s) => s.trade === "ME" && s.end === "with_consultant_manager"),
        ...pick(1, (s) => s.trade === "ME" && s.end === "code_c"),
        ...pick(1, (s) => s.trade === "ME" && s.end === "code_a"),
      ],
      submitted: [],
      drafts: [],
    },
    {
      name: { en: "Fire protection – Podium", ar: "الحماية من الحريق – المنصة" },
      owner: "tmc",
      status: "open",
      existing: [],
      submitted: [],
      drafts: [
        { title: "Sprinkler valve sets – Podium Ground Floor", trade: "ME", location: "PGF", product: TMC_DRAFTS.valves },
        { title: "Fire hose reels – Podium Level 01", trade: "ME", location: "P01", product: TMC_DRAFTS.reels },
        { title: "Fire extinguishers – Podium Basement 1", trade: "ME", location: "PB1", product: TMC_DRAFTS.extinguishers },
      ],
    },
    {
      name: { en: "Facade glazing – Tower A", ar: "زجاج الواجهات – البرج أ" },
      owner: "beta",
      status: "in_progress",
      existing: [],
      submitted: [
        own("Double glazed units – Tower A Level 04", "CV", "A04", "code_a", BETA.glazing, { consultantEngineer: "ahmed" }),
        own("Curtain wall brackets – Tower A Level 05", "CV", "A05", "code_c", BETA.brackets, { consultantEngineer: "ahmed" }),
        own("Structural silicone – Tower A Level 06", "CV", "A06", "with_consultant_engineer", BETA.silicone, { consultantEngineer: "ahmed" }),
        own("Spandrel glass – Tower A Level 03", "CV", "A03", "with_consultant_manager", BETA.spandrel, { consultantEngineer: "ahmed", recommendedCode: "A" }),
      ],
      drafts: [],
    },
    {
      name: { en: "Precast stairs – Podium", ar: "الدرج الجاهز – المنصة" },
      owner: "beta",
      status: "done",
      existing: [],
      submitted: [
        own("Precast stair flights – Podium Ground Floor", "CV", "PGF", "code_a", BETA.stairs, { consultantEngineer: "ahmed" }),
        own("Stair nosings – Podium Level 01", "CV", "P01", "code_b", BETA.nosings, {
          consultantEngineer: "ahmed",
          comments: [{ comment: "Confirm the nosing colour with the Architect: Stair nosings, Podium Level 01.", reference: "Room finishes drawing", end: "open" }],
        }),
        own("Handrail anchors – Podium Basement 1", "CV", "PB1", "code_d", BETA.anchors, { consultantEngineer: "ahmed" }),
      ],
      drafts: [],
    },
    {
      name: { en: "Basement waterproofing", ar: "عزل القبو المائي" },
      owner: "beta",
      status: "open",
      existing: [],
      submitted: [],
      drafts: [
        { title: "Bentonite waterstops – Podium Basement 1", trade: "CV", location: "PB1", product: BETA.waterstops },
        { title: "Protection board – Podium Basement 1", trade: "CV", location: "PB1", product: BETA.protection },
      ],
    },
  ];
}

/** Whether a submittal ending at `end` lets its Package be Done: closed at Code A, B or D (a Code C waits for its Revision). */
export const closesPackage = (end: SubmittalEnd): boolean => end === "code_a" || end === "code_b" || end === "code_d";

/** A check item of a Checklist Template: Pass, Fail or N/A, a comment allowed; a Failed one raises nothing of its own. */
export interface SampleCheck {
  key: string;
  text: BilingualText;
}

/** Each Trade's Checklist Template on the sample Project, which its Inspections pick (RP-1220). */
export const SAMPLE_CHECKLISTS: Record<TradeCode, { name: BilingualText; checks: SampleCheck[] }> = {
  EL: {
    name: { en: "Cable containment and wiring", ar: "حوامل الكابلات والتمديدات" },
    checks: [
      { key: "supports", text: { en: "Supports at the spacing on the drawing", ar: "الدعامات بالمسافات المبينة في المخطط" } },
      { key: "earthing", text: { en: "Containment bonded to earth", ar: "الحوامل موصولة بالتأريض" } },
      { key: "labels", text: { en: "Cables labelled at both ends", ar: "الكابلات معلّمة من الطرفين" } },
    ],
  },
  ME: {
    name: { en: "Pipework installation", ar: "تركيب الأنابيب" },
    checks: [
      { key: "supports", text: { en: "Pipe supports at the spacing on the drawing", ar: "دعامات الأنابيب بالمسافات المبينة في المخطط" } },
      { key: "pressure_test", text: { en: "Pressure test held for two hours", ar: "اختبار الضغط ثابت لمدة ساعتين" } },
      { key: "insulation", text: { en: "Insulation complete and sealed", ar: "العزل مكتمل ومحكم" } },
    ],
  },
  CV: {
    name: { en: "Concrete pour", ar: "صب الخرسانة" },
    checks: [
      { key: "formwork", text: { en: "Formwork level, tight and clean", ar: "القوالب مستوية ومحكمة ونظيفة" } },
      { key: "rebar_cover", text: { en: "Rebar cover as per drawing", ar: "غطاء حديد التسليح حسب المخطط" } },
      { key: "embedded_items", text: { en: "Sleeves and embedded items in place", ar: "الأكمام والقطع المدفونة في أماكنها" } },
    ],
  },
};

/** Where an Inspection ends in the seed: as a Submittal does, or still a Draft. */
export type InspectionEnd = SubmittalEnd | "draft";

/** A Work Inspection Request (WIR) on the current WIR Workflow, which closes with a Review Code (ADR 0025). */
export interface SampleInspection {
  title: string;
  /** Its raising Contractor. */
  owner: "tmc" | "beta";
  trade: TradeCode;
  location: string;
  end: InspectionEnd;
  description: string;
  consultantEngineer?: ConsultantEngineer;
  /** From the Consultant Engineer on: the Code they recommend (the Code issued, once there is one). */
  recommendedCode?: "A" | "B" | "C" | "D";
  /** Its Checklist's check items the Consultant Engineer answers Fail; every other one Passes. */
  failing?: string[];
  /** Code B only: the Comments its Code raises. */
  comments?: { comment: string; reference: string; end: "open" }[];
  /** Code C only: re-inspected as Rev 1, which is still with the Consultant Engineer (`open`) or passed at Code A. */
  revision?: "open" | "passed";
}

const inspection = (
  title: string,
  trade: TradeCode,
  location: string,
  end: InspectionEnd,
  extra: Partial<SampleInspection> = {},
): SampleInspection => ({
  title,
  owner: "tmc",
  trade,
  location,
  end,
  description: `${title}: ready for inspection.`,
  ...(CODES[end as SubmittalEnd] ? { recommendedCode: CODES[end as SubmittalEnd] } : {}),
  ...(end !== "draft" && end !== "with_pm" && end !== "returned" && end !== "with_consultant_engineer" ? { consultantEngineer: trade === "ME" ? "sara" : "ahmed" } : {}),
  ...extra,
});

/**
 * The sample Project's Inspections (RP-1220): raised by the Contractors (TMC, and Beta Build too), carried out by
 * Design Consultants on the current WIR Workflow, ending with a Review Code; at every Stage, with a Code C
 * re-inspected twice over (one Revision still open, one passed) and a Rejected one.
 */
export function sampleInspections(): SampleInspection[] {
  return [
    inspection("Cable tray installation – Tower A Level 02", "EL", "A02", "draft"),
    inspection("Blinding concrete – Podium Basement 1", "CV", "PB1", "draft"),
    inspection("Lighting circuits wiring – Tower A Level 03", "EL", "A03", "with_pm"),
    inspection("Chilled water risers – Tower A Level 04", "ME", "A04", "with_pm"),
    inspection("Column reinforcement – Podium Ground Floor", "CV", "PGF", "returned"),
    inspection("Slab reinforcement – Podium Level 01", "CV", "P01", "with_consultant_engineer", { consultantEngineer: "ahmed" }),
    inspection("Sprinkler pipework – Podium Ground Floor", "ME", "PGF", "with_consultant_engineer", { consultantEngineer: "sara" }),
    inspection("Earthing system – Podium Basement 1", "EL", "PB1", "with_consultant_engineer"),
    inspection("Duct pressure test – Tower A Level 05", "ME", "A05", "with_consultant_manager", { recommendedCode: "A" }),
    inspection("Wall formwork – Podium Basement 1", "CV", "PB1", "with_consultant_manager", { recommendedCode: "C", failing: ["formwork"] }),
    inspection("Distribution board installation – Podium Ground Floor", "EL", "PGF", "code_a"),
    inspection("Drainage pipework – Podium Basement 1", "ME", "PB1", "code_a"),
    inspection("Lighting fixtures – Podium Level 01", "EL", "P01", "code_b", {
      comments: [{ comment: "Fix the loose fixture covers at gridline 4: Lighting fixtures, Podium Level 01.", reference: "Inspection", end: "open" }],
    }),
    inspection("Roof slab pour – Tower A Level 06", "CV", "A06", "code_b", {
      comments: [{ comment: "Cure the slab edges for seven more days: Roof slab pour, Tower A Level 06.", reference: "Inspection", end: "open" }],
    }),
    inspection("Fan coil unit connections – Tower A Level 03", "ME", "A03", "code_c", { failing: ["pressure_test"], revision: "passed" }),
    inspection("Transfer beam reinforcement – Podium Level 01", "CV", "P01", "code_c", { failing: ["rebar_cover"], revision: "open" }),
    inspection("Busbar riser installation – Tower A Level 04", "EL", "A04", "code_d", { failing: ["supports", "earthing"] }),
    inspection("Curtain wall anchors – Tower A Level 05", "CV", "A05", "code_a", { owner: "beta" }),
    inspection("Glazing sealant – Tower A Level 06", "CV", "A06", "with_consultant_engineer", { owner: "beta", consultantEngineer: "ahmed" }),
  ];
}
