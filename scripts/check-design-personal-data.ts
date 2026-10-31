import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePage, isNestedPage, type Manifest, manifestOf } from "./check-no-fonts.ts";

// No real person's data is ever committed under design/ (RP-1168): the repo is
// public, and a Claude Design export carries whatever its author typed into the
// mock screens. RP-579 found two personal email addresses in the kit's access
// mock by luck. This refuses, in every text file under design/:
//   email            an address whose domain is not a reserved placeholder (design-personal-data-allow.json)
//   phone            a Saudi (+966, 05x, 01x) or international (+cc) number
//   national-id      ten digits starting 1 (citizen) or 2 (resident, Iqama) with a valid check digit
//   commercial-registration   ten digits named as a CR number (CR, Commercial Registration, سجل تجاري)
//   vat-number       fifteen digits, 3 first and last
//   iban             SA and 22 digits
//   payment-card     sixteen digits in four groups with a valid check digit
// An export nests whole other exports, base64 and usually gzipped, in its manifest
// (RP-1146): those are decoded, at any depth, and so is every text asset of the
// manifest. A nested page that cannot be decoded is itself a finding.
//
// A name on its own cannot be found by a pattern: the check sees the name only
// beside an email or number. A digit run of six or more equal digits is a placeholder
// (050 000 0000), whatever the kind. The rest is the allow list, a reason per entry.
//
// A finding names the file, line, kind and the nested page's path, never the value:
// the output goes to CI logs and PR comments, and the repo is public.
//
// Usage: node scripts/check-design-personal-data.ts --staged         what the design files staged for the next commit add
//        node scripts/check-design-personal-data.ts --range <revs>   what the design files base..head changes add, as they stand at head
//                                                                    (a single revision: its whole design tree, e.g. HEAD for main)
//        node scripts/check-design-personal-data.ts --tree           everything in every tracked design file, as in the working tree
//
// --staged and --range report only a value the file's previous version did not hold (the
// comparison keeps a hash of kind and value, never the value), so data already in a file
// does not fail every change to it. --tree lists all of it: the owner's cleanup list.

export const KINDS = ["email", "phone", "national-id", "commercial-registration", "vat-number", "iban", "payment-card", "undecodable-nested-page"] as const;
export type Kind = (typeof KINDS)[number];

export interface Finding {
  file: string;
  line: number;
  kind: Kind;
  /** The nested pages' uuids, outermost first, when the finding is inside an export's manifest. */
  nested?: string;
}

interface Reasoned {
  reason: string;
}
export interface Allow {
  /** A domain and its subdomains. */
  emailDomains: (Reasoned & { domain: string })[];
  /** One value for one kind: an address, or a number's digits. */
  values: (Reasoned & { kind: Kind; value: string })[];
  /** A file, or a folder when the path ends in "/", for these kinds. */
  files: (Reasoned & { path: string; kinds: Kind[] })[];
}

const ALLOW_FILE = join(import.meta.dirname, "design-personal-data-allow.json");

/** The allow list; every entry must say why (a vague reason is the owner's to refuse in review). */
export function loadAllow(file = ALLOW_FILE): Allow {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Allow>;
  const allow: Allow = { emailDomains: raw.emailDomains ?? [], values: raw.values ?? [], files: raw.files ?? [] };
  for (const entry of [...allow.emailDomains, ...allow.values, ...allow.files]) {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") throw new Error(`${file}: every allow-list entry needs a reason; ${JSON.stringify(entry)} has none.`);
  }
  for (const entry of [...allow.values, ...allow.files.flatMap((file) => file.kinds.map((kind) => ({ kind })))]) {
    if (!KINDS.includes(entry.kind)) throw new Error(`${file}: unknown kind "${entry.kind}"; the kinds are ${KINDS.join(", ")}.`);
  }
  return allow;
}

/** Arabic-Indic and Persian digits as Latin ones; each is one character, so a column stays a column. */
const latinDigits = (text: string) => text.replace(/[٠-٩۰-۹]/g, (char) => String(char.charCodeAt(0) & 0xf));

