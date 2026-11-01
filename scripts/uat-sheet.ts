import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialsFrom, type Credentials } from "./jira-upload.ts";

// The UAT test sheet (RP-1163): one self-contained HTML file a tester opens with no server or
// sign-in. It lists a round's Test Cases, records a status, a comment and screenshots for each
// (kept in the browser's IndexedDB), and exports them to Excel with the screenshots embedded.
//
// Usage:
//   node scripts/uat-sheet.ts --round "Round 1" [--jql "<JQL>"] [--uat-url <web url>] [--out <file>]
//   node scripts/uat-sheet.ts --round "Round 1" --issues <issues.json>
//   node scripts/uat-sheet.ts --round "Round 1" --scenarios planning/uat/round-0/test-cases.json
//   add --rounds 0,1 to keep only the cases whose first round is one of those.
// With --issues it reads Jira's search answer (or a list of issues) from a file; with --scenarios the
// round's local test-cases.json (the scenarios the Jira Test Cases were made from); otherwise it
// asks Jira with JIRA_EMAIL and JIRA_API_TOKEN from the environment (never printed, never written).
// The HTML holds Test Case text only: no secrets, no tokens, no customer data.
// A scenario of test-cases.json may declare `"needs": ["mail", "job", "setup", "owner"]` (see NEEDS):
// the sheet shows a "needs the UAT owner" badge for `owner`, a note under a `mail` case that on the UAT
// the mail goes to the real mailbox (its Mailpit wording becomes "the mailbox"), and a badge for the rest.
// tagProblems (run by uat-sheet.test.ts over the real file) fails a case that mentions Mailpit, a job or
// the lane's own machine without the matching need.

const JIRA = "https://rabaedsa.atlassian.net";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
export const DEFAULT_JQL = 'project = RP AND issuetype = "Test Case" AND labels = uat ORDER BY key';
export const DEFAULT_UAT_URL = "https://rabaed-uat-web.vercel.app";

export interface JiraIssue {
  key: string;
  fields: { summary: string; labels?: string[]; description?: unknown; status?: { name: string } };
}

export interface SheetCase {
  key: string;
  id: string;
  title: string;
  part: string;
  /** The Part's English name, the sheet's section title (PART_NAMES has the Arabic). */
  partName: string;
  round: string;
  who: string;
  steps: string[];
  expected: string;
  /** What the case needs beyond the demo: see NEEDS. Empty for a case read from Jira. */
  needs: Need[];
  url: string;
}

type Node = { type?: string; text?: string; content?: Node[]; marks?: { type: string }[]; attrs?: { level?: number } };

/** Jira's document format (REST v3) as the markdown its MCP shows, enough for a Test Case's sections. */
function adfToMarkdown(node: Node): string {
  const inline = (n: Node): string =>
    n.type === "text" ? (n.marks?.some((m) => m.type === "strong") ? `**${n.text ?? ""}**` : (n.text ?? "")) : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(inline).join("");
  const block = (n: Node): string => {
    switch (n.type) {
      case "doc":
        return (n.content ?? []).map(block).join("\n\n");
      case "heading":
        return `${"#".repeat(n.attrs?.level ?? 2)} ${inline(n)}`;
      case "orderedList":
        return (n.content ?? []).map((li, i) => `${i + 1}. ${(li.content ?? []).map(block).join(" ")}`).join("\n");
      case "bulletList":
        return (n.content ?? []).map((li) => `* ${(li.content ?? []).map(block).join(" ")}`).join("\n");
      default:
        return inline(n);
    }
  };
  return block(node);
}

const descriptionText = (d: unknown): string => (typeof d === "string" ? d : d && typeof d === "object" ? adfToMarkdown(d as Node) : "");

/** The markdown under `## <name>` up to the next heading. */
function section(md: string, name: string): string {
  const m = new RegExp(`^#{1,3}\\s+${name}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, "m").exec(md);
  return (m?.[1] ?? "").trim();
}

const plain = (s: string) => s.replace(/\*\*|`/g, "").trim();

/** Where a case starts on the UAT: Rabaed Admin for ADM cases, the web app in English otherwise. */
export function startUrl(part: string, uatUrl: string): string {
  const web = uatUrl.replace(/\/+$/, "");
  return part === "ADM" ? web.replace("-web.", "-admin.") : `${web}/en`;
}

/** One Test Case issue as a row of the sheet. */
export function caseFromIssue(issue: JiraIssue, uatUrl: string): SheetCase {
  const md = descriptionText(issue.fields.description);
  const [id = issue.key, ...rest] = issue.fields.summary.trim().split(/\s+/);
  const labels = issue.fields.labels ?? [];
  const part = (/^uat-part-([a-z0-9]+)$/.exec(labels.find((l) => l.startsWith("uat-part-")) ?? "")?.[1] ?? id.split("-")[0] ?? "").toUpperCase();
  const round = /^uat-round-(.+)$/.exec(labels.find((l) => l.startsWith("uat-round-")) ?? "")?.[1] ?? "";
  const who = plain(/\*\*Who:\*\*\s*(.+)/.exec(md)?.[1] ?? "");
  const steps = section(md, "Steps")
    .split("\n")
    .map((l) => /^\s*\d+[.)]\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((s): s is string => Boolean(s))
    .map(plain);
  // eslint-disable-next-line rabaed/no-avoid-terms -- the Test Case's own heading in Jira, read as written.
  const expected = plain(section(md, "Expected result"));
  const partName = plain(/\*\*Part [A-Z0-9]+: ([^*]+)\*\*/.exec(md)?.[1] ?? PART_NAMES[part]?.en ?? part);
  return { key: issue.key, id, title: rest.join(" "), part, partName, round, who, steps, expected, needs: [], url: startUrl(part, uatUrl) };
}

/**
 * What a case needs that a tester on the Vercel UAT (ADR 0026) may not have, declared in its `needs` list:
 *   mail   reads or checks an email. On the UAT the mail goes through SendGrid to the real mailbox of the
 *          address, so a demo Member's made-up .test address has no mailbox to read.
 *   job    needs a background or scheduled job (the daily digest, the weekly Step Age report) to be run.
 *   setup  needs a fixture, aged items or a seeded state that its own steps do not create.
 *   owner  needs the UAT owner (the person running the UAT): the lane's machine, pnpm, a port, a lane
 *          engineer, or a mailbox the tester cannot read.
 * The needs come from the scenarios file only (test-cases.json): a Test Case read from Jira has none.
 */
export const NEEDS = ["mail", "job", "setup", "owner"] as const;
export type Need = (typeof NEEDS)[number];

/** A scenario of planning/uat/<round>/test-cases.json, the source the Jira Test Cases were made from. */
export interface ScenarioRow {
  id: string;
  jira: string;
  part: string;
  partName?: string;
  title: string;
  who?: string;
  steps?: string;
  expected?: string;
  round?: string;
  waits?: string;
  needs?: string[];
}

const unknownNeeds = (needs: readonly string[] = []) => needs.filter((n) => !(NEEDS as readonly string[]).includes(n));

/** A mail case as the Vercel UAT shows it: the mail goes to the real mailbox, so the tester reads "the mailbox", not Mailpit. */
export function vercelWording(text: string): string {
  return text
    .replace(/Mailpit(?:\s*\(lane 7\))?/gi, (_m, offset: number) => (/(^|[.!?]\s+)$/.test(text.slice(0, offset)) ? "The mailbox" : "the mailbox"))
    .replace(/\b([Tt]he) the mailbox/g, "$1 mailbox");
}

// What the text of a case implies it needs; a case that mentions one without declaring it is a false Blocked result on the UAT.
const IMPLIED_NEEDS: { need: Need; pattern: RegExp; says: string; inTitle?: false }[] = [
  { need: "mail", pattern: /\bmailpit\b/i, says: "mentions Mailpit" },
  // Any job (run the job, the digest job, pnpm uat:run-job); a Member's "Daily digest" or "Weekly Step Age report" setting is not one.
  { need: "job", pattern: /\bjobs?\b/i, says: "mentions a job" },
  { need: "owner", pattern: /\blane ?7\b|\bpnpm\b|\blane engineer\b|\.env\b|\bdatabase\b|\bports?\b/i, says: "mentions the lane's own machine" },
  // The AGE and FX-x fixtures, a fixture by name, or aged items. A case that builds a fixture names it in its title ("Fixture FX-C2: ..."), so the title is not read.
  { need: "setup", pattern: /\bFX-[A-Z0-9]+\b|\bAGE\b|\b[Ff]ixture\b|\b[Aa]ged items?\b|\b[Aa]ge (?:the|two|an?|\d+) items?\b/, says: "needs a fixture or aged items", inTitle: false },
];

/** The rows of a test-cases.json whose needs do not match their text: one message each. */
export function tagProblems(rows: (Pick<ScenarioRow, "id"> & Partial<ScenarioRow>)[]): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const unknown = unknownNeeds(r.needs);
    if (unknown.length) problems.push(`${r.id} declares an unknown need: ${unknown.join(", ")}`);
    const body = [r.who, r.steps, r.expected].join("\n");
    for (const { need, pattern, says, inTitle } of IMPLIED_NEEDS) {
      if (pattern.test(inTitle === false ? body : `${r.title ?? ""}\n${body}`) && !r.needs?.includes(need)) problems.push(`${r.id} ${says}: add ${need} to its needs`);
    }
  }
  return problems;
}