/** The escapes that hide an "@" from a plain reader. */
const unescapeAt = (text: string) => text.replace(/\\u0040|\\x40|&#0*64;|&#x0*40;|&commat;|%40/gi, "@");

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** Six or more equal digits in a row: 050 000 0000, 0555555555. */
const obviousPlaceholder = (digits: string) => /(\d)\1{5}/.test(digits);

function luhn(digits: string): boolean {
  let sum = 0;
  [...digits].reverse().forEach((char, index) => {
    let digit = Number(char);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  });
  return sum % 10 === 0;
}

const fileExtensionTld = /^(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|css|scss|js|mjs|cjs|jsx|tsx?|json|html?|map|woff2?|ttf|otf|eot|mp[34]|webm|pdf)$/i;

// A kind's candidates on one line, as [kind, matched text]. Lookbehinds keep a number that is
// part of a longer word, number or decimal (an id, a hash, 0.0551234567) from being read.
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))(?![A-Za-z0-9-])/g;
const PHONE_INTERNATIONAL = /(?<![\w+.])\+[1-9](?:[\s.()-]*\d){8,14}(?!\d)/g;
const PHONE_00966 = /(?<![\w+.])00966(?:[\s.()-]*\d){8,10}(?!\d)/g;
const PHONE_KSA_LOCAL = /(?<![\w+.])0(?:5\d|1[1-7])(?:[\s.-]*\d){7}(?!\d)/g;
const ID_NUMBER = /(?<![\w.+-])[12]\d{9}(?!\w|\.\d)/g;
const CR_LABELLED_CASE_SENSITIVE = /\bCR\b[^\d\n]{0,25}?(?<!\d)(\d{10})(?!\w|\.\d)/g;
const CR_LABELLED = /(?:commercial\s+reg\w*|سجل\s*تجاري|السجل\s*التجاري)[^\d\n]{0,25}?(?<!\d)(\d{10})(?!\w|\.\d)/gi;
const VAT_NUMBER = /(?<![\w.+-])3\d{13}3(?!\w|\.\d)/g;
const IBAN = /(?<![\w])SA\d{2}(?:[\s-]?\d){20}(?!\d)/gi;
const PAYMENT_CARD = /(?<![\w.+-])(\d{4})([ -])\d{4}\2\d{4}\2\d{4}(?![\w-])/g;

interface Candidate {
  kind: Kind;
  /** An address, lowercased, or a number's digits. */
  value: string;
}

/** Every candidate on one line, placeholders by shape already dropped. */
function candidates(rawLine: string): Candidate[] {
  const line = unescapeAt(latinDigits(rawLine));
  const found: Candidate[] = [];
  for (const match of line.matchAll(EMAIL)) {
    if (!fileExtensionTld.test(match[2]!)) found.push({ kind: "email", value: match[0].toLowerCase() });
  }
  for (const pattern of [PHONE_INTERNATIONAL, PHONE_00966, PHONE_KSA_LOCAL]) {
    for (const [phone] of line.matchAll(pattern)) {
      const digits = digitsOf(phone);
      if (digits.length >= 9 && digits.length <= 15 && !obviousPlaceholder(digits)) found.push({ kind: "phone", value: digits });
    }
  }
  const numbers: [Kind, RegExp, (digits: string) => boolean, number?][] = [
    ["national-id", ID_NUMBER, luhn],
    ["commercial-registration", CR_LABELLED_CASE_SENSITIVE, () => true, 1],
    ["commercial-registration", CR_LABELLED, () => true, 1],
    ["vat-number", VAT_NUMBER, () => true],
    ["iban", IBAN, () => true],
  ];
  for (const [kind, pattern, valid, group = 0] of numbers) {
    for (const match of line.matchAll(pattern)) {
      const digits = digitsOf(match[group]!);
      if (valid(digits) && !obviousPlaceholder(digits)) found.push({ kind, value: digits });
    }
  }
  for (const [card] of line.matchAll(PAYMENT_CARD)) {
    const digits = digitsOf(card);
    if (luhn(digits) && !obviousPlaceholder(digits)) found.push({ kind: "payment-card", value: digits });
  }
  return found;
}