// The round a case first runs, as its Jira label uat-round-N says (planning/uat/strategy.md 10.1):
// what it waits for decides it, and a case waiting for nothing runs in Round 0.
const ROUND_BY_EPIC: [RegExp, string][] = [
  [/RP-589\b/, "5"],
  [/RP-27\b/, "4"],
  [/RP-28\b/, "3"],
  [/RP-23\b/, "2"],
  [/RP-588\b/, "1"],
];
export const roundFromWaits = (waits = ""): string => (/^\s*now\b/i.test(waits) || !waits.trim() ? "0" : (ROUND_BY_EPIC.find(([re]) => re.test(waits))?.[1] ?? ""));

/** The round's local test-cases.json as rows of the sheet; "1) a 2) b" steps split into a list. */
export function casesFromScenarios(text: string, uatUrl: string): SheetCase[] {
  return (JSON.parse(text) as ScenarioRow[]).map((p) => {
    const unknown = unknownNeeds(p.needs);
    if (unknown.length) throw new Error(`${p.id} declares an unknown need: ${unknown.join(", ")}`);
    const needs = (p.needs ?? []) as Need[];
    const words = needs.includes("mail") ? vercelWording : (s: string) => s;
    return {
      key: p.jira,
      id: p.id,
      title: words(p.title),
      part: p.part,
      partName: p.partName ?? PART_NAMES[p.part]?.en ?? p.part,
      round: p.round ?? roundFromWaits(p.waits),
      who: plain(p.who ?? ""),
      steps: numberedSteps(p.steps ?? "").map(words),
      expected: words(plain(p.expected ?? "")),
      needs,
      url: startUrl(p.part, uatUrl),
    };
  });
}

/** "1) a 2) b" as ["a", "b"]: only the numbers in order split it, so "port 4750) on" stays inside its step. */
export function numberedSteps(text: string): string[] {
  const steps: string[] = [];
  let rest = text.trim();
  for (let n = 1; ; n++) {
    const here = new RegExp(`^${n}\\)\\s+`).exec(rest);
    if (!here) break;
    rest = rest.slice(here[0].length);
    const next = new RegExp(`(?:^|\\s)${n + 1}\\)\\s+`).exec(rest);
    steps.push(plain(next ? rest.slice(0, next.index) : rest));
    if (!next) return steps.filter(Boolean);
    rest = rest.slice(next.index).trim();
  }
  return rest ? [...steps, plain(rest)].filter(Boolean) : steps.filter(Boolean);
}

function findFflate(): string {
  const store = join(root, "node_modules", ".pnpm");
  const dir = readdirSync(store)
    .filter((d) => d.startsWith("fflate@"))
    .sort()
    .pop();
  if (!dir) throw new Error("fflate is not in node_modules/.pnpm: run pnpm install");
  return readFileSync(join(store, dir, "node_modules", "fflate", "umd", "index.js"), "utf8");
}

/** JSON safe inside a <script>: no "</" can close it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => `\\u${c.charCodeAt(0).toString(16)}`);

type Bilingual = { en: string; ar: string };

/** The Parts of the test plan (planning/uat/strategy.md), the sheet's sections, in English and Arabic. */
export const PART_NAMES: Record<string, Bilingual> = {
  SUB: { en: "Submittals", ar: "التقديمات" },
  WF: { en: "Workflows", ar: "سير العمل" },
  FRM: { en: "Forms and Screens", ar: "النماذج والشاشات" },
  PAR: { en: "Participants and Visibility setup", ar: "المشاركون وإعداد الرؤية" },
  PKG: { en: "Packages", ar: "الحزم" },
  SIG: { en: "Signing and Documental Record", ar: "التوقيع والسجل الوثائقي" },
  SNG: { en: "Snag List", ar: "قائمة الملاحظات" },
  INS: { en: "Inspections (WIR)", ar: "الفحوصات (WIR)" },
  IMP: { en: "Submittal Register Import", ar: "استيراد سجل التقديمات" },
  NOT: { en: "Notifications", ar: "الإشعارات" },
  I18N: { en: "Arabic, RTL and phone width", ar: "العربية والاتجاه من اليمين وعرض الهاتف" },
  ADM: { en: "Rabaed Admin", ar: "Rabaed Admin" },
  UX: { en: "UI and UX against the design", ar: "الواجهة وتجربة الاستخدام مقابل التصميم" },
  VIS: { en: "Visibility", ar: "الرؤية" },
};
/** One demo person in the sheet's Who's who panel: who to sign in as, never a password (the sheet is in a public repo). */
export interface DemoPerson {
  key: string;
  name: string;
  email: string;
  company: Bilingual;
  role: Bilingual;
  position: Bilingual;
  usedFor: Bilingual;
  /** What the person covers, for the map: Trades and Locations (RP-1206). */
  covers: Bilingual;
  /** The map's second line, when it says more than the Position (e.g. "Manager, gives the Code"). */
  mapRole?: Bilingual;
  /** Covers less than their Company: drawn with a thick border on the map. */
  narrowed?: boolean;
}

const EL_ALL = { en: "EL · all towers", ar: "كهرباء · كل الأبراج" };
const ELME_ALL = { en: "EL, ME · all towers", ar: "كهرباء وميكانيكا · كل الأبراج" };
const PROFILE = { en: "Company profile", ar: "ملف الشركة" };

const TMC = { en: "TMC Constructions", ar: "تي إم سي للإنشاءات" };
const BETA = { en: "Beta Build", ar: "بيتا للبناء" };
const DCL = { en: "Design Consultants LLC", ar: "المصممون الاستشاريون ذ.م.م" };
const WAHA = { en: "Al Waha PMC", ar: "الواحة لإدارة المشاريع" };
const CONTRACTOR = { en: "Contractor, Electrical, everywhere", ar: "مقاول، الأعمال الكهربائية، كل المواقع" };
const AP = { en: "Authorized Person", ar: "المفوّض" };
const ENGINEER = { en: "Engineer", ar: "مهندس" };

/**
 * The demo people of the seed (README "Demo data"), the same on lane 7 and on the Vercel UAT after a reset: the
 * sheet's Who's who panel (RP-1204), so a tester sees which person each case means. Emails only: the owner gives the
 * sign-ins. The keys are the first names a case's "Who" line uses.
 */
/* eslint-disable rabaed/no-avoid-terms -- "Project Manager" here is a Position's name (GLOSSARY, Position), not the avoided name for the Project Admin. */
const PEOPLE_LIST: Omit<DemoPerson, "covers" | "mapRole" | "narrowed">[] = [
  { key: "saeed", name: "Saeed Al Qahtani", email: "saeed.alqahtani@tmc.demo.rabaed.test", company: TMC, role: { en: "Contractor and Project Admin", ar: "المقاول ومسؤول المشروع" }, position: AP,
    usedFor: { en: "Company Profile (logo, Stamp), Members, invitations, Project Settings", ar: "ملف الشركة (الشعار والختم)، الأعضاء، الدعوات، إعدادات المشروع" } },
  { key: "hafiz", name: "Hafiz Hamdan", email: "hafiz.hamdan@tmc.demo.rabaed.test", company: TMC, role: CONTRACTOR, position: ENGINEER,
    usedFor: { en: "Raises Drafts and sends them for review; Snags; the phone cases", ar: "ينشئ المسودات ويرسلها للمراجعة؛ الملاحظات؛ حالات الهاتف" } },
  { key: "ali", name: "Ali Sonour", email: "ali.sonour@tmc.demo.rabaed.test", company: TMC, role: CONTRACTOR, position: { en: "Project Manager", ar: "مدير المشروع" },
    usedFor: { en: "Reviews Hafiz's Drafts and Submits to the Consultant; Packages; the List and Dashboard; gets the weekly Step Age report (RP-1186)", ar: "يراجع مسودات حافظ ويقدّمها للاستشاري؛ الحزم؛ القائمة ولوحة المعلومات؛ يتلقى تقرير عمر الخطوة الأسبوعي (RP-1186)" } },
  { key: "omar", name: "Omar Al Harbi", email: "omar.alharbi@tmc.demo.rabaed.test", company: TMC, role: { en: "Contractor, Electrical, Tower 2 only", ar: "مقاول، الأعمال الكهربائية، البرج 2 فقط" }, position: ENGINEER,
    usedFor: { en: "Visibility narrowed to one Location: sees Tower 2 only", ar: "رؤية مقيّدة بموقع واحد: يرى البرج 2 فقط" } },
  { key: "yousef", name: "Yousef Karim", email: "yousef.karim@betabuild.demo.rabaed.test", company: BETA, role: CONTRACTOR, position: ENGINEER,
    usedFor: { en: "A second Contractor on the same Project: must never see TMC's work; gets the weekly Step Age report, Beta Build's items only (RP-1186)", ar: "مقاول ثانٍ في المشروع نفسه: يجب ألا يرى عمل تي إم سي أبدًا؛ يتلقى تقرير عمر الخطوة الأسبوعي لبنود بيتا فقط (RP-1186)" } },
  { key: "nasser", name: "Nasser Al Dosari", email: "nasser.aldosari@betabuild.demo.rabaed.test", company: BETA, role: { en: "Beta Build's own Project, Jeddah Corniche Villas", ar: "مشروع بيتا الخاص: فلل كورنيش جدة" }, position: AP,
    usedFor: { en: "Not on Riyadh Gate Tower: must get the not-found page there", ar: "ليس في برج بوابة الرياض: يجب أن تظهر له صفحة غير موجودة هناك" } },
  { key: "ahmed", name: "Ahmed bin Said", email: "ahmed.binsaid@designconsultants.demo.rabaed.test", company: DCL, role: { en: "Consultant, Electrical and Mechanical", ar: "الاستشاري، الكهرباء والميكانيكا" }, position: ENGINEER,
    usedFor: { en: "Reviews submittals for the Consultant (a demo person, not you)", ar: "يراجع الاعتمادات عن الاستشاري (شخص تجريبي، ليس أنت)" } },
  { key: "sara", name: "Sara", email: "sara@designconsultants.demo.rabaed.test", company: DCL, role: { en: "Consultant, Mechanical only", ar: "الاستشاري، الميكانيكا فقط" }, position: ENGINEER,
    usedFor: { en: "A Consultant engineer narrowed to one Trade: sees Mechanical items only, never the Electrical ones (RP-1207)", ar: "مهندسة استشاري مقيّدة بتخصص واحد: ترى بنود الميكانيكا فقط ولا ترى الكهرباء (RP-1207)" } },
  { key: "mohammed", name: "Mohammed Al Shamsi", email: "mohammed.alshamsi@designconsultants.demo.rabaed.test", company: DCL, role: { en: "Consultant, Electrical and Mechanical", ar: "الاستشاري، الكهرباء والميكانيكا" }, position: { en: "Manager", ar: "مدير" },
    usedFor: { en: "Gives the Review Code (A, B, C, D) and signs the Documental Record", ar: "يعطي رمز المراجعة (A وB وC وD) ويوقّع السجل الوثائقي" } },
  { key: "layla", name: "Layla Mansour", email: "layla.mansour@designconsultants.demo.rabaed.test", company: DCL, role: { en: "Consultant", ar: "الاستشاري" }, position: AP,
    usedFor: { en: "Design Consultants' Company Profile and Members", ar: "ملف شركة المصممون الاستشاريون وأعضاؤها" } },
  { key: "faisal", name: "Faisal Al Otaibi", email: "faisal.alotaibi@alwaha.demo.rabaed.test", company: WAHA, role: { en: "Owner Representative, Electrical, everywhere", ar: "ممثل المالك، الكهرباء، كل المواقع" }, position: { en: "Engineer (uses Arabic)", ar: "مهندس (يستخدم العربية)" },
    usedFor: { en: "The Arabic cases", ar: "حالات اللغة العربية" } },
  { key: "noura", name: "Noura Al Harbi", email: "noura.alharbi@alwaha.demo.rabaed.test", company: WAHA, role: { en: "Owner Representative", ar: "ممثل المالك" }, position: { en: "Project Manager (uses Arabic)", ar: "مديرة المشروع (تستخدم العربية)" },
    usedFor: { en: "Holds the Owner's review; Arabic cases", ar: "تتولى مراجعة المالك؛ حالات اللغة العربية" } },
  { key: "hind", name: "Hind Al Mutairi", email: "hind.almutairi@alwaha.demo.rabaed.test", company: WAHA, role: { en: "Owner Representative", ar: "ممثل المالك" }, position: AP,
    usedFor: { en: "Al Waha's Company Profile and Members", ar: "ملف شركة الواحة وأعضاؤها" } },
  { key: "engineer", name: "Rabaed Engineer", email: "engineer@rabaed.demo.rabaed.test", company: { en: "Rabaed", ar: "رابض" }, role: { en: "Rabaed Admin", ar: "Rabaed Admin" }, position: { en: "Rabaed Engineer", ar: "مهندس رابض" },
    usedFor: { en: "Rabaed Admin cases (ADM): the UAT owner runs these", ar: "حالات Rabaed Admin (ADM): يشغّلها مسؤول الاختبار" } },
];