function allowed(file: string, candidate: Candidate, allow: Allow): boolean {
  if (candidate.kind === "email") {
    const domain = candidate.value.slice(candidate.value.lastIndexOf("@") + 1);
    if (allow.emailDomains.some((entry) => domain === entry.domain.toLowerCase() || domain.endsWith(`.${entry.domain.toLowerCase()}`))) return true;
  }
  const value = candidate.value.toLowerCase();
  if (allow.values.some((entry) => entry.kind === candidate.kind && (candidate.kind === "email" ? entry.value.toLowerCase() === value : digitsOf(entry.value) === value || (candidate.kind === "phone" && trimPhone(digitsOf(entry.value)) === trimPhone(value))))) return true;
  return allow.files.some((entry) => entry.kinds.includes(candidate.kind) && (entry.path.endsWith("/") ? file.startsWith(entry.path) : file === entry.path));
}

/** A phone's digits without the country code and trunk zero, so "0551234567" and "+966 55 123 4567" are one number. */
function trimPhone(digits: string): string {
  return digits.replace(/^(?:00)?966/, "").replace(/^0/, "");
}

/** A finding with the identity of what it found: a hash of the kind and value, so two versions of a file can be compared without the value being kept. */
interface Detailed {
  finding: Finding;
  id: string;
}

const identity = (kind: Kind, value: string) => createHash("sha256").update(`${kind}\0${value}`).digest("hex").slice(0, 16);

function detailedText(file: string, text: string, allow: Allow, nested?: string): Detailed[] {
  const found: Detailed[] = [];
  text.split("\n").forEach((line, index) => {
    const seen = new Set<string>();
    for (const candidate of candidates(line)) {
      const id = identity(candidate.kind, candidate.value);
      if (allowed(file, candidate, allow) || seen.has(id)) continue;
      seen.add(id);
      found.push({ id, finding: { file, line: index + 1, kind: candidate.kind, ...(nested ? { nested } : {}) } });
    }
  });
  return found;
}

/** The findings in a text file's lines (a file that is not an export). */
export const scanText = (file: string, text: string, allow: Allow, nested?: string): Finding[] => detailedText(file, text, allow, nested).map(({ finding }) => finding);

// The manifest assets that are text: pages, scripts, JSON, styles, SVG.
const textAsset = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;

/** The findings in every text asset of an export's manifest, pages nested in pages included. */
function detailedManifest(file: string, page: string, allow: Allow, path: string[] = []): Detailed[] {
  const manifest: Manifest = manifestOf(page) ?? {};
  return Object.entries(manifest).flatMap(([uuid, entry]) => {
    if (!textAsset.test(entry.mime ?? "")) return [];
    const where = [...path, uuid];
    const nested = where.join(" > ");
    let text: string;
    try {
      text = decodePage(uuid, entry);
    } catch {
      return [{ id: identity("undecodable-nested-page", nested), finding: { file, line: 1, kind: "undecodable-nested-page" as const, nested } }];
    }
    return [...detailedText(file, text, allow, nested), ...(isNestedPage(entry) ? detailedManifest(file, text, allow, where) : [])];
  });
}

function detailedFile(file: string, text: string, allow: Allow): Detailed[] {
  if (text.includes("\0")) return [];
  return [...detailedText(file, text, allow), ...detailedManifest(file, text, allow)];
}

/** The findings in one design file: its text, and every asset its manifest nests. A binary file has none. */
export const scanDesignFile = (file: string, text: string, allow: Allow): Finding[] => detailedFile(file, text, allow).map(({ finding }) => finding);