/** Each person's line on the map (RP-1206), as the demo seed grants it: every Member covers their Company, but Omar (Tower 2) and Sara (Mechanical, RP-1207). */
const ON_MAP: Record<string, Pick<DemoPerson, "covers" | "mapRole" | "narrowed">> = {
  saeed: { covers: PROFILE },
  hafiz: { covers: EL_ALL },
  ali: { covers: EL_ALL },
  omar: { covers: { en: "EL · Tower 2 only", ar: "كهرباء · البرج 2 فقط" }, narrowed: true },
  yousef: { covers: EL_ALL },
  nasser: { covers: { en: "Beta Build, own Project, not here", ar: "بيتا للبناء، مشروعه الخاص، ليس هنا" } },
  ahmed: { covers: ELME_ALL },
  sara: { covers: { en: "ME only · all towers", ar: "ميكانيكا فقط · كل الأبراج" }, narrowed: true },
  mohammed: { covers: ELME_ALL, mapRole: { en: "Manager, gives the Code", ar: "مدير، يعطي الرمز" } },
  layla: { covers: PROFILE },
  faisal: { covers: EL_ALL, mapRole: { en: "Engineer, Arabic", ar: "مهندس، بالعربية" } },
  noura: { covers: EL_ALL, mapRole: { en: "PM, Owner's review", ar: "مديرة المشروع، مراجعة المالك" } },
  hind: { covers: PROFILE },
  engineer: { covers: { en: "Rabaed Admin, UAT owner only", ar: "Rabaed Admin، لمسؤول الاختبار فقط" } },
};
export const DEMO_PEOPLE: DemoPerson[] = PEOPLE_LIST.map((p) => ({ ...p, ...(ON_MAP[p.key] ?? { covers: { en: "", ar: "" } }) }));

/**
 * The Who's who map (RP-1206, owner-approved 2026-11-01): the Project's Trades and Locations, its Companies side by
 * side in the order a submittal travels (Contractors, then the Consultant, then the Owner representative), their
 * people under them, and who stands outside the Project.
 */
export const PEOPLE_MAP = {
  project: { en: "Riyadh Gate Tower – Phase 2", ar: "برج بوابة الرياض – المرحلة 2" },
  trades: { en: "Electrical (EL), Mechanical (ME), Civil (CV)", ar: "الكهرباء (EL)، الميكانيكا (ME)، الأعمال المدنية (CV)" },
  locations: { en: "Main Zone: Tower 1 (Floors 01–03), Tower 2 (Floor 01)", ar: "المنطقة الرئيسية: البرج 1 (الطوابق 01–03)، البرج 2 (الطابق 01)" },
  companies: [
    { key: "beta", name: BETA, role: { en: "Contractor", ar: "مقاول" }, tone: "contractor", people: ["yousef"] },
    { key: "tmc", name: TMC, role: { en: "Contractor, Admin", ar: "مقاول، مسؤول المشروع" }, tone: "contractor", people: ["saeed", "hafiz", "ali", "omar"] },
    { key: "dcl", name: { en: "Design Consultants", ar: "المصممون الاستشاريون" }, role: { en: "Consultant", ar: "الاستشاري" }, tone: "consultant", people: ["layla", "ahmed", "sara", "mohammed"] },
    { key: "waha", name: WAHA, role: { en: "Owner representative", ar: "ممثل المالك" }, tone: "owner", people: ["hind", "faisal", "noura"] },
  ],
  /** Submittals travel: TMC submits to the Consultant, who passes them to the Owner's review. */
  flow: [["tmc", "dcl"], ["dcl", "waha"]],
  outside: ["engineer", "nasser"],
  note: { en: "Thick border = covers less than their Company. Civil (CV) is covered by no Company.", ar: "الإطار السميك = يغطي أقل من شركته. لا تغطي أي شركة الأعمال المدنية (CV)." },
};
/* eslint-enable rabaed/no-avoid-terms */

export interface Section {
  /** 1, 2, 3… for the tester's sections; 0 for the last one, the cases the UAT owner runs. */
  n: number;
  part: string;
  name: Bilingual;
  cases: SheetCase[];
}

/**
 * The sheet's sections (RP-1204): the tester's cases by Part, in the order the Parts first appear, numbered 1, 2,
 * 3…, then one last section with every case the UAT owner runs (needs: owner). So the tester opens one section at a
 * time instead of facing every case at once.
 */
export function sectionsOf(cases: SheetCase[]): Section[] {
  const sections: Section[] = [];
  for (const c of cases.filter((x) => !x.needs.includes("owner"))) {
    let s = sections.find((x) => x.part === c.part);
    if (!s) {
      s = { n: sections.length + 1, part: c.part, name: PART_NAMES[c.part] ?? { en: c.partName, ar: c.partName }, cases: [] };
      sections.push(s);
    }
    s.cases.push(c);
  }
  const owner = cases.filter((x) => x.needs.includes("owner"));
  if (owner.length) sections.push({ n: 0, part: "OWNER", name: { en: "Cases the UAT owner runs", ar: "حالات يشغّلها مسؤول الاختبار" }, cases: owner });
  return sections;
}