/**
 * The findings in a design file that its previous version did not already have. Data a file
 * held before is the owner's to clean (--tree lists it) and must not fail every change to
 * the file; a value added, or moved into another file, fails.
 */
export function scanDesignFileChange(file: string, text: string, before: string | undefined, allow: Allow): Finding[] {
  const had = new Set(before === undefined ? [] : detailedFile(file, before, allow).map(({ id }) => id));
  return detailedFile(file, text, allow)
    .filter(({ id }) => !had.has(id))
    .map(({ finding }) => finding);
}

/** One finding as a line of output: never the value. */
export const formatFinding = ({ file, line, kind, nested }: Finding) => `  ${file}:${line}: ${kind}${nested ? ` (in the nested ${nested})` : ""}`;

const git = (repo: string, args: string[]) => execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const inDesign = (path: string) => path.startsWith("design/");
const lines = (output: string) => output.split("\n").filter(Boolean);

/** A file's text at a revision ("" for the index); undefined when the file is not there. */
function showAt(repo: string, rev: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

/** The new findings in the design files staged to be added or changed, as staged, against HEAD's version. */
export function scanStaged(repo: string, allow = loadAllow()): Finding[] {
  const paths = lines(git(repo, ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACM", "--", "design"])).filter(inDesign);
  return paths.flatMap((path) => scanDesignFileChange(path, showAt(repo, "", path) ?? "", showAt(repo, "HEAD", path), allow));
}

/** The new findings in the design files a range changes, as they stand at its head, against base's version; a single revision is its whole design tree, every finding. */
export function scanRange(repo: string, range: string, allow = loadAllow()): Finding[] {
  const [base, head] = range.includes("..") ? range.split(/\.{2,3}/) : [undefined, range];
  const paths = base === undefined ? lines(git(repo, ["ls-tree", "-r", "--name-only", head!, "--", "design"])) : lines(git(repo, ["diff", "--name-only", "--no-renames", "--diff-filter=ACM", range, "--", "design"]));
  return paths.filter(inDesign).flatMap((path) => scanDesignFileChange(path, showAt(repo, head!, path) ?? "", base === undefined ? undefined : showAt(repo, base, path), allow));
}

/** Every finding in every tracked design file, as it is in the working tree. */
export function scanTree(repo: string, allow = loadAllow()): Finding[] {
  return lines(git(repo, ["ls-files", "--", "design"]))
    .filter(inDesign)
    .flatMap((path) => {
      try {
        return scanDesignFile(path, readFileSync(join(repo, path), "utf8"), allow);
      } catch {
        return []; // deleted in the working tree
      }
    });
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const repo = process.cwd();
  const [mode, range] = process.argv.slice(2);
  if (mode === "--range" && (!range || range.startsWith("-"))) {
    console.error("--range needs the revisions to check, such as <base sha>..<head sha> or HEAD.");
    process.exit(2);
  }
  const modes: Record<string, { where: string; scan: () => Finding[] }> = {
    "--staged": { where: "in the staged design changes", scan: () => scanStaged(repo) },
    "--range": { where: `in the design changes of ${range}`, scan: () => scanRange(repo, range!) },
    "--tree": { where: "in the tracked design tree", scan: () => scanTree(repo) },
  };
  const chosen = mode === undefined ? undefined : modes[mode];
  if (!chosen) {
    console.error("usage: node scripts/check-design-personal-data.ts --staged | --range <revs> | --tree");
    process.exit(2);
  }
  const findings = chosen.scan();
  if (findings.length > 0) {
    console.error(`Personal data is ${chosen.where} (the repo is public); the kind and place, never the value, are listed:`);
    for (const finding of findings) console.error(formatFinding(finding));
    console.error("Replace it with a placeholder (an @example.com address, 050 000 0000), as the kit does. A deliberate placeholder goes in scripts/design-personal-data-allow.json with its reason.");
    console.error("If it was ever committed, tell the owner: a pushed commit stays readable.");
    process.exit(1);
  }
  console.log(`No personal data ${chosen.where}.`);
}