/* eslint-disable rabaed/no-avoid-terms -- the tester's own instructions about this file (its sections, a case's name, ID, status and expected result, the JSON file to hand back), not product terms. */
/** The JSON a tester (or an AI helping them) hands back: the sheet's own work file, which Load work (.json) reads. */
export const RESULT_EXAMPLE = {
  sheet: "rabaed-uat-sheet",
  round: "<the round's name, as at the top of this file>",
  tester: "<your name>",
  at: "<ISO date and time, e.g. 2026-11-02T10:30:00Z>",
  entries: {
    "RP-685": { status: "pass", comment: "Saved as a Draft, listed with No number yet.", shots: [] },
    "RP-686": { status: "fail", comment: "What you saw, against the expected result.", shots: ["RP-686:1"] },
  },
  shots: [{ id: "RP-686:1", key: "RP-686", name: "SUB-02-1.png", type: "image/png", w: 1366, h: 768, data: "<the PNG's bytes in base64, or leave shots empty>" }],
};

/**
 * The sheet as Markdown (RP-1204): the same guide, people and cases, for a tester who works with an AI. It ends with
 * the exact JSON to hand back, which the HTML sheet's Load work (.json) reads, screenshots included. Test Case text
 * and demo emails only: no passwords.
 */
export function renderMarkdown({ round, cases, built, uatUrl = DEFAULT_UAT_URL }: { round: string; cases: SheetCase[]; built: string; uatUrl?: string }): string {
  const url = uatUrl.replace(/\/+$/, "");
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const out: string[] = [
    `# Rabaed UAT test sheet: ${round}`,
    "",
    `Built ${built}. ${cases.length} Test Cases. The UAT: ${url}/en (English) and ${url}/ar (Arabic).`,
    "",
    "## How to use this file",
    "",
    "1. Open the UAT and sign in as the person each case names under **Sign in as** (see Who's who). The owner gives you each sign-in; this file holds no passwords. Use one private browser window per person, so each sees only their own Company's work.",
    "2. Work section by section, case by case. Do the **Steps**, compare with the **Expected result**, and decide: `pass`, `fail`, `blocked` (could not test it) or `notrun`.",
    "3. On `fail` or `blocked`, write what you saw in the comment, in English or Arabic, and keep a screenshot.",
    "4. Skip the last section, the cases the UAT owner runs, unless the owner asks you to run them.",
    "5. Hand back your results as **one JSON file** in the format at the end of this file. Open the HTML sheet, press **Load work (.json)**, then **Export to Excel**, and send the .xlsx to the owner. Or send the .json itself.",
    "6. Demo data only: never type real names, phone numbers or documents.",
    "",
    "If you are an AI helping the tester: keep the case keys (`RP-nnn`) exactly as written, use only the four status values, and never invent a result for a case the tester did not run. Leave it out, or use `notrun`.",
    "",
    "## Who's who",
    "",
    `${PEOPLE_MAP.project.en}. Trades: ${PEOPLE_MAP.trades.en}. Locations: ${PEOPLE_MAP.locations.en}. ${PEOPLE_MAP.note.en}`,
    "",
    "| Name | Sign-in email | Company | On the Project | Position | Covers | Used for |",
    "|---|---|---|---|---|---|---|",
    ...DEMO_PEOPLE.map((p) => `| ${cell(p.name)} | \`${p.email}\` | ${cell(p.company.en)} | ${cell(p.role.en)} | ${cell(p.position.en)} | ${cell(p.covers.en)} | ${cell(p.usedFor.en)} |`),
    "",
  ];
  for (const s of sectionsOf(cases)) {
    out.push(`## ${s.n ? `${s.n}. ` : ""}${s.name.en} (${s.cases.length} cases)`, "");
    if (!s.n) out.push("The UAT owner runs these: they need the owner's machine, Rabaed Admin or a mailbox you can't read.", "");
    for (const c of s.cases) {
      out.push(`### ${c.id} ${c.title}`, "", `- **Key:** \`${c.key}\` · **Part:** ${c.part}${c.round ? ` · **Round:** ${c.round}` : ""}${c.needs.length ? ` · **Needs:** ${c.needs.join(", ")}` : ""}`);
      if (c.who) out.push(`- **Sign in as:** ${c.who}`);
      out.push(`- **Start at:** ${c.url}`);
      if (c.steps.length) out.push("- **Steps:**", ...c.steps.map((st, i) => `  ${i + 1}. ${st}`));
      if (c.expected) out.push(`- **Expected result:** ${c.expected}`);
      out.push("");
    }
  }
  out.push(
    "## Results to hand back (JSON)",
    "",
    "One file. `entries` has one entry per case you ran, keyed by the case's key (`RP-nnn`):",
    "",
    "- `status`: `pass`, `fail`, `blocked` or `notrun`.",
    "- `comment`: what you saw.",
    "- `shots`: the ids of its screenshots in the `shots` list, or `[]`.",
    "",
    "Each screenshot in `shots` gives its `data` as base64 PNG or JPEG bytes. Leave `shots` empty if you send the pictures separately, named `<case ID>-<n>.png`.",
    "",
    "```json",
    JSON.stringify({ ...RESULT_EXAMPLE, round }, null, 2),
    "```",
    "",
  );
  return `${out.join("\n")}\n`;
}
/* eslint-enable rabaed/no-avoid-terms */

/**
 * The order the sheet lists cases in: the scenarios file's own order is the strategy's, the order to run them in
 * (RP-1201), so it is kept; cases read from Jira have no such order and are sorted by ID, numbers as numbers.
 */
export function orderCases(cases: SheetCase[], keepOrder: boolean): SheetCase[] {
  return keepOrder ? [...cases] : [...cases].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** The sheet's HTML: the template with the cases, the UAT address its How to start names, fflate and the Excel writer inlined. */
export function renderSheet({ round, cases, built, uatUrl = DEFAULT_UAT_URL }: { round: string; cases: SheetCase[]; built: string; uatUrl?: string }): string {
  const template = readFileSync(join(here, "uat-sheet", "template.html"), "utf8");
  const writer = readFileSync(join(here, "uat-sheet", "xlsx.mjs"), "utf8").replace(/^export /gm, "");
  return template
    .replace("/*__FFLATE__*/", () => findFflate())
    .replace("/*__XLSX__*/", () => writer)
    .replace("/*__DATA__*/null", () => scriptJson({ round, built, uatUrl: uatUrl.replace(/\/+$/, ""), people: DEMO_PEOPLE, peopleMap: PEOPLE_MAP, parts: PART_NAMES, markdown: renderMarkdown({ round, cases, built, uatUrl }), cases }))
    .replaceAll("__ROUND__", round.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!));
}

/** Every issue the JQL finds, page by page (Jira's enhanced search). */
export async function searchIssues(jql: string, credentials: Credentials, fetchImpl: typeof fetch = fetch): Promise<JiraIssue[]> {
  const headers = { Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" };
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const body = { jql, fields: ["summary", "labels", "description", "status"], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) };
    const response = await fetchImpl(`${JIRA}/rest/api/3/search/jql`, { method: "POST", headers, body: JSON.stringify(body) });
    // Status only: Jira's error text is not echoed.
    if (!response.ok) throw new Error(`Jira search answered ${response.status}`);
    const page = (await response.json()) as { issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
    issues.push(...page.issues);
    nextPageToken = page.isLast === false || (page.nextPageToken && page.isLast !== true) ? page.nextPageToken : undefined;
  } while (nextPageToken);
  return issues;
}

/** Issues from a saved file: Jira's search answer, the MCP's `{ issues: { nodes } }`, or a plain list. */
export function issuesFromFile(text: string): JiraIssue[] {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) return data as JiraIssue[];
  const issues = (data as { issues?: unknown }).issues;
  if (Array.isArray(issues)) return issues as JiraIssue[];
  if (issues && typeof issues === "object" && Array.isArray((issues as { nodes?: unknown }).nodes)) return (issues as { nodes: JiraIssue[] }).nodes;
  throw new Error("The issues file holds no issues: expected a list, { issues: [...] } or { issues: { nodes: [...] } }.");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const round = arg(argv, "--round");
  if (!round) throw new Error('usage: node scripts/uat-sheet.ts --round "Round 1" [--jql <JQL> | --issues <file> | --scenarios <test-cases.json>] [--rounds 0,1] [--uat-url <url>] [--out <file>]');
  const uatUrl = arg(argv, "--uat-url") ?? DEFAULT_UAT_URL;
  const file = arg(argv, "--issues");
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // No .env: the environment alone.
  }
  const scenarios = arg(argv, "--scenarios");
  const unsorted = scenarios
    ? casesFromScenarios(readFileSync(scenarios, "utf8"), uatUrl)
    : (file ? issuesFromFile(readFileSync(file, "utf8")) : await searchIssues(arg(argv, "--jql") ?? DEFAULT_JQL, credentialsFrom(process.env))).map((i) => caseFromIssue(i, uatUrl));
  const only = arg(argv, "--rounds")?.split(",").map((r) => r.trim());
  const cases = orderCases(
    unsorted.filter((c) => !only || only.includes(c.round)),
    Boolean(scenarios),
  );
  const out = arg(argv, "--out") ?? join(root, "planning", "uat", "sheet", `${slug(round)}.html`);
  mkdirSync(dirname(out), { recursive: true });
  const built = new Date().toISOString().slice(0, 10);
  writeFileSync(out, renderSheet({ round, cases, built, uatUrl }));
  const md = out.replace(/\.html$/, "") + ".md";
  writeFileSync(md, renderMarkdown({ round, cases, built, uatUrl }));
  console.log(`Wrote ${out} and ${md}: ${cases.length} Test Cases.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
